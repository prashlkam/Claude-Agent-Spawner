import { agentSpecSchema, SPEC_VERSION } from './schema.ts';
import type { AgentSpec } from './schema.ts';

/**
 * Spec migrations run lazily on read (PLAN §14.5): stored `AgentVersion` snapshots keep
 * whatever version they were written at, and are upgraded when they are loaded.
 *
 * Each entry migrates *from* its key *to* key + 1. Add a function here whenever
 * SPEC_VERSION is bumped; never edit an existing one.
 */
const migrations: Record<number, (spec: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (spec) => ({ ...spec, specVersion: 2, /* ... */ }),
};

export class SpecMigrationError extends Error {}

/** Upgrade an arbitrary stored spec to the current version, then validate it. */
export function migrateSpec(input: unknown): AgentSpec {
  if (input === null || typeof input !== 'object') {
    throw new SpecMigrationError('Spec must be an object');
  }
  let current = { ...(input as Record<string, unknown>) };
  let version = typeof current.specVersion === 'number' ? current.specVersion : SPEC_VERSION;

  if (version > SPEC_VERSION) {
    throw new SpecMigrationError(
      `Spec version ${version} was written by a newer build of Agent Spawner (this build understands v${SPEC_VERSION}).`,
    );
  }

  while (version < SPEC_VERSION) {
    const step = migrations[version];
    if (!step) throw new SpecMigrationError(`No migration registered from spec v${version}`);
    current = step(current);
    version = typeof current.specVersion === 'number' ? current.specVersion : version + 1;
  }

  current.specVersion = SPEC_VERSION;
  return agentSpecSchema.parse(current);
}

/** Parse without throwing — used by API routes that must return a 400 rather than a 500. */
export function safeMigrateSpec(
  input: unknown,
): { ok: true; spec: AgentSpec } | { ok: false; error: string } {
  try {
    return { ok: true, spec: migrateSpec(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
