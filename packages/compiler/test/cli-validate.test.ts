import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { compile } from '../src/index.ts';
import { fixtures } from './fixtures.ts';

const run = promisify(execFile);

/**
 * Integration: every fixture must pass the real `claude plugin validate` (PLAN §13).
 *
 * This is the check that catches the things L1 and L2 can only approximate — it already caught
 * `dependencies` being emitted as an object map instead of an array.
 *
 * Skipped, not failed, when the CLI is unavailable, so `npm test` still works on a machine
 * without Claude Code installed. In CI the CLI is present and these run for real.
 */
const available = await hasCli();

for (const [name, spec] of Object.entries(fixtures)) {
  test(`claude plugin validate: ${name}`, { skip: available ? false : 'the `claude` CLI is not on PATH' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-spawner-cli-'));
    const pluginDir = join(root, spec.meta.slug);

    try {
      for (const file of compile(spec).files) {
        const target = join(pluginDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content ?? '');
      }

      const { stdout, stderr } = await run('claude', ['plugin', 'validate', pluginDir], {
        timeout: 60_000,
      });
      const output = `${stdout}${stderr}`;
      assert.match(output, /Validation passed/i, output);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

async function hasCli(): Promise<boolean> {
  try {
    await run('claude', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
