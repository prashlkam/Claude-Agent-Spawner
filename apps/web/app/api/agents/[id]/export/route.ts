import { NextResponse } from 'next/server';
import { loadAgent } from '@/lib/agents.ts';
import { blockingErrors, materialize, zipBundle } from '@/lib/bundle.ts';
import { withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

/**
 * Compile → validate → stream a zip. Errors block; warnings do not (PLAN §9).
 * The zip is built on demand and never stored.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const agent = await loadAgent(user.id, id);
    const { files, diagnostics } = await materialize(agent.spec);

    const errors = blockingErrors(diagnostics);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Fix the errors before exporting.', diagnostics: errors },
        { status: 422 },
      );
    }

    const zip = await zipBundle(agent.spec, files);
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${agent.spec.meta.slug}-${agent.spec.meta.version}.zip"`,
        'Content-Length': String(zip.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  });
}
