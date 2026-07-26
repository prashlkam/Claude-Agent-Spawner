import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compile } from '../src/index.ts';
import { fixtures } from './fixtures.ts';

const here = dirname(fileURLToPath(import.meta.url));
const goldenRoot = join(here, 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/**
 * The backbone of the test suite (PLAN §13): every fixture spec has its expected output tree
 * checked into the repo, so any compiler change shows up as a reviewable diff.
 *
 * Regenerate with `npm run golden:update`, then read the diff before committing.
 */
for (const [name, spec] of Object.entries(fixtures)) {
  test(`golden: ${name}`, async () => {
    const { files } = compile(spec);
    const dir = join(goldenRoot, name);

    if (UPDATE) {
      await rm(dir, { recursive: true, force: true });
      for (const file of files) {
        const target = join(dir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(
          target,
          file.content ?? `<external: ${file.external?.storageKey} ${file.external?.sizeBytes} bytes>\n`,
        );
      }
      return;
    }

    const expectedPaths = (await walk(dir)).map((p) => relative(dir, p).split('\\').join('/')).sort();
    const actualPaths = files.map((f) => f.path).sort();
    assert.deepEqual(actualPaths, expectedPaths, 'emitted file list differs from the golden tree');

    for (const file of files) {
      const expected = await readFile(join(dir, file.path), 'utf8');
      const actual =
        file.content ?? `<external: ${file.external?.storageKey} ${file.external?.sizeBytes} bytes>\n`;
      assert.equal(actual, expected, `content differs: ${file.path}`);
    }
  });

  test(`deterministic: ${name}`, () => {
    const a = compile(spec);
    const b = compile(spec);
    assert.deepEqual(a.files, b.files, 'compiling the same spec twice produced different files');
  });
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
