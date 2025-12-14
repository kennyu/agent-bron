# Design: Connect Claude Agent SDK

## Context
The system currently uses a mock Claude client (`mockClaudeClient` in `apps/api/src/index.ts:256-266`) that returns static responses. The real Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides:
- Built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch)
- Session management with `resume` option
- MCP server integration
- Streaming responses via async iterators

**Constraints:**
- Must maintain the existing `ClaudeCodeClient` interface for compatibility
- Must handle streaming responses and aggregate into a single response
- Must support session resumption for conversation continuity
- Requires `ANTHROPIC_API_KEY` environment variable

## Goals / Non-Goals

### Goals
- Replace mock client with real Claude Agent SDK
- Maintain existing API contract (`run()` method returning `{ response, sessionId }`)
- Support MCP configuration passthrough for user integrations
- Handle errors gracefully with meaningful error messages

### Non-Goals
- Streaming responses to the frontend (aggregated response is sufficient for MVP)
- Custom tool implementations (use SDK's built-in tools)
- Multiple concurrent sessions per user (one session per conversation)

## Decisions

### Decision 1: Wrap SDK's `query()` in a class
Create a `ClaudeAgentClient` class that wraps the SDK's `query()` function and implements the existing `ClaudeCodeClient` interface.

**Rationale:** Maintains backward compatibility with existing code, centralizes SDK configuration.

**Interface:**
```typescript
interface ClaudeCodeClient {
  run(options: {
    prompt: string;
    systemPrompt: string;
    sessionId?: string;
    mcpConfig?: Record<string, McpServerConfig>;
    timeout?: number;
  }): Promise<{
    response: string;
    sessionId: string;
  }>;
}
```

### Decision 2: Dual response modes (streaming and aggregated)
The SDK returns an async iterator of messages. Support both:
- **Streaming (SSE)** for interactive chat - real-time user experience
- **Aggregated** for background worker - simpler processing

**Streaming endpoint:** `POST /conversations/:id/messages/stream`

Uses Hono's `streamSSE` helper:
```typescript
import { streamSSE } from 'hono/streaming';

app.post('/conversations/:id/messages/stream', (c) => {
  return streamSSE(c, async (stream) => {
    for await (const message of query({ prompt, options })) {
      await stream.writeSSE({
        event: message.type,
        data: JSON.stringify(message)
      });
    }
  });
});
```

**SSE event types:**
- `init` - Session started, includes session_id
- `assistant` - Text content from Claude
- `tool_use` - Claude is using a tool
- `tool_result` - Tool execution result
- `error` - Error occurred
- `done` - Stream complete

**Aggregated mode** (for background worker):
```typescript
for await (const message of query({ prompt, options })) {
  if (message.type === 'assistant' && message.content) {
    responseText += message.content;
  }
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
}
```

### Decision 3: Map MCP config to SDK format
The existing `mcpConfig` structure maps directly to the SDK's `mcpServers` option.

**Example:**
```typescript
// Existing format (from user_integrations)
{ gmail: { command: 'npx', args: ['@anthropic/gmail-mcp'] } }

// SDK format (same structure)
mcpServers: { gmail: { command: 'npx', args: ['@anthropic/gmail-mcp'] } }
```

### Decision 4: Permission mode
Use `bypassPermissions` mode since the server manages permissions via allowed tools list.

**Rationale:** The server controls which tools are available. Interactive permission prompts don't make sense in a server context.

### Decision 5: Tool configuration
Allow Read, Edit, Write, Bash, Glob, Grep, and any MCP tools. Disable WebSearch/WebFetch for now (can be enabled later).

**Rationale:** Start with core file/code operations. Web tools require additional consideration for rate limiting and cost.

## Risks / Trade-offs

### Risk: API Key exposure
`ANTHROPIC_API_KEY` must be set as an environment variable.

**Mitigation:** Document in README, use `.env` file for development, never log or expose the key.

### Risk: SDK version changes
The SDK is at version 0.1.x and may have breaking changes.

**Mitigation:** Pin exact version in package.json, test updates before upgrading.

### Risk: Response format mismatch
Claude may not return responses in the expected JSON format for `needs_input`, `continue`, `complete`.

**Mitigation:** The `ChatProcessingService` and `BackgroundWorker` already parse responses and handle various formats. Add system prompt guidance for response structure.

### Trade-off: Two endpoints for messages
Interactive chat uses SSE streaming, background worker uses aggregated responses.

**Rationale:** Different use cases benefit from different approaches. SSE gives users real-time feedback during chat. Worker doesn't need streaming since there's no user watching.

## Migration Plan
1. Add SDK dependency
2. Create `ClaudeAgentClient` class
3. Update `index.ts` to use real client when `ANTHROPIC_API_KEY` is set, fall back to mock otherwise
4. Update tests to mock the new client interface
5. Document required environment variables

## Open Questions
1. Should we expose streaming to the frontend in a future iteration?
2. What tool subset should be available for chat vs worker contexts?
3. Should we implement retry logic at the client level or rely on the existing retry logic in `BackgroundWorker`?
