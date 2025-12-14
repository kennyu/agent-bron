# Conversation Capability

## ADDED Requirements

### Requirement: Conversation Status States
The system SHALL support four conversation statuses that control behavior and worker eligibility.

#### Scenario: Active conversation
- **WHEN** a conversation has status `active`
- **THEN** the conversation is a normal chat with no background work
- **AND** the background worker SHALL NOT pick up this conversation

#### Scenario: Background conversation
- **WHEN** a conversation has status `background`
- **THEN** the conversation has scheduled work to execute
- **AND** the background worker SHALL pick up this conversation when `next_run_at <= NOW()`

#### Scenario: Waiting input conversation
- **WHEN** a conversation has status `waiting_input`
- **THEN** Claude has asked a question and is paused until user responds
- **AND** the background worker SHALL NOT pick up this conversation
- **AND** the state SHALL contain a `pending_question` object

#### Scenario: Archived conversation
- **WHEN** a conversation has status `archived`
- **THEN** the conversation is complete or inactive
- **AND** the background worker SHALL NOT pick up this conversation

### Requirement: Conversation Schedule
The system SHALL support optional scheduling configuration on conversations.

#### Scenario: Cron schedule
- **WHEN** a conversation has schedule type `cron`
- **THEN** the system SHALL calculate `next_run_at` using the cron expression
- **AND** the worker SHALL pick up the conversation when the time arrives

#### Scenario: Scheduled one-time
- **WHEN** a conversation has schedule type `scheduled`
- **THEN** the conversation SHALL run once at the specified `run_at` time
- **AND** after completion, the schedule SHALL be cleared

#### Scenario: Immediate execution
- **WHEN** a conversation has schedule type `immediate`
- **THEN** the system SHALL set `next_run_at` to the current time
- **AND** the worker SHALL pick up the conversation on the next poll cycle

### Requirement: Conversation State
The system SHALL maintain structured state for background work on each conversation.

#### Scenario: State context
- **WHEN** a conversation has background work
- **THEN** the state SHALL contain a `context` object describing the task

#### Scenario: State step
- **WHEN** a conversation has background work
- **THEN** the state SHALL contain a `step` field indicating current workflow position

#### Scenario: State data
- **WHEN** background work accumulates results
- **THEN** the state `data` object SHALL be updated with the accumulated data

#### Scenario: Pending question
- **WHEN** conversation status is `waiting_input`
- **THEN** the state SHALL contain a `pending_question` with type, prompt, and optional options

### Requirement: Claude Session Continuity
The system SHALL maintain Claude session ID for context resumption.

#### Scenario: Session stored
- **WHEN** Claude Code SDK returns a session ID
- **THEN** the system SHALL store it as `claude_session_id` on the conversation

#### Scenario: Session resumed
- **WHEN** processing a message or running background work
- **THEN** the system SHALL pass the stored `claude_session_id` to Claude Code SDK
- **AND** Claude SHALL have access to context from previous runs

#### Scenario: Session expiry
- **WHEN** a Claude session expires
- **THEN** Claude Code SHALL create a new session automatically
- **AND** the conversation state in the database remains the source of truth

### Requirement: Message Source Tracking
The system SHALL track whether each message originated from chat or background worker.

#### Scenario: Chat message
- **WHEN** a user sends a message interactively
- **THEN** the message SHALL have source `chat`

#### Scenario: Worker message
- **WHEN** the background worker generates a response
- **THEN** the message SHALL have source `worker`
