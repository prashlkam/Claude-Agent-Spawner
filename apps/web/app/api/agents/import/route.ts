import { NextResponse } from 'next/server';
import { decompile } from '@agent-spawner/decompiler';
import type { SourceFile } from '@agent-spawner/decompiler';
import { createAgent } from '@/lib/agents.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/**
 * Import an existing plugin back into the editor.
 *
 * Everything received here is untrusted content — a `SKILL.md` from a public repository can
 * contain anything, including text addressed to a model. It is parsed as data, stored as data,
 * and rendered in a plain editor. Nothing from it is executed and nothing from it is fed to an
 * AI assist without the untrusted-content wrapper (PLAN §11).
 */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = await request.json().catch(() => null);
    const files = body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestError('Send the plugin as `files: [{ path, content }]`.');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestError(`That bundle has ${files.length} files; the import limit is ${MAX_FILES}.`);
    }

    let total = 0;
    const sources: SourceFile[] = [];
    for (const entry of files) {
      if (typeof entry?.path !== 'string' || typeof entry?.content !== 'string') {
        throw new BadRequestError('Each file needs a string `path` and `content`.');
      }
      if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
        throw new BadRequestError(`Refusing a path that escapes the bundle root: ${entry.path}`);
      }
      total += entry.content.length;
      if (total > MAX_TOTAL_BYTES) throw new BadRequestError('That bundle is too large to import.');
      sources.push({ path: entry.path, content: entry.content });
    }

    const { spec, unhandled } = decompile(sources);
    const agent = await createAgent(user.id, spec);
    return NextResponse.json({ id: agent.id, unhandled }, { status: 201 });
  });
}
