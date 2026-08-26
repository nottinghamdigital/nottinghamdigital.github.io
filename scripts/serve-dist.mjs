/**
 * Foreground static server for `dist/`, used as Playwright's `webServer`.
 *
 * `astro dev` and `astro preview` both daemonise and return immediately, so
 * Playwright sees the command exit and gives up with "webServer exited early".
 * This serves the built output instead, which is also what GitHub Pages
 * publishes — so the tests run against the real artefact rather than a dev
 * server that rewrites things on the fly.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// `.pathname` mishandles Windows drive letters (and leaves %20 undecoded);
// fileURLToPath() is the correct way to turn a file: URL back into a path.
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webmanifest': 'application/manifest+json',
};

async function resolve(pathname) {
	// `build.format: 'directory'` means /foo is served from /foo/index.html.
	const rel = normalize(decodeURIComponent(pathname))
		.replace(/^(\.\.[/\\])+/, '')
		.replace(/^[/\\]+/, '');
	const candidates = rel === '' || rel.endsWith('/')
		? [join(rel, 'index.html')]
		: [rel, join(rel, 'index.html')];
	for (const file of candidates.map(c => join(ROOT, c))) {
		try {
			if ((await stat(file)).isFile()) return file;
		} catch {}
	}
	return null;
}

createServer(async (req, res) => {
	const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
	const file = await resolve(pathname);

	if (!file) {
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('Not found');
		return;
	}

	res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
	res.end(await readFile(file));
}).listen(PORT, () => {
	console.log(`serving dist/ on http://localhost:${PORT}`);
});
