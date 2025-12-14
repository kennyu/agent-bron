## 1. Foundation & Layout

- [x] 1.1 Create TypeScript types for API responses (`apps/src/types/api.ts`)
- [x] 1.2 Create generic `useSSE` hook for SSE connections (`apps/src/hooks/useSSE.ts`)
- [x] 1.3 Create `AppContext` for global state (`apps/src/context/AppContext.tsx`)
- [x] 1.4 Replace `App.tsx` with three-panel layout using CSS Grid

## 2. Interactive Chats Panel (Left)

- [x] 2.1 Create `useChats` hook - fetches conversations, filters to `active`/`waiting_input` only
- [x] 2.2 Create `ChatItem` component with status indicator
- [x] 2.3 Create `ChatList` component with scroll and sorting
- [x] 2.4 Create `NewChatButton` component
- [x] 2.5 Create `ChatsPanel` container with collapse/expand
- [x] 2.6 Add delete confirmation dialog

## 3. Chat Window

- [x] 3.1 Create `useMessages` hook for fetching and streaming (`apps/src/hooks/useMessages.ts`)
- [x] 3.2 Create `MessageBubble` component for user/assistant messages
- [x] 3.3 Create `StreamingText` component for animated token display
- [x] 3.4 Create `MessageList` component with auto-scroll behavior
- [x] 3.5 Create `ChatInput` component with send/stop buttons
- [x] 3.6 Create `ChatWindow` container integrating all chat components
- [x] 3.7 Handle tool_use and result events with visual indicators
- [x] 3.8 Create `TextInputWidget` for free-form text input requests
- [x] 3.9 Create `ChoiceWidget` with radio buttons for single-choice requests
- [x] 3.10 Create `ConfirmationWidget` with Yes/No buttons
- [x] 3.11 Create `InputWidget` container that renders the appropriate widget based on `pendingQuestionType`
- [x] 3.12 Handle widget submission - send response as message, clear pending question

## 4. Background Agents Panel (Right)

- [x] 4.1 Create `useAgents` hook - fetches conversations, filters to `background` only, adds control methods
- [x] 4.2 Create `AgentCard` component with status, schedule type, and next run time
- [x] 4.3 Create `AgentLogs` component for streaming output
- [x] 4.4 Create `AgentControls` component (Run Now, Pause, Resume, Cancel)
- [x] 4.5 Create `AgentsPanel` container with 5s polling refresh and collapse/expand

## 5. API Integration (if needed)

- [x] 5.1 Add PATCH `/api/conversations/:id/pause` endpoint for pausing agents
- [x] 5.2 Add PATCH `/api/conversations/:id/resume` endpoint for resuming agents
- [x] 5.3 Add POST `/api/conversations/:id/run-now` endpoint for immediate execution

## 6. Cross-Panel Transitions

- [x] 6.1 Handle chat-to-agent transition when `create_schedule` response received
- [x] 6.2 Show notification when chat becomes an agent
- [x] 6.3 Refresh both panels when status changes

## 7. Polish & Testing

- [x] 7.1 Add connection status indicator component
- [x] 7.2 Implement exponential backoff reconnection in `useSSE`
- [x] 7.3 Add loading states and skeleton components
- [x] 7.4 Add error boundary for graceful error handling
- [x] 7.5 Test streaming with real Claude Agent SDK
- [x] 7.6 Test agent control flow (start, pause, resume, cancel)
- [x] 7.7 Test chat-to-agent transition flow
