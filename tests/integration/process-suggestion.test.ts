import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
	new URL('../../scripts/apply-suggestion.mjs', import.meta.url),
);
const REPO_MEETUPS_DIR = fileURLToPath(
	new URL('../../src/content/meetups/', import.meta.url),
);

// Whole-workflow contract: the script reads the raw issue body on stdin, writes
// step outputs to $GITHUB_OUTPUT, and mutates the target meetup file in place.
// If any of that changes, .github/workflows/process-suggestion.yml stops
// working — this is the check that catches it before the PR merges.
describe('scripts/apply-suggestion.mjs (subprocess)', () => {
	let tmpDir: string;
	let meetupsCopyDir: string;
	let githubOutputFile: string;
	let originalMeetupsRaw: Record<string, string>;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'process-suggestion-'));
		meetupsCopyDir = join(tmpDir, 'meetups');
		githubOutputFile = join(tmpDir, 'github-output');

		// The script's MEETUPS_DIR is resolved from `import.meta.url`, so it
		// always looks at the real src/content/meetups/ in the repo — we back
		// up every file, let the script mutate the real ones, then restore.
		await cp(REPO_MEETUPS_DIR, meetupsCopyDir, { recursive: true });
		originalMeetupsRaw = {};
		const { readdir } = await import('node:fs/promises');
		for (const file of await readdir(meetupsCopyDir)) {
			originalMeetupsRaw[file] = await readFile(
				join(meetupsCopyDir, file),
				'utf-8',
			);
		}
	});

	afterAll(async () => {
		// Restore every meetup file to what the copy captured, then wipe tmp.
		for (const [file, raw] of Object.entries(originalMeetupsRaw)) {
			await writeFile(join(REPO_MEETUPS_DIR, file), raw);
		}
		await rm(tmpDir, { recursive: true, force: true });
	});

	function runScript(body: string): Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
	}> {
		return new Promise((resolve, reject) => {
			const child = spawn('node', [SCRIPT], {
				env: { ...process.env, GITHUB_OUTPUT: githubOutputFile },
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (c) => (stdout += c));
			child.stderr.on('data', (c) => (stderr += c));
			child.on('error', reject);
			child.on('close', (exitCode) =>
				resolve({ exitCode: exitCode ?? 0, stdout, stderr }),
			);
			child.stdin.end(body);
		});
	}

	it('applies a realistic issue body — mutates the file, writes step outputs, exits 0', async () => {
		// Mirrors what GitHub actually posts for the suggest-edit.yml form:
		// every field rendered as a `### Label` block, blanks as `_No response_`,
		// the untouched dropdown as `None`.
		const body = [
			'### Which group is this for?',
			'',
			'Nottingham Programmers',
			'',
			'### New cadence',
			'',
			'Every second Friday',
			'',
			'### New summary',
			'',
			'_No response_',
			'',
			'### Links to add',
			'',
			'LinkedIn: https://www.linkedin.com/company/nottingham-programmers/',
			'Mastodon: https://mastodon.social/@nottprogs',
			'',
			'### New group name',
			'',
			'_No response_',
			'',
			'### New URL',
			'',
			'_No response_',
			'',
			'### New events URL',
			'',
			'_No response_',
			'',
			'### New category',
			'',
			'None',
			'',
			'### New notes',
			'',
			'_No response_',
			'',
			'### Notes for the reviewer',
			'',
			'_No response_',
		].join('\n');

		const { exitCode, stdout, stderr } = await runScript(body);
		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(stdout).toContain('group-name=Nottingham Programmers');
		expect(stdout).toContain(
			'file-path=src/content/meetups/nottingham-programmers.yml',
		);

		const outputContents = await readFile(githubOutputFile, 'utf-8');
		expect(outputContents).toBe(
			'group-name=Nottingham Programmers\nfile-path=src/content/meetups/nottingham-programmers.yml\n',
		);

		const mutated = await readFile(
			join(REPO_MEETUPS_DIR, 'nottingham-programmers.yml'),
			'utf-8',
		);
		const original = originalMeetupsRaw['nottingham-programmers.yml'];

		// The links block was originally commented out in the fixture; the
		// script rewrites the `links:` key (appending it if missing) and adds
		// the two new links. Everything else is byte-identical apart from the
		// cadence line.
		expect(mutated).toContain('cadence: Every second Friday');
		expect(mutated).toContain(
			'- label: LinkedIn\n    url: https://www.linkedin.com/company/nottingham-programmers/',
		);
		expect(mutated).toContain(
			'- label: Mastodon\n    url: https://mastodon.social/@nottprogs',
		);

		// Category was left as "None", so the category line must not have moved.
		const originalCategoryLine = original
			.split('\n')
			.find((l) => l.startsWith('category:'));
		expect(originalCategoryLine).toBeDefined();
		expect(
			mutated.split('\n').filter((l) => l.startsWith('category:')),
		).toEqual([originalCategoryLine]);

		// Summary was left unchanged, so its exact (folded) block must survive.
		expect(mutated).toContain(
			'summary: >-\n  A chance to meet programmers to socialise and talk about all things techie —\n  no structure or agenda.',
		);
	});

	it('exits non-zero with a helpful error when the group name does not match any file', async () => {
		const body = [
			'### Which group is this for?',
			'',
			'A group that does not exist',
		].join('\n');
		const { exitCode, stderr } = await runScript(body);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain('No meetup file found');
	});
});
