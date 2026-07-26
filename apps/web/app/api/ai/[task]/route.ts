import { NextResponse } from 'next/server';
import { safeMigrateSpec } from '@agent-spawner/spec';
import type { AgentSpec } from '@agent-spawner/spec';
import {
  AiNotConfiguredError,
  RateLimitedError,
  describeSpec,
  isAiTask,
  runAiTask,
  untrusted,
} from '@/lib/ai.ts';
import type { AiTask } from '@/lib/ai.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ task: string }> };

export async function POST(request: Request, { params }: Params) {
  const { task } = await params;
  return withUser(async (user) => {
    if (!isAiTask(task)) throw new BadRequestError(`Unknown assist: ${task}`);

    const body = await request.json().catch(() => ({}));
    const parsed = safeMigrateSpec(body?.spec ?? {});
    if (!parsed.ok) throw new BadRequestError(parsed.error);

    try {
      const { result, cached } = await runAiTask(
        user.id,
        task,
        buildPrompt(task, parsed.spec, body),
      );
      return { result, cached };
    } catch (error) {
      if (error instanceof AiNotConfiguredError) {
        return NextResponse.json({ error: error.message, configured: false }, { status: 503 });
      }
      if (error instanceof RateLimitedError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }
  });
}

function buildPrompt(task: AiTask, spec: AgentSpec, body: Record<string, unknown>): string {
  switch (task) {
    case 'refine-goal':
      return `Refine this objective.\n\n${describeSpec(spec, ['goal'])}`;

    case 'suggest-workflows':
      return `Propose the workflows for this agent.\n\n${describeSpec(spec, ['goal'])}`;

    case 'decompose-subagents':
      return `Design the delegation structure.\n\n${describeSpec(spec, ['goal', 'workflows', 'connectors'])}`;

    case 'write-description':
      return [
        `Write the description for this ${String(body.kind ?? 'component')}.`,
        `Name: ${String(body.name ?? '(unnamed)')}`,
        body.context ? `What it does: ${String(body.context)}` : '',
        describeSpec(spec, ['goal']),
      ]
        .filter(Boolean)
        .join('\n\n');

    case 'suggest-connectors':
      return `Which MCP connectors does this agent need?\n\n${describeSpec(spec, ['goal', 'workflows'])}`;

    case 'draft-skill':
      return [
        'Draft a skill for this workflow.',
        `Workflow: ${String(body.title ?? '')}\n${String(body.description ?? '')}`,
        Array.isArray(body.steps) && body.steps.length > 0
          ? `Steps:\n${(body.steps as string[]).map((s) => `- ${s}`).join('\n')}`
          : '',
        describeSpec(spec, ['goal']),
      ]
        .filter(Boolean)
        .join('\n\n');

    case 'generate-readme':
      return `Write the README for this plugin.\n\nName: ${spec.meta.name}\nDescription: ${spec.meta.description}\n\n${describeSpec(spec, ['goal', 'workflows', 'agents', 'skills', 'connectors'])}`;

    case 'review-agent':
      // Imported specs can carry third-party prose, so the whole rendering is fenced as data.
      return untrusted(
        'agent-spec',
        describeSpec(spec, ['goal', 'workflows', 'agents', 'skills', 'connectors']),
      );
  }
}
