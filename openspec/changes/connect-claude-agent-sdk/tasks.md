# Tasks: Connect Claude Agent SDK

## 1. Setup
- [x] 1.1 Add `@anthropic-ai/claude-agent-sdk` to package.json dependencies
- [x] 1.2 Add `ANTHROPIC_API_KEY` to environment configuration

## 2. Claude Client Implementation
- [x] 2.1 Create `apps/api/src/services/claude-client.ts` with `ClaudeAgentClient` class
- [x] 2.2 Implement `run()` method for aggregated responses (background worker)
- [x] 2.3 Implement `stream()` method that yields SDK messages (interactive chat)
- [x] 2.4 Handle session ID extraction from `init` messages
- [x] 2.5 Support MCP server configuration passthrough
- [x] 2.6 Handle errors and timeouts gracefully

## 3. SSE Streaming Endpoint
- [x] 3.1 Add `POST /conversations/:id/messages/stream` endpoint
- [x] 3.2 Use Hono's `streamSSE` helper to stream responses
- [x] 3.3 Map SDK message types to SSE events (init, assistant, tool_use, done, error)
- [x] 3.4 Save final response and session ID to database after stream completes

## 4. Integration
- [x] 4.1 Update `apps/api/src/index.ts` to use `ClaudeAgentClient` when API key is available
- [x] 4.2 Keep mock client as fallback for development without API key
- [x] 4.3 Update `ClaudeCodeClient` interface to match actual SDK types

## 5. Testing
- [ ] 5.1 Create unit tests for `ClaudeAgentClient` with mocked SDK
- [ ] 5.2 Create tests for SSE streaming endpoint
- [ ] 5.3 Update existing tests to work with new client interface
- [ ] 5.4 Add integration test that verifies real SDK connection (skip in CI without key)

## 6. Documentation
- [ ] 6.1 Update README with `ANTHROPIC_API_KEY` setup instructions
- [ ] 6.2 Document SSE endpoint and event types for frontend integration
