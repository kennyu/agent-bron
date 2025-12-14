## ADDED Requirements

### Requirement: Three-Panel Layout
The application SHALL display a three-panel responsive layout with a conversation sidebar, main chat window, and background agents panel.

#### Scenario: Default panel visibility
- **WHEN** the application loads
- **THEN** all three panels are visible with default widths (sidebar: 250px, chat: flexible, agents: 300px)

#### Scenario: Collapsible sidebar
- **WHEN** user clicks the sidebar collapse button
- **THEN** the sidebar collapses to show only icons
- **AND** the chat window expands to fill the space

#### Scenario: Collapsible agents panel
- **WHEN** user clicks the agents panel collapse button
- **THEN** the agents panel collapses to a narrow strip
- **AND** the chat window expands to fill the space

---

### Requirement: Interactive Chats Panel
The left sidebar SHALL display only interactive conversations (status `active` or `waiting_input`) with create, select, and delete functionality.

#### Scenario: Display interactive chats only
- **WHEN** the application loads
- **THEN** conversations are fetched from GET /api/conversations
- **AND** only conversations with status `active` or `waiting_input` are displayed
- **AND** conversations with status `background` or `archived` are excluded
- **AND** results are sorted by most recent activity

#### Scenario: Create new conversation
- **WHEN** user clicks the "New Chat" button
- **THEN** a POST /api/conversations request is made
- **AND** the new conversation appears at the top of the list
- **AND** the new conversation is automatically selected

#### Scenario: Select conversation
- **WHEN** user clicks on a conversation in the list
- **THEN** the conversation is highlighted as selected
- **AND** the chat window loads messages for that conversation

#### Scenario: Delete conversation
- **WHEN** user clicks the delete button on a conversation
- **THEN** a confirmation dialog appears
- **AND** if confirmed, DELETE /api/conversations/:id is called
- **AND** the conversation is removed from the list

#### Scenario: Show conversation status
- **WHEN** displaying a conversation item
- **THEN** a status indicator shows the conversation state (`active` or `waiting_input`)

#### Scenario: Chat transitions to background agent
- **WHEN** a chat response includes `create_schedule` and transitions to `background` status
- **THEN** the conversation is removed from the Chats panel
- **AND** appears in the Background Agents panel
- **AND** a notification indicates the agent was created

---

### Requirement: Chat Window with Streaming
The chat window SHALL display messages and support sending new messages with real-time streaming responses.

#### Scenario: Display message history
- **WHEN** a conversation is selected
- **THEN** GET /api/conversations/:id fetches the conversation with messages
- **AND** messages are displayed in chronological order
- **AND** user messages appear on the right, assistant messages on the left

#### Scenario: Send message with streaming
- **WHEN** user types a message and clicks send (or presses Enter)
- **THEN** POST /api/conversations/:id/messages/stream is called
- **AND** the user message appears immediately in the chat
- **AND** an SSE connection is established for the response
- **AND** assistant response text streams in real-time as tokens arrive

#### Scenario: Handle SSE events
- **WHEN** streaming a response
- **THEN** "user_message" event confirms the user message was saved
- **AND** "assistant" events append text to the streaming response
- **AND** "tool_use" events display tool invocation indicators
- **AND** "result" events display tool results
- **AND** "message_saved" event marks the response as complete
- **AND** "error" events display an error message

#### Scenario: Disable input while streaming
- **WHEN** a message is being streamed
- **THEN** the input field and send button are disabled
- **AND** a "stop" button is available to cancel the stream

#### Scenario: Auto-scroll to latest message
- **WHEN** new message content arrives
- **THEN** the chat window scrolls to show the latest content
- **UNLESS** the user has manually scrolled up

---

### Requirement: Input Request Widgets
When a conversation is in `waiting_input` status, the chat SHALL display an inline widget matching the input type requested by Claude.

#### Scenario: Display text input widget
- **WHEN** conversation has `pendingQuestionType = "text"`
- **THEN** an inline widget appears in the chat flow after the assistant message
- **AND** the widget shows the `pendingQuestionPrompt` as a label
- **AND** a text input field is displayed
- **AND** a submit button sends the response as a user message

#### Scenario: Display single-choice widget
- **WHEN** conversation has `pendingQuestionType = "choice"` and `pendingQuestionOptions` is set
- **THEN** an inline widget appears with radio buttons for each option
- **AND** the widget shows the `pendingQuestionPrompt` as a label
- **AND** selecting an option and clicking submit sends the choice as a user message

#### Scenario: Display confirmation widget
- **WHEN** conversation has `pendingQuestionType = "confirmation"`
- **THEN** an inline widget appears with Yes/No buttons
- **AND** the widget shows the `pendingQuestionPrompt` as a label
- **AND** clicking either button sends "Yes" or "No" as a user message

#### Scenario: Clear widget after response
- **WHEN** user submits a response via the input widget
- **THEN** the widget is replaced with the user's response as a normal message bubble
- **AND** conversation status transitions from `waiting_input` to `active`

#### Scenario: Fallback for unknown input types
- **WHEN** conversation has an unrecognized `pendingQuestionType`
- **THEN** display a text input widget as the default

---

### Requirement: Background Agents Panel
The right panel SHALL display only conversations with `background` status as agents, with live status, streaming logs, and full control.

#### Scenario: List background agents only
- **WHEN** the agents panel is visible
- **THEN** only conversations with status `background` are displayed as agent cards
- **AND** conversations with other statuses are excluded
- **AND** the list refreshes every 5 seconds via polling

#### Scenario: Display agent status
- **WHEN** displaying an agent card
- **THEN** show the conversation title, status, schedule type, and next run time
- **AND** show a visual indicator for running/idle/failed state

#### Scenario: View agent logs
- **WHEN** user expands an agent card
- **THEN** an SSE connection streams the agent's output in real-time
- **AND** logs display with timestamps and event types

#### Scenario: Start agent manually
- **WHEN** user clicks "Run Now" on an idle agent
- **THEN** the agent's next_run_at is set to now
- **AND** the status updates to show it's queued for execution

#### Scenario: Pause agent
- **WHEN** user clicks "Pause" on a running or scheduled agent
- **THEN** the agent's schedule is suspended (next_run_at set to null)
- **AND** the status indicator shows "Paused"

#### Scenario: Resume agent
- **WHEN** user clicks "Resume" on a paused agent
- **THEN** the agent's next_run_at is recalculated from its schedule
- **AND** the agent resumes normal scheduling

#### Scenario: Cancel agent
- **WHEN** user clicks "Cancel" on any agent
- **THEN** a confirmation dialog appears
- **AND** if confirmed, the conversation status is set to "archived"
- **AND** the agent is removed from the panel

---

### Requirement: Real-Time Connection Status
The application SHALL display the status of SSE connections and handle reconnection gracefully.

#### Scenario: Show connection status
- **WHEN** an SSE connection is active
- **THEN** a green indicator shows "Connected"
- **AND** when disconnected, a yellow indicator shows "Reconnecting..."
- **AND** after reconnection fails 3 times, a red indicator shows "Disconnected"

#### Scenario: Automatic reconnection
- **WHEN** an SSE connection is lost
- **THEN** the application attempts to reconnect with exponential backoff
- **AND** reconnection attempts occur at 1s, 2s, 4s, 8s intervals up to 30s max

#### Scenario: Manual reconnection
- **WHEN** connection status shows "Disconnected"
- **THEN** user can click "Reconnect" to manually retry
