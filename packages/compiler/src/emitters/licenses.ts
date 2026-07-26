import type { AgentMeta } from '@agent-spawner/spec';

/**
 * Full text for the short, unambiguous licenses. For everything else the compiler writes a
 * pointer rather than a paraphrase — a truncated license is worse than no license file.
 */
export function licenseText(meta: AgentMeta): string | null {
  const year = '2026';
  const holder = meta.author.name || meta.name;

  switch (meta.license) {
    case 'UNLICENSED':
      return null;

    case 'MIT':
      return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

    case 'Unlicense':
      return `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED. FOR MORE INFORMATION, PLEASE REFER TO <https://unlicense.org>
`;

    default:
      return `${meta.license}

Copyright (c) ${year} ${holder}

This plugin is licensed under ${meta.license}. The full license text was not bundled by
the generator; replace this file with the official text from
https://spdx.org/licenses/${meta.license}.html before publishing.
`;
  }
}
