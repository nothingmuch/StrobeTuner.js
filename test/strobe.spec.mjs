import { test, expect } from '@playwright/test';
import { TONE_HZ } from '../playwright.config.mjs';

// Read the luma of each canvas's middle scanline, plus how many pixels have
// been painted at all. An untouched canvas is fully transparent, so alpha
// distinguishes "painted black" from "never drawn" -- which is exactly the
// signature of the worklet never being pulled.
const sampleScanlines = () =>
	[...document.querySelectorAll('canvas.strobe')].map((canvas) => {
		const cls = canvas.getAttribute('class');
		const data = canvas
			.getContext('2d')
			.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data;

		const lum = [];
		let painted = 0;
		for (let x = 0; x < canvas.width; x++) {
			lum.push(data[4 * x]);
			if (data[4 * x + 3] !== 0) painted++;
		}
		return { pitch: parseFloat(cls.slice(cls.lastIndexOf('_') + 1)), lum, painted };
	});

async function startTuner(page) {
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/');
	await page.locator('canvas.strobe').first().waitFor();
	await page.mouse.click(10, 10); // the gesture gate
	return errors;
}

test('worklet is pulled, so strobes actually render', async ({ page }) => {
	const errors = await startTuner(page);

	// If process() is never called, buffer_t stays 0, draw() early-returns and
	// no canvas is ever touched. Poll rather than sleep so a working build is
	// fast and a broken one still fails honestly.
	await expect
		.poll(
			async () => {
				const s = await page.evaluate(sampleScanlines);
				return s.reduce((n, c) => n + (c.painted > 0 ? 1 : 0), 0);
			},
			{ timeout: 15_000, message: 'no canvas was ever painted' },
		)
		.toBeGreaterThan(0);

	expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
});

test(`${TONE_HZ} Hz strobe holds still while detuned strobes drift`, async ({ page }) => {
	await startTuner(page);

	await expect
		.poll(
			async () => (await page.evaluate(sampleScanlines)).some((c) => c.painted > 0),
			{ timeout: 15_000 },
		)
		.toBe(true);

	const frames = [];
	for (let i = 0; i < 20; i++) {
		frames.push(await page.evaluate(sampleScanlines));
		await page.waitForTimeout(100);
	}

	const pitches = frames[0].map((c) => c.pitch);
	const drift = pitches.map((pitch, c) => {
		const shifts = [];
		for (let f = 1; f < frames.length; f++) {
			shifts.push(Math.abs(bestShift(frames[f - 1][c].lum, frames[f][c].lum)));
		}
		shifts.sort((a, b) => a - b);
		return {
			pitch,
			medianShift: shifts[shifts.length >> 1],
			variance: mean(frames.map((f) => variance(f[c].lum))),
		};
	});

	console.table(drift);

	const matched = drift.reduce((a, b) =>
		Math.abs(a.pitch - TONE_HZ) < Math.abs(b.pitch - TONE_HZ) ? a : b,
	);

	// A flat canvas has nothing to correlate, so "stationary" would be vacuous.
	expect(matched.variance, `${matched.pitch} Hz strobe is flat, no signal`).toBeGreaterThan(1);
	expect(matched.medianShift, `${matched.pitch} Hz strobe should be stationary`).toBeLessThan(2);
});

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const variance = (a) => {
	const m = mean(a);
	return mean(a.map((x) => (x - m) ** 2));
};

// Circular cross-correlation: how far did the pattern slide between frames?
function bestShift(a, b) {
	const w = a.length;
	const ma = mean(a);
	const mb = mean(b);
	let best = 0;
	let bestScore = -Infinity;

	for (let s = 0; s < w; s++) {
		let acc = 0;
		for (let i = 0; i < w; i++) acc += (a[i] - ma) * (b[(i + s) % w] - mb);
		if (acc > bestScore) {
			bestScore = acc;
			best = s;
		}
	}
	return best > w / 2 ? best - w : best;
}
