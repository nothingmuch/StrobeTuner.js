import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.wav': 'audio/wav',
};

createServer(async (req, res) => {
	const path = normalize(decodeURI(req.url.split('?')[0]));
	const file = join(root, path === '/' ? 'index.html' : path);

	try {
		const body = await readFile(file);
		res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
		res.end(body);
	} catch {
		res.writeHead(404).end('not found');
	}
}).listen(8765, '127.0.0.1');
