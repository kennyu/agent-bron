## Context

The Claude Agent testing platform needs a web UI to interact with conversations and monitor background agents. The existing React app (`apps/src/`) provides a basic setup with Bun, React, and shadcn/ui components. The API already supports SSE streaming for chat messages and has conversation CRUD endpoints.

**Stakeholders:** Developers testing Claude Agent features
**Constraints:** Must work with existing Hono API and Bun build system

## Goals / Non-Goals

### Goals
- Enable interactive chat with Claude Agent via streaming UI
- Display multiple conversations in a sidebar for easy switching
- Show background agents with live status and streaming logs
- Provide full control over agents (start, pause, resume, cancel)
- Responsive three-panel layout

### Non-Goals
- Mobile-first design (desktop testing tool)
- User authentication UI (API handles auth via headers)
- Theming/customization beyond basic dark/light mode
- Offline support

## Decisions

### Conceptual Model
**Decision:** Same entity (conversation) shown in different panels based on status
- **Chats Panel**: Conversations with `status = active | waiting_input` - interactive sessions
- **Agents Panel**: Conversations with `status = background` - autonomous scheduled tasks
- Transition happens when Claude responds with `create_schedule` - the chat moves from left to right panel

### Layout Architecture
**Decision:** Three-panel resizable layout using CSS Grid
- Left panel: Interactive chats (250px default, collapsible) - filters to `active`/`waiting_input`
- Center panel: Chat window (flexible, minimum 400px)
- Right panel: Background agents (300px default, collapsible) - filters to `background`

**Alternatives considered:**
- Tab-based navigation: Rejected - doesn't allow monitoring agents while chatting
- Floating panels: Rejected - adds complexity without benefit for testing tool

### State Management
**Decision:** React Context + useReducer for global state, local state for component-specific data
- Conversation list and selection: Global context
- Chat messages: Per-conversation local state with SSE updates
- Agent status: Global context with polling/SSE updates

**Alternatives considered:**
- Redux: Overkill for this scope
- Zustand: Good option but adds dependency; Context sufficient here
- React Query: Good for caching but SSE streaming needs custom handling

### SSE Integration
**Decision:** Custom `useSSE` hook wrapping EventSource API
- Handles connection lifecycle, reconnection, and cleanup
- Provides typed event handlers for different message types
- Integrates with React state for real-time updates

### Component Structure
```
src/
├── App.tsx                 # Root layout with three panels
├── components/
│   ├── chat/
│   │   ├── ChatWindow.tsx    # Main chat container
│   │   ├── MessageList.tsx   # Scrollable message display
│   │   ├── MessageBubble.tsx # Individual message styling
│   │   ├── ChatInput.tsx     # Message input with send button
│   │   ├── StreamingText.tsx # Animated streaming text display
│   │   └── InputWidget.tsx   # Inline widget for waiting_input status
│   │       ├── TextInputWidget      # Free-form text input
│   │       ├── ChoiceWidget         # Radio buttons for single-choice
│   │       └── ConfirmationWidget   # Yes/No buttons
│   ├── chats/
│   │   ├── ChatsPanel.tsx        # Left panel container
│   │   ├── ChatList.tsx          # List of interactive chats (active/waiting_input)
│   │   ├── ChatItem.tsx          # Single chat row with status
│   │   └── NewChatButton.tsx     # Create conversation
│   ├── agents/
│   │   ├── AgentsPanel.tsx       # Right panel container
│   │   ├── AgentCard.tsx         # Single agent status card
│   │   ├── AgentLogs.tsx         # Streaming log output
│   │   └── AgentControls.tsx     # Start/pause/resume/cancel buttons
│   └── ui/                   # Existing shadcn components
├── hooks/
│   ├── useChats.ts           # Fetch/filter interactive chats
│   ├── useMessages.ts        # Message fetching and SSE
│   ├── useAgents.ts          # Fetch/filter background agents + control
│   └── useSSE.ts             # Generic SSE connection hook
├── context/
│   └── AppContext.tsx        # Global state (selected chat, refresh triggers)
└── types/
    └── api.ts                # TypeScript types for API responses
```

## Risks / Trade-offs

### Risk: SSE connection stability
**Mitigation:** Implement exponential backoff reconnection in `useSSE` hook; show connection status indicator in UI

### Risk: Memory leaks from multiple SSE connections
**Mitigation:** Strict cleanup in useEffect; limit concurrent streaming connections to 1 chat + 1 agent monitor

### Trade-off: No persistent local storage
**Decision:** Don't cache data locally - always fetch fresh from API
**Rationale:** Testing tool where fresh data is critical; simplifies implementation

### Trade-off: Polling for agent list vs WebSocket
**Decision:** Poll agent list every 5s; use SSE only for active agent logs
**Rationale:** Agent list changes infrequently; SSE for logs provides real-time where it matters

## Migration Plan

1. Replace existing `App.tsx` and `APITester.tsx` with new layout
2. Keep existing shadcn/ui components in `components/ui/`
3. Add new components incrementally (sidebar first, then chat, then agents)
4. No database changes required - uses existing API

**Rollback:** Revert to previous App.tsx if issues arise

## Open Questions

1. Should the API provide a dedicated endpoint for listing background agents, or filter conversations by status?
   - **Proposed answer:** Filter conversations with `status=background` from existing endpoint

2. What events should the agent logs stream? Tool calls, thoughts, or just output?
   - **Proposed answer:** Stream all SSE events from Claude (init, assistant, tool_use, result, done)

3. Should pause/resume functionality be synchronous or fire-and-forget?
   - **Proposed answer:** Fire-and-forget with optimistic UI update, reconcile on next poll
