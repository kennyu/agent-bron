# Change: Connect to Claude Agent SDK

## Why
The current implementation uses a mock Claude client that returns static responses. This prevents the system from actually executing AI-driven tasks. Connecting to the real Claude Agent SDK enables autonomous task execution with built-in tools.

## What Changes
- Add `@anthropic-ai/claude-agent-sdk` dependency
- Create a `ClaudeAgentClient` service that wraps the SDK's `query()` function
- Replace the mock client in `apps/api/src/index.ts` with the real implementation
- Support session resumption via `resume` option for conversation continuity
- Support MCP server configuration for user integrations
- **Add SSE streaming endpoint** for interactive chat using Hono's `streamSSE` helper
- Background worker continues to use aggregated responses

## Impact
- Affected specs: None existing (new capability)
- Affected code:
  - `apps/api/src/index.ts` (replace mockClaudeClient)
  - `apps/api/src/services/claude-client.ts` (new file)
  - `apps/api/src/routes/conversations.ts` (add streaming endpoint)
  - `package.json` (add dependency)
  - Tests will need updates to mock the new client interface
