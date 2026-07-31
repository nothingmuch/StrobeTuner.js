import { defineConfig } from '@playwright/test';

// 110 Hz is the A string, and matches one of the canvases in index.html.
export const TONE_HZ = 110;

// In the NixOS VM the site is already served by nginx and the tone comes from
// the store, so there is nothing to spawn. Locally we start our own server.
const external = process.env.BASE_URL;
const tone = process.env.TONE_WAV ?? new URL('test/tone.wav', import.meta.url).pathname;

export default defineConfig({
	testDir: './test',
	timeout: 60_000,
	reporter: [['list']],

	...(external ? {} : {
		webServer: {
			command: 'node test/server.mjs',
			url: 'http://127.0.0.1:8765/',
			reuseExistingServer: true,
		},
	}),

	use: {
		baseURL: external ?? 'http://127.0.0.1:8765',
		permissions: ['microphone'],
		launchOptions: {
			args: [
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream',
				`--use-file-for-fake-audio-capture=${tone}`,
				'--autoplay-policy=no-user-gesture-required',
				// The VM runs the suite as root, where the setuid sandbox refuses
				// to start.
				...(process.env.CHROMIUM_NO_SANDBOX ? ['--no-sandbox'] : []),
			],
		},
	},
});
