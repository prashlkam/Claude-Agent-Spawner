import archiver from 'archiver';
import { compile, hasErrors, validateL1 } from '@agent-spawner/compiler';
import type { CompiledFile, Diagnostic } from '@agent-spawner/compiler';
import type { AgentSpec } from '@agent-spawner/spec';
import { getObject } from './storage.ts';

export type ResolvedFile = { path: string; bytes: Buffer; executable: boolean };

/**
 * Turn a spec into the real bytes of the bundle: run the compiler, then pull each
 * `external` knowledge file out of object storage. The compiler stays pure; all I/O is here.
 */
export async function materialize(spec: AgentSpec): Promise<{
  files: ResolvedFile[];
  diagnostics: Diagnostic[];
}> {
  const result = compile(spec);
  const diagnostics = [...validateL1(spec), ...result.diagnostics];

  const files = await Promise.all(
    result.files.map(async (file: CompiledFile): Promise<ResolvedFile> => {
      if (file.external) {
        const bytes = await getObject(file.external.storageKey);
        return {
          path: file.path,
          bytes:
            bytes ??
            Buffer.from(
              `This knowledge file was not found in storage (${file.external.filename}).\n`,
              'utf8',
            ),
          executable: false,
        };
      }
      return {
        path: file.path,
        bytes: Buffer.from(file.content ?? '', 'utf8'),
        executable: Boolean(file.executable),
      };
    }),
  );

  return { files, diagnostics };
}

/**
 * Reproducible zip: fixed entry order, a fixed timestamp and no compression variance, so the
 * same spec always produces the same bytes. Zips are generated on demand and never stored.
 */
export async function zipBundle(spec: AgentSpec, files: ResolvedFile[]): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<void>((resolvePromise, reject) => {
    archive.on('end', () => resolvePromise());
    archive.on('error', reject);
  });

  const root = spec.meta.slug;
  const date = new Date('2020-01-01T00:00:00Z');

  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    archive.append(file.bytes, {
      name: `${root}/${file.path}`,
      date,
      mode: file.executable ? 0o755 : 0o644,
    });
  }

  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

export function blockingErrors(diagnostics: Diagnostic[]): Diagnostic[] {
  return hasErrors(diagnostics) ? diagnostics.filter((d) => d.severity === 'error') : [];
}
