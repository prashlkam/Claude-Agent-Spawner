# Agent Spawner

Author a Claude agent in a guided, tabbed editor; compile it to a real, installable **Claude Code
plugin bundle**; download it as a zip or push it to your own GitHub repo as a marketplace.

Built to [`PLAN.md`](./PLAN.md).

---

## Run it

```bash
npm install
npm run db:push
npm run dev
```

Then open <http://localhost:3000>. No external services are needed: it ships on SQLite, uploads go
to a local `storage/` directory, and without OAuth credentials it runs as a single local user.

Tests:

```bash
npm test
```

42 tests: golden files, one case per validator rule, round-trip, and — when the `claude` CLI is on
PATH — the real `claude plugin validate` against every fixture.

---

## The architecture, in one paragraph

There is exactly one canonical data structure, the **`AgentSpec`**, and everything else is a
projection of it. The UI writes to the spec and never touches files. A pure `compile(spec)` turns it
into a file tree and never reads the UI. That single constraint is what makes the rest work: the
preview pane is the compiler run in a Web Worker on every keystroke, the export is the same compiler
run server-side, the importer is a decompiler against the same schema, and adding a tab means
extending the Zod schema and adding an emitter — nothing else.

```
                    ┌──────────────────────────────┐
   Tabbed UI  ◄────►│         AgentSpec            │────► compile() ────► file tree
   (8 tabs)         │  Zod, versioned, one JSON    │                        │
                    │  column, migrated on read    │                     ┌──┴───┐
                    └──────────────────────────────┘                    ZIP   GitHub
                              │        ▲
                         AI assist   Validator (L1 → L2 → L3)
```

### Layout

| Path | What it is |
|---|---|
| `packages/spec` | The Zod `AgentSpec`, the catalogues of what Claude Code accepts, and the migration chain |
| `packages/compiler` | `compile(spec) → files`. Pure: no I/O, no clock, no randomness. Twelve emitters + the L2 validator |
| `packages/decompiler` | `files → spec`. Imports an existing plugin back into the editor |
| `apps/web` | Next.js App Router, Prisma, the eight tabs, the live preview and the API |
| `workers/validate` | Containerised `claude plugin validate` (L3) |
| `workers/deploy` | GitHub App push, via the Git Data API |

---

## What it produces

A Claude Code plugin, laid out the way Claude Code expects:

```
<slug>/
├── .claude-plugin/
│   ├── plugin.json          # the ONLY manifest allowed in here
│   └── marketplace.json     # optional; makes the repo directly installable
├── agents/<slug>.md         # the orchestrator: Goal + Workflows compile to its prompt
├── agents/*.md              # one per sub-agent
├── skills/*/SKILL.md        # authored skills + promoted workflows
├── hooks/hooks.json         # conditional triggers
├── monitors/monitors.json   # conditional triggers (experimental, feature-flagged)
├── knowledge/               # uploaded reference files
├── scripts/                 # hook scripts + the scheduling wrapper
├── .mcp.json + .env.example # connectors, always as ${PLACEHOLDER}s
├── settings.json            # only `agent` + `subagentStatusLine` are honoured
├── SCHEDULING.md            # because a plugin cannot schedule itself
└── README.md · CHANGELOG.md · LICENSE
```

Output is deterministic: the same spec always produces byte-identical files and a byte-identical
zip (fixed entry order, fixed mtimes). That is what makes golden-file tests, clean git diffs on
deploy, and the preview's edit-to-edit diff all possible.

---

## Three things the app is deliberately honest about

These are places where the obvious UI would be a lie, so the app does something else instead.

**There is no "context window size" for a sub-agent.** No such field exists. What exists is the
model, `maxTurns`, `background`, `isolation: worktree`, and the fact that each sub-agent already
runs in its own context. The Sub-agents tab offers a *context budget* (Lean / Standard / Deep) that
sets those together, with the raw fields behind a disclosure — rather than a number input that
does nothing.

**Parallel vs. series is not configuration.** It is behaviour, and behaviour comes from prompt
language. The orchestration canvas compiles into explicit instructions in the primary agent's
prompt — *"Spawn `a` and `b` in the same tool block so they run concurrently"* — and every phrasing
the compiler can emit lives in one file (`packages/compiler/src/orchestration.ts`) so it can be
tuned centrally.

**Plugin-packaged agents cannot carry `hooks`, `mcpServers` or `permissionMode`.** Claude Code
rejects them for security reasons. The Sub-agents tab greys those fields out with an explanation,
the validator hard-fails if they leak in from an import, and the compiler writes the workaround
into the README instead of silently dropping them.

---

## Validation, in three layers

**L1 — Zod.** Instant, client and server. Types, required fields, kebab-case slugs, semver, cron
shape.

**L2 — semantic rules.** Instant, in the compiler. Nineteen rules covering the failures that parse
fine but do not work: a `tools` entry that resolves to nothing (the sub-agent silently fails to
launch), two agents compiling to the same file, a component file inside `.claude-plugin/`, a skill
description past the 1,536-character truncation, a live-looking credential in a connector default.
One test per rule, positive and negative.

**L3 — the real CLI.** On demand. The bundle is materialised and `claude plugin validate` runs
against it, preferably inside a container with no network, a read-only root, a non-root user and
CPU/memory/pid caps. Its output is parsed back into the same diagnostics drawer. This is ground
truth — it caught a real bug during development (`dependencies` was being emitted as an object map
where the CLI requires an array).

Diagnostics carry a spec path and a tab, so clicking one in the drawer navigates to the field that
caused it and highlights it.

---

## Security posture

- **Secrets are never entered, never stored, never emitted.** Connectors declare env var *names*,
  descriptions and a secret flag. `.mcp.json` only ever contains `${VAR}` placeholders. An entropy
  and known-prefix scan blocks export and deploy if something credential-shaped appears in a
  default or an argument.
- **Deployment uses a GitHub App, not a personal access token.** Only the `installation_id` is
  stored. An installation token is minted per operation, never persisted, never logged, never
  returned to the client. There is no PAT fallback.
- **Every deploy needs a fresh explicit confirmation** naming the repo, branch and visibility,
  after a file-level diff against what is on the branch.
- **Imported and pasted content is data.** A `SKILL.md` from a public repo is parsed, stored and
  rendered in a plain editor; nothing in it is executed, and it only reaches an AI assist inside an
  untrusted-content wrapper.
- **Uploads** are size- and MIME-checked before touching disk, stored under a per-agent prefix, and
  served only to the owner.
- **Every API route** resolves ownership through `lib/agents.ts`, so a new endpoint cannot forget
  the check.
- **Nothing is executed server-side.** Generated hook and install scripts are shown in the preview
  before export, and the README warns that they run on the installing user's machine.

---

## Configuration

Everything optional is off by default and degrades with an explanation rather than an error.

| Variable | Effect when unset |
|---|---|
| `DATABASE_URL` | required; defaults to `file:./dev.db` in `apps/web/.env` |
| `AUTH_SECRET` | required; signs the session cookie |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | single local user instead of GitHub sign-in |
| `ANTHROPIC_API_KEY` | the AI assists return 503 with a message; everything else works |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | the Deploy tab explains what to configure; zip export still works |
| `MCP_REGISTRY_URL` | the connector browser uses the seeded catalogue only |
| `VALIDATE_IMAGE` | `agent-spawner/validate:latest`; build it from `workers/validate/Dockerfile` |

The user's own Anthropic key is never collected. Nothing here runs an agent — the generated plugin
runs on the user's machine with their credentials.

### Postgres

The Prisma schema ships on SQLite so the app runs with no external services. Switching is a two-line
change: set `provider = "postgresql"` in `apps/web/prisma/schema.prisma` and point `DATABASE_URL`
at your database. The spec is stored as one serialised JSON document either way — deliberately, so
that the schema churn of the first months costs one `specVersion` migration rather than eight
relational ones.
