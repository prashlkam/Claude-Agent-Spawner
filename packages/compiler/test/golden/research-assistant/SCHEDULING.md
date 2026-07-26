# Scheduling `weekly-research-brief`

A Claude Code plugin cannot schedule itself. This file describes the two supported ways to run this agent on a schedule, and the bundle ships `scripts/run.sh` for the second one.

## Requested schedules

| Cron | Timezone | Meaning | Prompt |
|---|---|---|---|

| `0 9 * * 1` | Europe/London | every Monday at 09:00 | Write this week's research brief on the topic in briefs/NEXT.md. |

## Option 1 — Claude Code scheduled tasks

If your Claude Code build has scheduled tasks (routines), create one per row above and paste the prompt in. This is the option to prefer: the run happens inside Claude Code with your normal settings, permissions and MCP connectors.

## Option 2 — your own cron or CI

Use the bundled wrapper. It runs Claude Code headlessly with this plugin's primary agent:

```bash
# every Monday at 09:00 (Europe/London)
0 9 * * 1 CRON_TZ=Europe/London "$CLAUDE_PLUGIN_ROOT/scripts/run.sh" 'Write this week'\''s research brief on the topic in briefs/NEXT.md.'
```

> The wrapper runs with whatever credentials and permissions the invoking shell has. Read `scripts/run.sh` before wiring it to anything automated.
