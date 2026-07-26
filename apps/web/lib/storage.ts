import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Object storage for uploaded knowledge files.
 *
 * Backed by the local filesystem so the app runs with no external services. The interface is
 * the S3 one (put/get/remove by opaque key), so swapping in a bucket is a change to this file
 * alone. Keys are never derived from user input — a caller-supplied filename can never escape
 * the storage root.
 */

const ROOT = resolve(process.env.STORAGE_DIR ?? join(process.cwd(), '..', '..', 'storage'));

/** Rejected uploads never reach disk (PLAN §11). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/yaml',
  'application/pdf',
  'application/octet-stream',
]);

export type StoredObject = { storageKey: string; sizeBytes: number; checksum: string };

function pathFor(storageKey: string): string {
  const target = resolve(join(ROOT, storageKey));
  if (!target.startsWith(`${ROOT}/`)) throw new Error('Invalid storage key');
  return target;
}

export async function putObject(agentId: string, bytes: Buffer): Promise<StoredObject> {
  // Per-agent prefixes: no shared prefix means no cross-tenant read even with a leaked key.
  const storageKey = `${agentId}/${randomUUID()}`;
  const target = pathFor(storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return {
    storageKey,
    sizeBytes: bytes.byteLength,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function getObject(storageKey: string): Promise<Buffer | null> {
  try {
    return await readFile(pathFor(storageKey));
  } catch {
    return null;
  }
}

export async function removeObject(storageKey: string): Promise<void> {
  await rm(pathFor(storageKey), { force: true });
}
