import { notFound } from 'next/navigation';
import { loadAgent, NotFoundError } from '@/lib/agents.ts';
import { currentUser } from '@/lib/auth.ts';
import { EditorShell } from '@/components/editor/EditorShell.tsx';

export const dynamic = 'force-dynamic';

export default async function EditorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();

  try {
    const agent = await loadAgent(user.id, id);
    return (
      <EditorShell agentId={agent.id} spec={agent.spec} revision={agent.revision}>
        {children}
      </EditorShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
