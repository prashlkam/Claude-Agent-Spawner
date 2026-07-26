import Link from 'next/link';

const PIPELINE = [
  { step: 'Author', body: 'Six tabs: goal, workflows, sub-agents, skills, connectors, packaging.' },
  { step: 'Compile', body: 'One pure function turns the spec into a plugin file tree, deterministically.' },
  { step: 'Validate', body: 'Schema, then semantic rules, then the real `claude plugin validate`.' },
  { step: 'Ship', body: 'Download the zip, or push it to your own GitHub repo as a marketplace.' },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-[13px] font-medium tracking-wide text-accent-600 uppercase">Agent Spawner</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink-950">
        Design a Claude agent. Get a real plugin.
      </h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-700">
        Everything you author lives in one canonical <code className="rounded bg-ink-100 px-1">AgentSpec</code>.
        The editor writes to it, and a pure compiler turns it into an installable Claude Code plugin
        bundle — the same code in the preview pane, in the export, and in the push to GitHub.
      </p>

      <Link href="/agents" className="btn-primary mt-8 px-4 py-2 text-sm">
        Open the editor →
      </Link>

      <ol className="mt-16 space-y-4">
        {PIPELINE.map((item, index) => (
          <li key={item.step} className="card flex gap-4 px-4 py-3.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-white">
              {index + 1}
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-ink-900">{item.step}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-600">{item.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
