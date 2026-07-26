import type { AgentSpec, MonitorTrigger } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { json } from '../util.ts';

/**
 * `monitors/monitors.json`.
 *
 * Monitors are an experimental Claude Code component. The emitter is deliberately isolated
 * behind `options.enableMonitors` so that if the shape moves, the conditional-trigger path
 * can fall back to hooks only without touching anything else (PLAN §14.3).
 */
export function emitMonitors(spec: AgentSpec, enabled: boolean): CompiledFile[] {
  if (!enabled) return [];

  const monitors = spec.triggers.filter(
    (t): t is MonitorTrigger => t.kind === 'conditional' && t.via === 'monitor',
  );
  if (monitors.length === 0) return [];

  return [
    {
      path: 'monitors/monitors.json',
      content: json({
        monitors: monitors.map((m) => ({
          name: m.config.name,
          check: { type: 'command', command: m.config.check },
          intervalSeconds: m.config.intervalSeconds,
          prompt: m.config.prompt,
        })),
      }),
    },
  ];
}
