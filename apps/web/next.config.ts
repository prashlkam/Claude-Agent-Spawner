import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace packages ship TypeScript source (no build step). Next compiles them
  // in-place, so the compiler is the same code in the browser worker and on the server.
  transpilePackages: ['@agent-spawner/spec', '@agent-spawner/compiler', '@agent-spawner/decompiler'],
  serverExternalPackages: ['archiver'],
  typedRoutes: false,
};

export default config;
