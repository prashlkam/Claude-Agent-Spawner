import { compile, fileTree, validateL1 } from '@agent-spawner/compiler';
import { safeMigrateSpec } from '@agent-spawner/spec';
import { loadAgent } from '@/lib/agents.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

/**
 * The authoritative compile. The client runs the same code in a Web Worker for instant
 * feedback; this run is what export and deploy actually use.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const body = await request.json().catch(() => ({}));

    // An unsaved draft can be compiled directly, so the preview never lags behind the editor.
    let spec = (await loadAgent(user.id, id)).spec;
    if (body?.spec) {
      const parsed = safeMigrateSpec(body.spec);
      if (!parsed.ok) throw new BadRequestError(parsed.error);
      spec = parsed.spec;
    }

    const result = compile(spec);
    return {
      files: result.files,
      tree: fileTree(result.files),
      diagnostics: [...validateL1(spec), ...result.diagnostics],
    };
  });
}
