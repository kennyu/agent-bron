# Chat Processing Capability

## ADDED Requirements

### Requirement: Message Processing Pipeline
The system SHALL process user messages through a structured pipeline.

#### Scenario: Load conversation context
- **WHEN** a user sends a message
- **THEN** the system SHALL load the conversation, messages, state, and user's MCP configs

#### Scenario: Call Claude Code SDK
- **WHEN** processing a message
- **THEN** the system SHALL call Claude Code SDK with full message history, conversation state, user's MCP servers, and session ID for resumption

#### Scenario: Save response
- **WHEN** Claude responds
- **THEN** the system SHALL save the assistant message and update conversation state/status as needed

### Requirement: Waiting Input Detection
The system SHALL detect when a conversation is awaiting user response.

#### Scenario: User answering question
- **WHEN** a user sends a message to a conversation with status `waiting_input`
- **THEN** the system SHALL recognize this as a response to the pending question
- **AND** Claude SHALL process the response in context of the pending question

### Requirement: Schedule Creation
Claude SHALL be able to create background schedules through chat.

#### Scenario: Create cron schedule
- **WHEN** Claude responds with `create_schedule` of type `cron`
- **THEN** the system SHALL set `conversation.schedule` with the cron expression
- **AND** it SHALL set `conversation.status` to `background`
- **AND** it SHALL calculate and set `next_run_at`

#### Scenario: Create immediate schedule
- **WHEN** Claude responds with `create_schedule` of type `immediate`
- **THEN** the system SHALL set `next_run_at` to the current time
- **AND** the worker SHALL pick up the conversation on the next poll

### Requirement: Input Request
Claude SHALL be able to request user input through chat.

#### Scenario: Ask confirmation
- **WHEN** Claude responds with `needs_input` of type `confirmation`
- **THEN** the system SHALL set conversation status to `waiting_input`
- **AND** it SHALL store the question with prompt and options in `state.pending_question`

#### Scenario: Ask choice
- **WHEN** Claude responds with `needs_input` of type `choice`
- **THEN** the system SHALL present the options to the user
- **AND** it SHALL wait for user selection

#### Scenario: Ask free input
- **WHEN** Claude responds with `needs_input` of type `input`
- **THEN** the system SHALL wait for user's free-form text response

### Requirement: MCP Tool Usage
Claude SHALL be able to use MCP tools directly during chat.

#### Scenario: Immediate tool use
- **WHEN** a user asks for an immediate action (search photos, check email now)
- **THEN** Claude SHALL call the appropriate MCP tools synchronously
- **AND** it SHALL return results in the chat response

### Requirement: User Response Handling
The system SHALL handle user responses to pending questions.

#### Scenario: Confirmation response
- **WHEN** a user responds to a confirmation question
- **THEN** Claude SHALL process the response (e.g., send email via MCP)
- **AND** the system SHALL clear `pending_question`
- **AND** it SHALL update conversation status appropriately

#### Scenario: Off-topic response
- **WHEN** a user asks a clarifying question instead of answering
- **THEN** Claude MAY answer the question while keeping `pending_question` active
- **OR** Claude MAY re-present the question with more context

### Requirement: MCP Integration Check
The system SHALL verify MCP integration availability before creating schedules.

#### Scenario: Missing integration
- **WHEN** a user requests a task requiring an unconnected integration
- **THEN** Claude SHALL inform the user that the integration is not connected
- **AND** it SHALL direct them to Settings to add the integration

#### Scenario: Expired token
- **WHEN** an OAuth token is expired during chat
- **THEN** Claude SHALL inform the user that reconnection is needed
- **AND** it SHALL update conversation status to `waiting_input` with reconnect prompt

### Requirement: System Prompt
The system SHALL provide Claude with structured context.

#### Scenario: System prompt contents
- **WHEN** calling Claude Code SDK
- **THEN** the system prompt SHALL include user's connected integrations
- **AND** it SHALL include available (unconnected) integrations
- **AND** it SHALL include conversation state and status
- **AND** it SHALL include instructions for response format (create_schedule, needs_input, state_update)
