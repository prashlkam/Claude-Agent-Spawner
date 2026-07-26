import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Diagnostic } from '@agent-spawner/compiler';

const run = promisify(execFile);

export type ValidationFile = { path: string; bytes: Buffer; executable?: boolean };

export type L3Result = {
  status: 'passed' | 'failed' | 'unavailable';
  diagnostics: Diagnostic[];
  cliOutput: string;
  runner: 'docker' | 'local' | 'none';
};

const IMAGE = process.env.VALIDATE_IMAGE ?? 'agent-spawner/validate:latest';
const TIMEOUT_MS = 60_000;

/**
 * L3 — run the real `claude plugin validate` against a materialised bundle. This is ground
 * truth; L1 and L2 are only fast approximations of it.
 *
 * The bundle is untrusted content, so the container runs with no network, a read-only root,
 * a non-root user, and capped CPU/memory/time (PLAN §11). When Docker is not available the
 * runner falls back to the local CLI, and says so — a local run has none of those guarantees,
 * which is why the result records which runner produced it.
 */
export async function validateBundle(slug: string, files: ValidationFile[]): Promise<L3Result> {
  const workdir = await mkdtemp(join(tmpdir(), 'agent-spawner-validate-'));
  const pluginDir = join(workdir, slug);

  try {
    for (const file of files) {
      const target = join(pluginDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
      if (file.executable) await chmod(target, 0o755);
    }

    if (await hasDocker()) return await runInContainer(workdir, slug);
    if (await hasLocalCli()) return await runLocally(pluginDir);

    return {
      status: 'unavailable',
      runner: 'none',
      cliOutput: '',
      diagnostics: [
        {
          rule: 'l3-unavailable',
          severity: 'info',
          layer: 'cli',
          message:
            'Real CLI validation needs either Docker (preferred — the bundle runs sandboxed) or the `claude` CLI on PATH. Neither was found, so only the schema and semantic checks ran.',
        },
      ],
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function runInContainer(workdir: string, slug: string): Promise<L3Result> {
  try {
    const { stdout, stderr } = await run(
      'docker',
      [
        'run',
        '--rm',
        '--network=none',
        '--read-only',
        '--user=1000:1000',
        '--cpus=1',
        '--memory=512m',
        '--pids-limit=128',
        '--security-opt=no-new-privileges',
        '--tmpfs=/tmp:rw,size=64m',
        '-v',
        `${workdir}:/work:ro`,
        IMAGE,
        'claude',
        'plugin',
        'validate',
        `/work/${slug}`,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    return interpret(`${stdout}${stderr}`, 'docker', true);
  } catch (error) {
    return interpretError(error, 'docker');
  }
}

async function runLocally(pluginDir: string): Promise<L3Result> {
  try {
    const { stdout, stderr } = await run('claude', ['plugin', 'validate', pluginDir], {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return interpret(`${stdout}${stderr}`, 'local', true);
  } catch (error) {
    return interpretError(error, 'local');
  }
}

function interpretError(error: unknown, runner: 'docker' | 'local'): L3Result {
  const e = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
  if (e.killed) {
    return {
      status: 'failed',
      runner,
      cliOutput: 'Validation timed out.',
      diagnostics: [
        {
          rule: 'l3-timeout',
          severity: 'error',
          layer: 'cli',
          message: `\`claude plugin validate\` did not finish within ${TIMEOUT_MS / 1000}s.`,
        },
      ],
    };
  }
  return interpret(`${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`, runner, false);
}

/**
 * Parse the CLI's output back into diagnostics anchored to files, so a failure lands in the
 * same drawer as the L1/L2 results rather than as a wall of text.
 */
function interpret(output: string, runner: 'docker' | 'local', ok: boolean): L3Result {
  const text = output.trim();
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split('\n')) {
    // Summary lines like "✘ Found 2 errors:" restate the detail lines that follow.
    if (/^\s*[✖✗✘]\s*(Found \d+ error|Validation (failed|passed))/i.test(line)) continue;
    const match = line.match(/^\s*(?:[✖✗✘❯]|error)[:\s]+(.*)$/i);
    if (match) {
      diagnostics.push({
        rule: 'l3-cli',
        severity: 'error',
        layer: 'cli',
        message: match[1]!.trim(),
        file: fileFrom(match[1]!),
        tab: 'preview',
      });
      continue;
    }
    const warn = line.match(/^\s*(?:[⚠▲!]|warning)[:\s]+(.*)$/i);
    if (warn) {
      diagnostics.push({
        rule: 'l3-cli',
        severity: 'warning',
        layer: 'cli',
        message: warn[1]!.trim(),
        file: fileFrom(warn[1]!),
        tab: 'preview',
      });
    }
  }

  const failed = !ok || diagnostics.some((d) => d.severity === 'error');
  if (failed && diagnostics.length === 0) {
    diagnostics.push({
      rule: 'l3-cli',
      severity: 'error',
      layer: 'cli',
      message: text || 'Validation failed without output.',
      tab: 'preview',
    });
  }

  return { status: failed ? 'failed' : 'passed', runner, cliOutput: text, diagnostics };
}

function fileFrom(message: string): string | undefined {
  const match = message.match(/([\w.-]+\/)*[\w.-]+\.(json|md|sh)\b/);
  return match?.[0];
}

async function hasDocker(): Promise<boolean> {
  if (process.env.VALIDATE_RUNNER === 'local') return false;
  try {
    await run('docker', ['image', 'inspect', IMAGE], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function hasLocalCli(): Promise<boolean> {
  try {
    await run('claude', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
