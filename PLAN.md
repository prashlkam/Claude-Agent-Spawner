# Agent Spawner — Build Plan

A web app for authoring Claude Agents through a guided, tabbed editor, which compiles to a
real, installable **Claude Code plugin bundle** and can optionally deploy it to a GitHub repo.

- **Status:** planning
- **Date:** 2026-07-26
- **Stack:** Next.js (App Router) + TypeScript + Tailwind/shadcn + Prisma + Postgres
- **Primary output:** Claude Code plugin (`.claude-plugin/plugin.json` bundle), zipped
- **Deploy target (v1):** push bundle to a user-owned GitHub repo as an installable plugin marketplace

---

## 1. Core design decision

The single most important architectural choice: **there is exactly one canonical data structure,
the `AgentSpec`, and everything else is a projection of it.**

```
                    ┌──────────────────────────────┐
   Tabbed UI  ◄────►│         AgentSpec            │────► Compiler ────► File tree
   (6 tabs)         │  (Zod schema, versioned,     │                       │
                    │   JSON column in Postgres)   │                    ┌──┴───┐
                    └──────────────────────────────┘                    │      │
                              │        ▲                             ZIP    GitHub
                              │        │                            download  push
                         AI assist   Validator
```

The UI never writes files. The compiler never reads the UI. This means:

- Adding a tab = extending the Zod schema + adding an emitter, nothing else.
- The live preview pane is just the compiler run in-memory on every keystroke (debounced).
- Import (round-trip an existing plugin back into the editor) is a decompiler against the same schema.
- Spec versioning + migrations are a solved, single-place problem.

**Do not** let form components own file-generation logic. That is the failure mode this plan
exists to prevent.

---

## 2. Target artifact format (verified against docs, 2026-07-26)

The generated bundle is a Claude Code plugin. Layout:

```
<agent-slug>/
├── .claude-plugin/
│   └── plugin.json           # manifest — ONLY this file lives here
├── agents/                   # ← Sub-Agents tab + the primary orchestrator
│   ├── <agent-slug>.md       # primary agent; body = Goal + Workflows
│   ├── researcher.md
│   └── writer.md
├── skills/                   # ← Skills tab + promoted Workflows
│   └── weekly-report/
│       ├── SKILL.md
│       └── scripts/
├── hooks/
│   └── hooks.json            # ← conditional triggers
├── monitors/
│   └── monitors.json         # ← conditional triggers (experimental)
├── knowledge/                # ← Knowledge base / artefacts
├── scripts/                  # helper scripts referenced by hooks/skills
├── bin/                      # executables added to Bash PATH
├── .mcp.json                 # ← Connectors / Tools tab
├── settings.json             # plugin defaults — only `agent` + `subagentStatusLine` supported
├── README.md                 # ← Misc tab: readme/docs
├── CHANGELOG.md
└── LICENSE
```

> **Hard constraint:** everything except `plugin.json` must sit at the **plugin root**, not inside
> `.claude-plugin/`. The compiler must assert this; it is the #1 cause of plugins silently not loading.

> **Hard constraint:** a `CLAUDE.md` at plugin root is **not** loaded as context. Instructions must
> be carried by agents, skills, and hooks. The Goal tab therefore compiles into the primary agent's
> system prompt (and optionally a skill), never into a `CLAUDE.md`.

### 2.1 `plugin.json` schema

Only `name` is required. Fields the compiler emits:

| Field | Source |
|---|---|
| `name` | Misc tab → slug (kebab-case, no spaces) |
| `displayName` | Misc tab → Agent name |
| `version` | Misc tab → semver; **must be bumped for users to receive updates** |
| `description` | Misc tab → description |
| `author` | `{ name, email, url }` from user profile |
| `homepage`, `repository`, `license`, `keywords` | Misc tab |
| `skills`, `agents`, `commands`, `hooks`, `mcpServers` | omitted — rely on default auto-discovery paths |
| `dependencies` | Misc tab → other plugins required, optionally semver-constrained |
| `defaultEnabled` | Misc tab → set `false` for agents that cost money or reach external services |

If `version` is omitted, Claude Code falls back to the git commit SHA. The Misc tab should offer
both modes explicitly ("pinned release" vs "track every commit").

### 2.2 Subagent files (`agents/*.md`)

YAML frontmatter; body becomes the system prompt. Full field set:

`name`* · `description`* · `tools` · `disallowedTools` · `model` · `permissionMode` · `maxTurns` ·
`skills` · `mcpServers` · `hooks` · `memory` · `background` · `effort` · `isolation` · `color` ·
`initialPrompt`

> **Critical compiler rule:** plugin-shipped agents support only
> `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`,
> `memory`, `background`, `isolation`.
> `hooks`, `mcpServers`, and `permissionMode` are **rejected for security reasons** in plugin agents.
> The Sub-Agents tab must gray these out (with an explanatory tooltip) whenever the output target is
> a plugin, and the validator must hard-fail if they leak through. If a user needs per-agent MCP or
> permission modes, the compiler emits them into README instructions for the consuming project's
> `.claude/settings.json` instead.

Other field notes the UI must surface:
- `model`: `sonnet` | `opus` | `haiku` | `fable` | full ID (e.g. `claude-opus-5`) | `inherit` (default)
- `isolation`: only valid value is `worktree`
- `tools` supports MCP patterns: `mcp__<server>` / `mcp__<server>__*`
- `disallowedTools` is applied **first**, then `tools` resolves against what remains; a tool in both is removed
- If nothing in `tools` resolves, the subagent fails to launch — validator must check every entry
- `Agent(worker, researcher)` allowlist syntax only applies to a main-thread agent (`claude --agent`), not to nested subagents

### 2.3 Skill files (`skills/<name>/SKILL.md`)

Frontmatter fields: `name`, `description`, `allowed-tools`, `disable-model-invocation`,
`user-invocable`, `model`, `effort`, `context` (`fork`), `agent`.

- `description` decides when Claude auto-loads the skill. Combined `description` + `when_to_use`
  is **truncated at 1,536 characters** in the skill listing — the editor needs a live character
  counter and should put the key use case first.
- `disable-model-invocation: true` → manual `/name` only; also blocks preloading into subagents
  and blocks scheduled-task invocation.
- `user-invocable: false` → hidden from the `/` menu; background knowledge only.
- `context: fork` + `agent: <type>` → run the skill in a forked subagent context.
- Supporting files live beside `SKILL.md`; reference them via `${CLAUDE_SKILL_DIR}` so
  `allowed-tools` rules match the exact command and the script runs without prompting.

### 2.4 `.mcp.json`

```json
{ "mcpServers": { "github": { "command": "npx", "args": ["..."], "env": { "TOKEN": "${GITHUB_TOKEN}" } } } }
```

**Never bake secrets.** The compiler always emits `${ENV_VAR}` placeholders plus a generated
`.env.example` and a README section. Where the connector needs a user-supplied token, prefer the
plugin `userConfig` mechanism so Claude Code prompts the user at enable-time.

### 2.5 Plugin `settings.json`

Only `agent` and `subagentStatusLine` are honoured. The compiler uses `agent` to make the primary
orchestrator the default main-session agent. Permissions **cannot** ship here — they go in the
consuming project's `.claude/settings.json`, so the compiler emits a copy-pasteable
`permissions.allow` / `permissions.deny` block into the README.

---

## 3. The `AgentSpec` schema

One Zod schema in `packages/spec/`, imported by both the Next.js forms (via `react-hook-form` +
`zodResolver`) and the compiler. Versioned with `specVersion` and a migration chain.

```ts
AgentSpec = {
  specVersion: 1,

  // ── Misc tab ────────────────────────────────────────────────
  meta: {
    name, slug, description, version, versionMode: 'pinned'|'commit-sha',
    author: { name, email, url }, license, keywords[], homepage, repository,
    defaultEnabled: boolean,
    readme: { mode: 'generated'|'custom', body?: string },
  },

  // ── Goal tab ────────────────────────────────────────────────
  goal: {
    statement: string,           // the broad goal, free text
    successCriteria: string[],   // how "done" is judged
    outOfScope: string[],        // explicit non-goals — big quality win on prompts
    tone?: string,
    primaryModel: ModelRef,
    primaryEffort?: 'low'|'medium'|'high'|'xhigh'|'max',
  },

  // ── Workflows tab ───────────────────────────────────────────
  workflows: Array<{
    id, title, description,
    order: number,
    steps?: string[],
    promoteToSkill: boolean,     // ← the "repetitive → Skill" toggle
    skillOverrides?: Partial<SkillSpec>,
    assignedSubAgentIds: string[],
  }>,

  // ── Sub-Agents tab ──────────────────────────────────────────
  subAgents: Array<{
    id, name, description,       // description drives delegation
    systemPrompt: string,
    taskIds: string[],           // ← workflows assigned to this sub-agent
    trigger: { kind: 'auto'|'explicit'|'always-background' },
    tools: { mode: 'inherit'|'allowlist', allow?: string[], deny?: string[] },
    runtime: {
      model: ModelRef, effort?, maxTurns?: number,
      background?: boolean, isolation?: 'worktree',
      memory?: 'user'|'project'|'local',
    },
    preloadSkillIds: string[],
    color?: Color,
  }>,
  orchestration: {
    groups: Array<{ mode: 'parallel'|'series', subAgentIds: string[], order: number }>,
    joinPolicy?: string,         // what the orchestrator does with the results
  },

  // ── Skills tab ──────────────────────────────────────────────
  skills: Array<{
    id, source: 'new'|'attached',
    name, description, whenToUse?, body: string,
    allowedTools: string[],
    disableModelInvocation: boolean,
    userInvocable: boolean,
    model?: ModelRef, effort?,
    context?: 'fork', agent?: string,
    files: Array<{ path, content }>,   // supporting files under the skill dir
  }>,

  // ── Connectors / Tools tab ──────────────────────────────────
  connectors: {
    mcpServers: Array<{
      key, transport: 'stdio'|'http'|'sse',
      command?, args?[], url?,
      env: Array<{ name, required: boolean, description, secret: boolean }>,
      toolAllowlist?: string[],
      source: 'registry'|'custom',
    }>,
    builtinTools: { allow: string[], deny: string[] },
    permissionsHint: { allow: string[], deny: string[] },  // → README snippet
  },

  // ── Misc tab (cont.) ────────────────────────────────────────
  triggers: Array<
    | { kind: 'manual', invocation: 'slash-command'|'agent-flag' }
    | { kind: 'scheduled', cron: string, timezone: string, prompt: string }
    | { kind: 'conditional', via: 'hook', event: HookEvent, matcher?, command }
    | { kind: 'conditional', via: 'monitor', config: MonitorSpec }
  >,

  knowledge: Array<{
    id, filename, mimeType, sizeBytes, storageKey,
    purpose: string,             // written into README + referencing skill
    loadStrategy: 'reference'|'preload-skill',
  }>,

  packaging: {
    format: 'plugin-zip',
    includeMarketplaceManifest: boolean,
    includeInstallScript: boolean,
  },

  deployment?: {
    target: 'github',
    repo: { owner, name, visibility: 'public'|'private' },
    branch: string,
    asMarketplace: boolean,
  },
}
```

### Honesty notes the UI must carry

Two things the user asked for do **not** have declarative fields, and inventing them would produce
a broken plugin. The plan handles them explicitly:

1. **"Context window size" runtime constraint.** There is no context-window field on a subagent.
   The real levers are: `model` (different context sizes), `maxTurns`, `background`, `isolation:
   worktree`, and the inherent fact that each subagent runs in its **own** context window. The
   Sub-Agents tab presents a "Context budget" control that maps to these levers and shows an
   explainer, rather than a fake number input.

2. **Parallel vs. series.** Not a config field. It is emitted as explicit orchestration language in
   the primary agent's system prompt — e.g. *"Spawn `researcher` and `scanner` in the same tool
   block so they run concurrently"* for parallel, and *"Wait for `researcher` to return before
   spawning `writer`; pass its summary in the prompt"* for series. The compiler owns these
   phrasings in one template file so they can be tuned centrally.

---

## 4. The compiler

`packages/compiler/` — pure functions, zero I/O, fully unit-testable.

```ts
compile(spec: AgentSpec): { files: Map<path, string|Buffer>, warnings: Diagnostic[] }
```

Emitter modules, one per output artifact:

| Emitter | Reads | Writes |
|---|---|---|
| `manifest.ts` | `meta`, `packaging` | `.claude-plugin/plugin.json` |
| `primaryAgent.ts` | `goal`, `workflows`, `orchestration`, `subAgents` | `agents/<slug>.md` |
| `subAgents.ts` | `subAgents`, `workflows` | `agents/*.md` |
| `skills.ts` | `skills`, promoted `workflows` | `skills/*/SKILL.md` + files |
| `mcp.ts` | `connectors` | `.mcp.json`, `.env.example` |
| `hooks.ts` | `triggers` (hook kind) | `hooks/hooks.json`, `scripts/*` |
| `monitors.ts` | `triggers` (monitor kind) | `monitors/monitors.json` |
| `schedule.ts` | `triggers` (scheduled kind) | `SCHEDULING.md` + routine config |
| `knowledge.ts` | `knowledge` | `knowledge/*`, index skill |
| `settings.ts` | `goal`, `meta` | `settings.json` (`agent` key only) |
| `docs.ts` | everything | `README.md`, `CHANGELOG.md`, `LICENSE` |
| `marketplace.ts` | `deployment` | `.claude-plugin/marketplace.json` |

### 4.1 Primary agent prompt assembly

`agents/<slug>.md` is where the Goal and Workflows tabs land. Deterministic section order:

```markdown
---
name: <slug>
description: <meta.description>
model: <goal.primaryModel>
effort: <goal.primaryEffort>
tools: Agent, <builtin allowlist>, <mcp patterns>
skills: <preloaded skill names>
---

# Objective
<goal.statement>

## Success criteria
- <goal.successCriteria[]>

## Out of scope
- <goal.outOfScope[]>

# Workflow
1. **<workflow.title>** — <workflow.description>
   <steps, if any>
   Delegate to: `<subagent names>`
   (or, if promoted:) Run `/<skill-name>`.

# Delegation
<generated parallel/series orchestration language from `orchestration.groups`>

# Available connectors
<one line per MCP server: what it is for, which tools>

# Knowledge
<knowledge items with paths under ${CLAUDE_PLUGIN_ROOT}/knowledge/>
```

Deterministic output matters: identical spec ⇒ byte-identical files, so the GitHub push produces
clean, reviewable diffs and the preview pane can diff between edits.

### 4.2 Workflow → Skill promotion

When `promoteToSkill` flips on, the workflow's title/description/steps become a `SKILL.md`, and
the primary agent's Workflow section replaces the inline steps with `Run /<skill-name>`. Flipping
it off inlines the steps back. Preserve any hand-edited skill body across toggles (keep it in
`skillOverrides`) so users don't lose work — a small detail that decides whether the feature feels
trustworthy.

### 4.3 Trigger compilation

| Trigger | Emits |
|---|---|
| Manual | `/`-invocable skill wrapping the goal + README instructions for `claude --agent <slug>` |
| Scheduled | Cron is not a plugin component. Emit `SCHEDULING.md` with the exact routine/scheduled-task setup, plus a `scripts/run.sh` wrapper for the user's own cron/CI |
| Conditional (hook) | `hooks/hooks.json` entry with event + matcher + `scripts/<name>.sh` stub |
| Conditional (monitor) | `monitors/monitors.json` — flagged **experimental** in the UI |

Note: plugin-shipped **agents** can't carry `hooks`, but the plugin can ship `hooks/hooks.json` at
root. That distinction must be encoded in the validator.

---

## 5. Validator

Runs in three layers — cheap ones live, expensive one on demand.

**L1 — Zod (instant, client + server).** Types, required fields, slug format (kebab-case),
semver, cron syntax, reserved names.

**L2 — Semantic rules (instant, in the compiler).** The rules that actually save users:

- Plugin agents must not carry `hooks` / `mcpServers` / `permissionMode`
- Every `tools` entry resolves to a real tool or MCP pattern (else the subagent fails to launch)
- `disallowedTools` ∩ `tools` → warn (tool is removed)
- `description` + `whenToUse` ≤ 1,536 chars per skill — warn with counter
- Every workflow is assigned to at least one sub-agent, or is explicitly primary-agent work
- No component files inside `.claude-plugin/`
- No orphan sub-agents (defined but never delegated to)
- `orchestration.groups` covers every sub-agent exactly once
- No literal secret-looking values in `.mcp.json` env (entropy + known-prefix check: `sk-`, `ghp_`, `xoxb-`)
- `isolation: worktree` only
- If `versionMode: 'pinned'`, warn on export that the version must be bumped for users to get updates

**L3 — Real CLI validation (on demand, sandboxed job).** Materialize the bundle in a container and
run `claude plugin validate`. This is the ground truth; parse its output back into diagnostics
anchored to spec fields. Gate the deploy button on L3 passing.

---

## 6. Web app architecture

```
apps/web/                      Next.js App Router
  app/
    (marketing)/               landing
    (app)/
      agents/                  list, duplicate, delete
      agents/[id]/
        layout.tsx             tab shell + live preview pane + validation drawer
        goal/page.tsx
        workflows/page.tsx
        sub-agents/page.tsx
        skills/page.tsx
        connectors/page.tsx
        misc/page.tsx
        preview/page.tsx       full-screen file tree + editor
        deploy/page.tsx
    api/
      agents/[id]/compile      POST → in-memory compile, returns file tree
      agents/[id]/export       POST → streams .zip
      agents/[id]/validate     POST → enqueue L3 job
      agents/[id]/deploy       POST → GitHub push job
      ai/[task]                POST → streamed Claude API assists
      connectors/search        GET  → MCP registry proxy
      webhooks/github          POST
packages/
  spec/                        Zod AgentSpec + migrations
  compiler/                    spec → files
  decompiler/                  files → spec (import existing plugins)
  ui/                          shared components
workers/
  validate/                    containerized `claude plugin validate`
  deploy/                      GitHub push
```

### 6.1 State management

- `AgentSpec` is a single JSON column (`agents.spec`), not shredded across tables. Reason: the
  schema will churn heavily in the first months; migrations on one JSON column with a
  `specVersion` migrator is far cheaper than 8 relational migrations per change.
- Client: one `react-hook-form` per tab, all bound to slices of the same Zustand store holding the
  draft spec. Autosave debounced 800 ms → `PATCH /api/agents/[id]`.
- Optimistic concurrency via `agents.revision`; reject stale writes with a 409 and a merge prompt.
- Every save appends to `agent_versions` (spec snapshot + label) → free undo history and diffing.

### 6.2 Live preview

Right-hand pane, always visible, three modes: **Tree**, **File** (CodeMirror, read-only, syntax
highlighted), **Diff** (vs. last saved version). The compiler runs client-side in a Web Worker for
sub-100 ms feedback; the server compile is authoritative for export. Same code, both places —
that's the payoff of a pure compiler.

### 6.3 Database (Prisma / Postgres)

```
User(id, email, name, avatarUrl, createdAt)
Agent(id, userId, slug, title, spec Json, revision, specVersion, createdAt, updatedAt)
AgentVersion(id, agentId, revision, spec Json, label, createdAt)
KnowledgeFile(id, agentId, filename, mimeType, sizeBytes, storageKey, checksum)
SkillLibraryItem(id, userId|null, name, description, body, files Json, isPublic)
ConnectorTemplate(id, key, displayName, transport, command, args, envSchema Json, docsUrl)
ValidationRun(id, agentId, status, diagnostics Json, cliOutput, createdAt)
Deployment(id, agentId, target, repoFullName, branch, commitSha, status, logs, createdAt)
GitHubInstallation(id, userId, installationId, accountLogin, encryptedToken?)
```

Knowledge files go to S3-compatible object storage; only metadata in Postgres.

---

## 7. Tab-by-tab UI specification

### 7.1 Goal tab

- Large textarea for the goal statement, with an inline "Refine with Claude" action that rewrites
  it into a crisp objective (streamed, always shown as a diff the user accepts or rejects).
- Repeatable lists for success criteria and out-of-scope items. Out-of-scope is unusual in agent
  builders and is one of the highest-leverage prompt inputs — keep it prominent.
- Model + effort pickers with a plain-language cost/latency note.
- **"Suggest workflows from this goal"** button → calls Claude, returns 3–7 draft workflows,
  drops them into the Workflows tab as unconfirmed cards the user accepts individually.

### 7.2 Workflows tab

- Drag-reorderable cards; each has title, description, optional step list.
- Per card: **assigned sub-agents** (multi-select, creates one inline if none exist) and a
  **"Convert to Skill"** toggle.
- Toggling on opens a slide-over prefilled with the generated `SKILL.md`, editable, with the
  1,536-char description counter.
- A "repetition detector" runs client-side on blur: flags workflows with high text similarity or
  that reference the same tools/steps, and suggests promotion. This is the feature that makes the
  tab feel smart; keep it as a suggestion chip, never automatic.
- Empty state links back to the Goal tab's suggestion button.

### 7.3 Sub-Agents tab

- Split view: list of sub-agents on the left, editor on the right.
- Editor sections: **Identity** (name, description — with a note that `description` is what drives
  delegation, so it must say *when* to use this agent), **System prompt**, **Tasks** (workflow
  multi-select, mirrored with the Workflows tab), **Tools** (inherit vs. allowlist; MCP servers
  shown as `mcp__<server>` chips; deny list), **Runtime** (model, effort, maxTurns, background,
  isolation, memory scope), **Preloaded skills**.
- Fields unsupported for plugin agents (`permissionMode`, per-agent `mcpServers`, per-agent
  `hooks`) render disabled with a "not available in plugin-packaged agents" tooltip and a link to
  the README workaround.
- **Orchestration canvas** below the list: horizontal lanes for series stages, sub-agents stacked
  within a lane run in parallel. Drag between lanes. This compiles directly to
  `orchestration.groups` and is far clearer than a form.
- Context budget control (see §3 honesty notes) — a segmented control (Lean / Standard / Deep)
  that sets model + maxTurns + background/isolation together, with an "advanced" disclosure for
  the raw fields.

### 7.4 Skills tab

- Two sources: **Create new** (name, description, when-to-use, body editor, supporting files,
  invocation controls) and **Attach existing** (from the user's `SkillLibraryItem` library, or
  paste/upload a `SKILL.md`, or import from a public repo URL).
- Skills promoted from workflows appear here with a "from workflow" badge and a link back.
- Invocation controls presented as three plain-English radio options rather than two booleans:
  *Claude decides when to use it* / *Only when I type `/name`* / *Background knowledge, hidden from menu*
  → maps to `disable-model-invocation` / `user-invocable`.
- Supporting-file editor with a note to reference files via `${CLAUDE_SKILL_DIR}`.
- "Save to my library" on any skill.

### 7.5 Connectors / Tools tab

- **Browse registry**: searchable list of known MCP servers from the MCP registry, each with a
  card showing transport, required env vars, and docs link. Seeded into `ConnectorTemplate`.
- **Custom server**: manual `command` / `args` / `url` / env-var form.
- **Suggest connectors**: Claude reads the goal + workflows and proposes servers, with reasoning.
- **Built-in tools**: allow/deny matrix across Read, Write, Edit, Bash, Glob, Grep, WebFetch,
  WebSearch, Agent, Skill, etc., with a "principle of least privilege" nudge when Bash or Write is
  granted broadly.
- **Secrets are never entered here.** Each env var is declared with name + description + `secret`
  flag; the UI shows exactly what the consumer will be asked for and previews the generated
  `.env.example`. A blocking validation error fires if a value that looks like a live credential
  is typed into a default.
- Generated `permissions.allow` / `permissions.deny` snippet previewed, with a copy button and an
  explanation that plugin `settings.json` cannot carry permissions.

### 7.6 Misc tab

Accordion sections:

1. **Identity** — name, slug (auto from name, editable, kebab-case validated), description,
   version + version mode, license, keywords, homepage, repository, `defaultEnabled`.
2. **Triggers** — repeatable trigger builder. Manual / Scheduled (cron builder with human-readable
   preview and timezone) / Conditional (hook event + matcher + command, or monitor config marked
   experimental). Each trigger shows exactly which file it will produce.
3. **Docs** — README: generated (live preview, from every other tab) or custom (markdown editor
   seeded from the generated version). Changelog entry for this version.
4. **Knowledge base / artefacts** — drag-drop upload, per-file purpose field, and load strategy
   (referenced by path vs. preloaded via a generated index skill). Size warnings, because preloading
   large files is the fastest way to make an agent slow and expensive.
5. **Packaging** — format (plugin zip), include marketplace manifest, include install script.
   Shows the final file tree and total size. **Export** button.
6. **Dependencies** — other plugins required, with optional semver constraints.

---

## 8. AI assistance (Claude API, server-side)

Every assist is a streamed, **suggest-then-accept** interaction — never a silent mutation of the
user's spec. Endpoints under `/api/ai/*`:

| Task | Input | Output |
|---|---|---|
| `refine-goal` | goal statement | tightened objective + criteria + out-of-scope |
| `suggest-workflows` | goal | 3–7 workflow drafts |
| `decompose-subagents` | goal + workflows | proposed sub-agents, task assignment, parallel/series grouping |
| `write-description` | any component | a delegation-quality `description` (the field that most affects behaviour) |
| `suggest-connectors` | goal + workflows | MCP servers + reasoning |
| `draft-skill` | workflow | `SKILL.md` body |
| `generate-readme` | full spec | README |
| `review-agent` | full spec | critique: gaps, over-broad permissions, vague prompts |

Use the current Claude models (`claude-opus-5` for decomposition and review, `claude-sonnet-5` for
the shorter generative tasks). Structured output via tool-use schemas that mirror the Zod types, so
responses land in the spec without parsing prose. Rate-limit per user; cache by input hash.

---

## 9. Packaging & export

1. Server compiles the spec (authoritative run).
2. L1 + L2 validation; block on errors, allow with warnings.
3. Stream a zip built with `archiver` — the plugin directory rooted at `<slug>/`.
4. Optional extras:
   - `.claude-plugin/marketplace.json` so the repo is directly installable as a marketplace
   - `install.sh` that copies into the target project or `~/.claude/`
   - `.env.example`
5. Zips are generated on demand, not stored. Reproducible: same spec ⇒ same bytes (fixed file
   ordering, fixed mtimes).

---

## 10. Deployment (v1: GitHub push)

**Flow.** Connect GitHub (GitHub App, not a raw PAT) → pick or create repo → choose branch and
visibility → preview the diff → push.

**Why a GitHub App:** installation tokens are short-lived and scoped to selected repositories, so
the app never holds a long-lived credential that can touch the user's whole account. This is the
single most important security decision in the project.

**Credential handling (non-negotiable rules):**

- Store only the `installation_id`. Mint an installation access token per operation; never persist it.
- If a PAT fallback is ever added, encrypt with envelope encryption (KMS-backed data key), never log
  it, never return it to the client, and show last-4 only.
- The user's Anthropic API key is **never** collected in v1. Nothing in this scope runs an agent
  server-side; the generated plugin runs on the user's own machine with their own credentials.
- Connector secrets are never stored — only env var *names* and descriptions live in the spec.
- Every deploy is preceded by an explicit confirmation showing repo, branch, visibility, and file
  diff. Pushing to a repo is outward-facing and irreversible-ish; it always requires a fresh click.

**Push job** (`workers/deploy`): compile → run L3 validation → clone or init → write tree →
commit with a generated message → push → optionally create a release tag matching `meta.version` →
record `Deployment` row with commit SHA → surface the `/plugin marketplace add <owner>/<repo>`
command to the user.

**Deferred to v2 (designed for, not built):** hosted runtime execution (needs a KMS-backed vault
for customer Anthropic keys, per-tenant sandboxing, and usage metering) and direct install into a
local machine via a companion CLI.

---

## 11. Security posture

| Risk | Mitigation |
|---|---|
| Secrets committed to a public repo | Entropy + known-prefix scan on every compile; hard block on export and deploy |
| Generated hook/bin scripts run arbitrary code on install | Scripts are shown in the preview pane before export; README warns; never auto-execute anything server-side |
| Imported/pasted `SKILL.md` containing prompt injection | Treat all imported content as data. Render in a plain editor, never execute, never feed into an AI assist without a "this is untrusted user content" wrapper |
| L3 validation runs untrusted plugin content | Containerized, no network, read-only mount, CPU/mem/time capped, non-root |
| Uploaded knowledge files | Size + MIME allowlist, virus scan, served only to the owner via signed URLs |
| Over-broad tool grants in generated agents | Validator warns on `Bash` + `Write` with no deny rules; README documents the least-privilege alternative |
| Multi-tenant data leakage | Row-level ownership checks in every API route; no shared object-storage prefixes |

---

## 12. Build phases

**Phase 0 — Foundations (week 1)**
Repo scaffold (Turborepo), Next.js + Tailwind + shadcn, Prisma + Postgres, auth (GitHub OAuth),
`packages/spec` with the v1 Zod schema and a stub compiler. Deliverable: create an agent, edit the
Misc tab, see JSON persist.

**Phase 1 — Compiler + preview (week 2)**
All emitters, deterministic output, golden-file tests (fixture spec ⇒ expected file tree, byte
compared). Web Worker client compile. Preview pane with tree/file/diff. Deliverable: a spec
produces a correct plugin bundle.

**Phase 2 — The six tabs (weeks 3–4)**
Goal, Workflows (incl. skill promotion), Sub-Agents (incl. orchestration canvas), Skills,
Connectors, Misc. L1 + L2 validation wired to a diagnostics drawer with click-to-field anchoring.
Deliverable: the full authoring experience.

**Phase 3 — Export + validation (week 5)**
Zip export, `.env.example`, install script, marketplace manifest. Containerized L3
`claude plugin validate` worker. Deliverable: download a bundle that installs cleanly in Claude Code.

**Phase 4 — AI assistance (week 6)**
All `/api/ai/*` tasks with structured output and suggest-then-accept UX.

**Phase 5 — Deploy (week 7)**
GitHub App, repo picker, diff preview, push worker, deployment history, marketplace instructions.

**Phase 6 — Library + import (week 8)**
Skill library, connector templates seeded from the MCP registry, agent templates
(research assistant, code reviewer, report generator), and the decompiler for importing an existing
plugin back into the editor.

---

## 13. Testing strategy

- **Golden-file compiler tests** — the backbone. A directory of fixture specs, each with an
  expected output tree checked into the repo. Any compiler change shows up as a reviewable diff.
- **Round-trip tests** — `decompile(compile(spec))` ≡ `spec` for every fixture.
- **Validator unit tests** — one case per L2 rule, positive and negative.
- **Integration** — for each fixture, run the real `claude plugin validate` in CI; a template that
  fails validation fails the build.
- **E2E (Playwright)** — build an agent through the UI, export, unzip, assert the tree.
- **AI assist tests** — schema-conformance only (structured output parses into the Zod types); do
  not assert on model prose.

---

## 14. Open questions

1. **Marketplace hosting** — should the app also host a public gallery of published agents, or only
   push to user repos? Affects moderation scope significantly; recommend repo-only for v1.
2. **Team accounts** — shared skill libraries and connector templates are clearly useful, but multi-
   tenancy is cheaper to add now than to retrofit. Recommend: model `SkillLibraryItem.orgId` as
   nullable from day one, ship personal-only.
3. **Monitors** are an experimental Claude Code component; if the API shifts, the conditional-trigger
   path may need to fall back to hooks only. Keep the emitter isolated behind a feature flag.
4. **Agent SDK output target** — deliberately out of v1 scope, but the compiler's emitter structure
   should keep an `sdk-project` target plausible: the `AgentSpec` already carries everything needed.
5. **Spec migrations** — decide now whether old `AgentVersion` snapshots are migrated eagerly on
   deploy or lazily on read. Recommend lazy, with the migrator in `packages/spec`.

---

## 15. Definition of done for v1

A user can, in one sitting: state a goal, accept AI-suggested workflows, promote one to a skill,
define two sub-agents running in parallel followed by a third in series, attach an MCP connector
with declared (not embedded) credentials, upload a reference document, write a schedule trigger,
review the generated file tree, download a zip, and push it to their own GitHub repo — then run
`/plugin marketplace add <owner>/<repo>` in Claude Code and have the agent work.
