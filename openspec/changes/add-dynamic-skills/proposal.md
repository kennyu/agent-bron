# Change: Add Dynamic Skills System

## Why
The current Claude Agent implementation uses a fixed set of tools. Users cannot leverage specialized agent behaviors for different tasks. The SDK's native `agents` option allows defining subagents with specialized prompts and tool access - we should expose this capability.

## What Changes
- Add a skill registry config file with predefined skills (code-reviewer, file-editor, code-runner, researcher)
- Extend `ClaudeQueryOptions` to accept an `agents` option
- Pass agents to SDK's `query()` function
- Add API endpoint to list available skills

## Impact
- Affected specs: None existing (new capability)
- Affected code:
  - `apps/api/src/config/skills.ts` (new - skill definitions)
  - `apps/api/src/services/claude-client.ts` (add agents support)
  - `apps/api/src/routes/skills.ts` (new - list skills endpoint)
  - `packages/shared-types/src/index.ts` (add Skill type)
