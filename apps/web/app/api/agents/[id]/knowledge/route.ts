import { NextResponse } from 'next/server';
import { newId } from '@agent-spawner/spec';
import { loadAgent, saveSpec } from '@/lib/agents.ts';
import { prisma } from '@/lib/db.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, getObject, putObject, removeObject } from '@/lib/storage.ts';

type Params = { params: Promise<{ id: string }> };

/** Upload a knowledge file: size and MIME are checked before anything touches disk. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const agent = await loadAgent(user.id, id);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new BadRequestError('No file was uploaded.');

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      );
    }
    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestError(`${mimeType} files are not accepted as knowledge.`);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await putObject(agent.id, bytes);

    await prisma.knowledgeFile.create({
      data: {
        agentId: agent.id,
        filename: file.name,
        mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        checksum: stored.checksum,
      },
    });

    const item = {
      id: newId('kn'),
      filename: file.name,
      mimeType,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
      purpose: '',
      loadStrategy: 'reference' as const,
    };
    const spec = { ...agent.spec, knowledge: [...agent.spec.knowledge, item] };
    const { revision } = await saveSpec(user.id, agent.id, spec, agent.revision, `Uploaded ${file.name}`);

    return NextResponse.json({ item, revision }, { status: 201 });
  });
}

/** Owner-only download. Files are never served from a shared, guessable path. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    await loadAgent(user.id, id);
    const storageKey = new URL(request.url).searchParams.get('key');
    if (!storageKey) throw new BadRequestError('A `key` is required.');

    const record = await prisma.knowledgeFile.findFirst({ where: { agentId: id, storageKey } });
    if (!record) throw new BadRequestError('That file does not belong to this agent.');

    const bytes = await getObject(storageKey);
    if (!bytes) throw new BadRequestError('The file is no longer in storage.');

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': record.mimeType,
        'Content-Disposition': `attachment; filename="${record.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const agent = await loadAgent(user.id, id);
    const storageKey = new URL(request.url).searchParams.get('key');
    if (!storageKey) throw new BadRequestError('A `key` is required.');

    const record = await prisma.knowledgeFile.findFirst({ where: { agentId: id, storageKey } });
    if (record) {
      await removeObject(storageKey);
      await prisma.knowledgeFile.delete({ where: { id: record.id } });
    }

    const spec = {
      ...agent.spec,
      knowledge: agent.spec.knowledge.filter((k) => k.storageKey !== storageKey),
    };
    const { revision } = await saveSpec(user.id, agent.id, spec, agent.revision, 'Removed a knowledge file');
    return { revision };
  });
}
