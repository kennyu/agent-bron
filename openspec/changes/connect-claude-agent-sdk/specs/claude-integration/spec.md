## ADDED Requirements

### Requirement: Claude Agent SDK Integration
The system SHALL connect to the Claude Agent SDK to execute AI-driven tasks instead of using mock responses.

#### Scenario: Execute prompt with Claude Agent SDK
- **WHEN** a prompt is sent to the Claude client
- **THEN** the system calls the Claude Agent SDK's `query()` function
- **AND** returns the aggregated response text and session ID

#### Scenario: Resume existing session
- **WHEN** a prompt is sent with an existing session ID
- **THEN** the system passes the `resume` option to the SDK
- **AND** Claude has access to the previous conversation context

#### Scenario: MCP server configuration
- **WHEN** a prompt is sent with MCP configuration
- **THEN** the system passes the `mcpServers` option to the SDK
- **AND** Claude has access to the configured MCP tools

#### Scenario: Fallback to mock client
- **WHEN** `ANTHROPIC_API_KEY` environment variable is not set
- **THEN** the system uses a mock client for development
- **AND** logs a warning that the mock client is in use

### Requirement: SSE Streaming for Interactive Chat
The system SHALL provide a Server-Sent Events endpoint for streaming Claude responses to the frontend in real-time.

#### Scenario: Stream chat response via SSE
- **WHEN** a POST request is made to `/conversations/:id/messages/stream`
- **THEN** the system returns a `text/event-stream` response
- **AND** streams SDK messages as SSE events in real-time

#### Scenario: SSE event types
- **WHEN** streaming a Claude response
- **THEN** the system sends `init` event when session starts
- **AND** sends `assistant` events for Claude's text output
- **AND** sends `tool_use` events when Claude uses tools
- **AND** sends `done` event when the response is complete
- **AND** sends `error` event if an error occurs

#### Scenario: Persist streamed response
- **WHEN** the SSE stream completes successfully
- **THEN** the system saves the full response to the messages table
- **AND** updates the conversation's session ID

#### Scenario: Client disconnects during stream
- **WHEN** the client closes the SSE connection before completion
- **THEN** the system stops processing the SDK response
- **AND** does not save a partial response to the database

### Requirement: Claude Client Error Handling
The system SHALL handle Claude Agent SDK errors gracefully.

#### Scenario: API key missing at runtime
- **WHEN** the real client is used but API key becomes invalid
- **THEN** the system throws a descriptive error
- **AND** the error is logged for debugging

#### Scenario: SDK timeout
- **WHEN** the SDK call exceeds the configured timeout
- **THEN** the system throws a timeout error
- **AND** the conversation state is preserved for retry

#### Scenario: SDK internal error
- **WHEN** the SDK returns an error response
- **THEN** the system wraps the error with context
- **AND** propagates it to the caller for handling
