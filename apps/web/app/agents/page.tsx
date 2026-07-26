import Link from 'next/link';
import { listAgents } from '@/lib/agents.ts';
import { currentUser } from '@/lib/auth.ts';
import { AgentActions, NewAgentButton } from './actions.tsx';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const user = await currentUser();
  const agents = await listAgents(user.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Your agents</h1>
          <p className="mt-1 text-[13px] text-ink-600">
            Each one compiles to a standalone Claude Code plugin.
          </p>
        </div>
        <NewAgentButton />
      </header>

      {agents.length === 0 ? (
        <div className="card mt-8 px-6 py-14 text-center">
          <h2 className="text-[15px] font-semibold text-ink-900">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-600">
            Start with a goal — what should this agent accomplish? Everything else, from the
            sub-agents to the generated README, follows from that.
          </p>
          <div className="mt-5 flex justify-center">
            <NewAgentButton />
          </div>
        </div>
      ) : (
        <ul className="mt-8 space-y-2.5">
          {agents.map((agent) => (
            <li key={agent.id} className="card flex items-center gap-4 px-4 py-3.5">
              <Link href={`/agents/${agent.id}/goal`} className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-semibold text-ink-900">{agent.title}</span>
                  <span className="font-mono text-[11px] text-ink-400">v{agent.version}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-600">
                  {agent.description || 'No description yet.'}
                </span>
                <span className="mt-1.5 flex gap-3 text-[11.5px] text-ink-400">
                  <span>{agent.counts.workflows} workflows</span>
                  <span>{agent.counts.subAgents} sub-agents</span>
                  <span>{agent.counts.skills} skills</span>
                  <span>{agent.counts.connectors} connectors</span>
                </span>
              </Link>
              <AgentActions id={agent.id} title={agent.title} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
