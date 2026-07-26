# Sandbox for L3 validation. The image only needs the Claude Code CLI; the bundle under test
# is mounted read-only at run time and the container is started with `--network=none`,
# `--read-only`, a non-root user and CPU/memory/pid caps (see src/index.ts).
#
#   docker build -t agent-spawner/validate:latest workers/validate
FROM node:22-alpine

RUN npm install -g @anthropic-ai/claude-code

# Matches the --user=1000:1000 the runner passes.
USER node

ENTRYPOINT []
CMD ["claude", "--version"]
