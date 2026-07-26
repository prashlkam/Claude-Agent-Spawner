import type { AgentSpec } from '@agent-spawner/spec';
import { allSkills } from '../promote.ts';
import type { CompiledFile } from '../types.ts';
import { frontmatter, markdown, oneLine } from '../util.ts';

/**
 * `skills/<name>/SKILL.md` plus any supporting files.
 *
 * Supporting files are referenced from the body via `${CLAUDE_SKILL_DIR}` so that
 * `allowed-tools` rules match the exact command and the script runs without prompting.
 */
export function emitSkills(spec: AgentSpec): CompiledFile[] {
  const files: CompiledFile[] = [];

  for (const skill of allSkills(spec)) {
    const fm = frontmatter({
      name: skill.name,
      description: oneLine(skill.description),
      'when-to-use': oneLine(skill.whenToUse),
      'allowed-tools': skill.allowedTools,
      // Only written when they differ from the default, to keep frontmatter honest.
      'disable-model-invocation': skill.disableModelInvocation ? true : undefined,
      'user-invocable': skill.userInvocable ? undefined : false,
      model: skill.model,
      effort: skill.effort,
      context: skill.context,
      agent: skill.agent,
    });

    const supporting =
      skill.files.length > 0
        ? markdown([
            '## Supporting files',
            skill.files
              .map((f) => `- \`\${CLAUDE_SKILL_DIR}/${f.path}\``)
              .join('\n'),
          ])
        : null;

    files.push({
      path: `skills/${skill.name}/SKILL.md`,
      content: `${fm}\n${markdown([skill.body, supporting])}`,
    });

    for (const file of skill.files) {
      files.push({
        path: `skills/${skill.name}/${file.path}`,
        content: file.content,
        executable: file.path.endsWith('.sh'),
      });
    }
  }

  return files;
}
