# Background Worker Capability

## ADDED Requirements

### Requirement: Worker Polling Loop
The system SHALL run a background worker that polls for ready conversations.

#### Scenario: Poll interval
- **WHEN** the worker is running
- **THEN** it SHALL poll the database every 5 seconds for ready conversations

#### Scenario: Ready conversation query
- **WHEN** the worker polls for work
- **THEN** it SHALL query conversations WHERE schedule IS NOT NULL AND status = 'background' AND next_run_at <= NOW()
- **AND** it SHALL use FOR UPDATE SKIP LOCKED to prevent double-pickup

#### Scenario: Batch limit
- **WHEN** the worker queries for ready conversations
- **THEN** it SHALL limit results to prevent overload (max 5 per poll)

### Requirement: Concurrent Execution
The system SHALL manage concurrent conversation executions.

#### Scenario: Concurrency cap
- **WHEN** the worker is executing conversations
- **THEN** it SHALL track active execution count
- **AND** it SHALL NOT exceed MAX_CONCURRENT (5-10) simultaneous executions

#### Scenario: Non-blocking spawn
- **WHEN** the worker picks up a conversation
- **THEN** it SHALL spawn execution asynchronously
- **AND** it SHALL continue polling without waiting for completion

### Requirement: MCP Configuration Loading
The worker SHALL load user-specific MCP configurations for each conversation.

#### Scenario: Load user credentials
- **WHEN** executing a conversation
- **THEN** the worker SHALL load the conversation owner's MCP configs
- **AND** it SHALL decrypt OAuth credentials at execution time only

#### Scenario: Per-user isolation
- **WHEN** building MCP config
- **THEN** User A's credentials SHALL never be mixed with User B's credentials

### Requirement: Prompt Construction
The worker SHALL build prompts with full conversation context.

#### Scenario: Context inclusion
- **WHEN** building the prompt for Claude
- **THEN** the prompt SHALL include conversation state (context, step, data)
- **AND** the prompt SHALL include recent message history
- **AND** the prompt SHALL include instructions for response format

#### Scenario: Response format instructions
- **WHEN** building the prompt
- **THEN** the instructions SHALL specify three response types: needs_input, continue, complete

### Requirement: Response Handling - Needs Input
The worker SHALL handle responses requesting user input.

#### Scenario: Pause for input
- **WHEN** Claude responds with `needs_input: true`
- **THEN** the worker SHALL insert an assistant message with the message content
- **AND** it SHALL set conversation status to `waiting_input`
- **AND** it SHALL store the question in `state.pending_question`
- **AND** it SHALL create a notification for the user
- **AND** it SHALL NOT update `next_run_at`

### Requirement: Response Handling - Continue
The worker SHALL handle responses indicating work should continue.

#### Scenario: Continue background work
- **WHEN** Claude responds with `continue: true`
- **THEN** the worker SHALL optionally insert a status message
- **AND** it SHALL merge `state_update` into `state.data`
- **AND** it SHALL update `state.step` to `next_step` if provided
- **AND** it SHALL calculate and set `next_run_at` based on schedule
- **AND** it SHALL NOT create a notification

### Requirement: Response Handling - Complete
The worker SHALL handle responses indicating work is complete.

#### Scenario: One-time completion
- **WHEN** Claude responds with `complete: true` for a one-time schedule
- **THEN** the worker SHALL insert an assistant message
- **AND** it SHALL set conversation status to `active`
- **AND** it SHALL clear the schedule
- **AND** it MAY create a notification for significant completions

#### Scenario: Cron completion
- **WHEN** Claude responds with `complete: true` for a cron schedule
- **THEN** the worker SHALL insert an assistant message
- **AND** it SHALL keep status as `background`
- **AND** it SHALL calculate and set `next_run_at` based on cron expression

### Requirement: Error Handling
The worker SHALL handle execution errors gracefully.

#### Scenario: MCP server failure
- **WHEN** an MCP server call fails
- **THEN** the worker SHALL retry up to 3 times with exponential backoff
- **AND** if persistent, it SHALL set conversation to `waiting_input` with an error message
- **AND** it SHALL create a notification explaining the issue

#### Scenario: Claude Code timeout
- **WHEN** Claude Code execution times out
- **THEN** the worker SHALL mark this run as failed
- **AND** the conversation SHALL stay in `background` status
- **AND** after 3 consecutive failures, it SHALL notify the user

#### Scenario: Expired OAuth tokens
- **WHEN** MCP returns an authentication error
- **THEN** the worker SHALL set conversation to `waiting_input`
- **AND** it SHALL create a notification prompting the user to reconnect
