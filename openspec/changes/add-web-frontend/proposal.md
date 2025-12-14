# Change: Add Web Frontend for Claude Agent Testing

## Why
The system currently has a backend API with conversation management and Claude Agent SDK integration, but no proper UI to test these features. A web frontend is needed to enable interactive chat with the agent, manage conversations, and monitor/control background agents with their live output.

## What Changes
- **NEW** Three-panel layout: interactive chats sidebar, main chat window, background agents panel
- **NEW** Chat window with SSE streaming support showing tokens as they arrive
- **NEW** Chats panel showing only interactive conversations (`active`, `waiting_input` status)
- **NEW** Agents panel showing only background tasks (`background` status) with live status, streaming logs, and full control
- **NEW** Inline input widgets for `waiting_input` status: text input, single-choice radio buttons, yes/no confirmation
- **NEW** Automatic panel transitions: when a chat spawns a scheduled task, it moves from Chats to Agents panel
- **NEW** Real-time updates via SSE for agent status and output
- **MODIFIED** Existing `apps/src/` React app replaced with full-featured UI

## Conceptual Model
The same underlying entity (conversation) appears in different panels based on its status:
- **Chats Panel** (left): `status = active | waiting_input` - interactive sessions
- **Agents Panel** (right): `status = background` - autonomous scheduled tasks
- When Claude responds with `create_schedule`, the conversation transitions to `background` and moves to the Agents panel

## Impact
- Affected specs: `web-frontend` (new capability)
- Affected code:
  - `apps/src/App.tsx` (complete rewrite)
  - `apps/src/components/` (new chat, sidebar, agents components)
  - `apps/src/hooks/` (new hooks for SSE, conversations, agents)
  - `apps/src/types/` (TypeScript types for API responses)
  - May need new API endpoints for agent control (pause/resume)
