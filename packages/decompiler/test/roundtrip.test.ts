import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '@agent-spawner/compiler';
import { fixtures } from '../../compiler/test/fixtures.ts';
import { decompile } from '../src/index.ts';
import type { SourceFile } from '../src/index.ts';

/**
 * Round-trip property (PLAN §13).
 *
 * The assertion is a *fixed point on the bundle*, not equality of specs: importing a plugin and
 * exporting it again must produce the identical bundle. Spec equality cannot hold — ids, storage
 * keys and deployment settings are editor state that never reaches the files — so asserting it
 * would mean asserting something untrue.
 */
for (const [name, spec] of Object.entries(fixtures)) {
  test(`round-trip: ${name}`, () => {
    const original = compile(spec).files;
    // Uploaded knowledge lives in object storage, so the on-disk bundle has bytes where the
    // compile result has an `external` marker. The importer sees the real files.
    const sources: SourceFile[] = original.map((f) => ({
      path: f.path,
      content: f.content ?? '',
      sizeBytes: f.external?.sizeBytes,
    }));

    const { spec: imported } = decompile(sources);
    const recompiled = compile(imported).files;

    assert.deepEqual(
      recompiled.map((f) => f.path).sort(),
      sources.map((f) => f.path).sort(),
      'file list changed across a round trip',
    );

    for (const file of original) {
      if (file.content === null) continue;
      const after = recompiled.find((f) => f.path === file.path);
      assert.equal(after?.content, file.content, `content changed across a round trip: ${file.path}`);
    }
  });

  test(`round-trip preserves the fields the bundle carries: ${name}`, () => {
    const sources = compile(spec).files.map((f) => ({
      path: f.path,
      content: f.content ?? '',
      sizeBytes: f.external?.sizeBytes,
    }));
    const { spec: imported } = decompile(sources);

    assert.equal(imported.meta.slug, spec.meta.slug);
    assert.equal(imported.meta.name, spec.meta.name);
    assert.equal(imported.meta.version, spec.meta.version);
    assert.equal(imported.goal.statement, spec.goal.statement);
    assert.deepEqual(imported.goal.successCriteria, spec.goal.successCriteria);
    assert.deepEqual(imported.goal.outOfScope, spec.goal.outOfScope);
    assert.equal(imported.subAgents.length, spec.subAgents.length);
    assert.deepEqual(
      imported.subAgents.map((a) => a.name).sort(),
      spec.subAgents.map((a) => a.name).sort(),
    );
    assert.equal(imported.workflows.length, spec.workflows.length);
    assert.equal(imported.connectors.mcpServers.length, spec.connectors.mcpServers.length);
    assert.equal(imported.triggers.length, spec.triggers.length);
  });
}

test('importing a foreign plugin keeps its README and reports leftovers', () => {
  const { spec, unhandled } = decompile([
    { path: '.claude-plugin/plugin.json', content: JSON.stringify({ name: 'other-tool', version: '2.1.0' }) },
    { path: 'README.md', content: '# Someone else\'s plugin\n\nHand-written docs.\n' },
    { path: 'commands/deploy.md', content: '# deploy\n' },
  ]);

  assert.equal(spec.meta.slug, 'other-tool');
  assert.equal(spec.meta.readme.mode, 'custom');
  assert.match(spec.meta.readme.body ?? '', /Hand-written docs/);
  assert.deepEqual(
    unhandled.map((u) => u.path),
    ['commands/deploy.md'],
  );
});
