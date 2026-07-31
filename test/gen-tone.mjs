// Mono sine WAV for chromium's --use-file-for-fake-audio-capture.
import { writeFile } from 'node:fs/promises';

const [freq = 110, seconds = 30] = process.argv.slice(2).map(Number);
const rate = 48000;
const n = Math.floor(rate * seconds);

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + n * 2, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);   // PCM
header.writeUInt16LE(1, 22);   // mono
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(n * 2, 40);

const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
	pcm.writeInt16LE(Math.round(0.6 * Math.sin(2 * Math.PI * freq * i / rate) * 32767), i * 2);
}

const out = new URL('tone.wav', import.meta.url).pathname;
await writeFile(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out}: ${freq} Hz, ${seconds}s @ ${rate} Hz`);
