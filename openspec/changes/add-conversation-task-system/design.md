# Design: Conversation-Centric Task System

## Context
This system enables users to create background tasks through natural conversation. A user says "watch my email for X" and the system spawns an autonomous agent that monitors, executes actions, and checks back for human input when needed.

**Key stakeholders:** End users who want task automation, developers building the platform.

**Constraints:**
- Must work with Claude Code SDK for AI execution
- Must support per-user MCP server configurations with OAuth
- Must handle concurrent background work safely
- Target latency: 10s for notifications (polling acceptable)

## Goals / Non-Goals

### Goals
- Single conversation model that handles both chat and background work
- Natural UX: users just chat, background work happens transparently
- Safe concurrent execution with database-level locking
- Shared context between chat and worker for continuity

### Non-Goals
- WebSocket real-time updates (polling is acceptable for MVP)
- External job queue (Redis, RabbitMQ) - Postgres handles this
- Multi-tenant worker scaling (single process sufficient initially)

## Decisions

### Decision 1: Conversation-Centric Model (No Separate Tasks Table)
Instead of `conversations` + `tasks` tables, everything is a conversation with optional `schedule` and `status` fields.

**Rationale:** Simpler data model, natural UX, avoids sync issues between chat and task state.

**Alternatives considered:**
- Separate tasks table: More complex, requires syncing, less natural UX
- Task-first model: Users think in conversations, not job queues

### Decision 2: Conversation Status State Machine
```
active ──────┬──────> background ──────> waiting_input
   │         │             │                   │
   │         │             └───────────────────┘
   │         │                    (user responds)
   └─────────┴──────────────────> archived
```

**States:**
- `active`: Normal chat, no background work
- `background`: Has scheduled work, worker picks it up
- `waiting_input`: Claude asked a question, paused until user responds
- `archived`: Conversation complete/inactive

### Decision 3: PostgreSQL as Job Queue
Use `FOR UPDATE SKIP LOCKED` for safe concurrent pickup instead of external queue.

**Rationale:** Simpler infrastructure, fewer moving parts, sufficient for expected scale.

**Query pattern:**
```sql
SELECT * FROM conversations
WHERE schedule IS NOT NULL
  AND status = 'background'
  AND next_run_at <= NOW()
FOR UPDATE SKIP LOCKED
LIMIT 5
```

### Decision 4: Shared Claude Session Between Chat and Worker
Both chat handler and background worker use the same `claude_session_id` for context continuity.

**Rationale:** Natural conversation flow ("how's that email task going?"), cheaper (less re-processing), more coherent multi-step workflows.

### Decision 5: Structured Worker Response Format
Worker Claude responds with one of:
- `{ needs_input: true, message, question }` - Pause and ask user
- `{ continue: true, state_update, next_step }` - Keep running
- `{ complete: true, message }` - Task finished

**Rationale:** Enables predictable state machine transitions, clear action handling.

### Decision 6: Per-User MCP Isolation
Each user's OAuth tokens encrypted separately. Worker builds MCP config dynamically per conversation.

**Rationale:** Security (User A's Gmail never mixed with User B's), compliance, user trust.

## Data Model

### Conversation Schema
```typescript
interface Conversation {
  id: string;
  user_id: string;
  title: string;
  status: 'active' | 'background' | 'waiting_input' | 'archived';

  // Scheduling
  schedule?: {
    type: 'cron' | 'scheduled' | 'immediate';
    cron_expression?: string;
    run_at?: Date;
  };
  next_run_at?: Date;

  // State for background work
  state: {
    context: object;      // Task description, params
    step: string;         // Current workflow step
    data: object;         // Accumulated state
    pending_question?: {  // If waiting_input
      type: 'confirmation' | 'choice' | 'input';
      prompt: string;
      options?: string[];
    };
  };

  // Claude session resumption
  claude_session_id?: string;
}
```

### Message Schema
```typescript
interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: 'chat' | 'worker';  // Who generated this
  created_at: Date;
}
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer (Hono)                         │
├─────────────────────────────────────────────────────────────────┤
│  POST /conversations/:id/messages  │  Background Worker Loop    │
│  (Chat Handler)                    │  (Polling every 5s)        │
├────────────────────────────────────┼────────────────────────────┤
│                                    │                            │
│  ┌──────────────────────────────┐  │  ┌──────────────────────┐  │
│  │ 1. Load conversation         │  │  │ 1. Query ready convs │  │
│  │ 2. Load user MCP configs     │  │  │ 2. FOR UPDATE SKIP   │  │
│  │ 3. Call Claude Code SDK      │  │  │ 3. Execute each      │  │
│  │ 4. Process response          │  │  │ 4. Update state      │  │
│  │ 5. Update conversation       │  │  │ 5. Create notifs     │  │
│  └──────────────────────────────┘  │  └──────────────────────┘  │
│                │                   │           │                │
│                └───────────────────┴───────────┘                │
│                                │                                │
│                    ┌───────────▼───────────┐                    │
│                    │   Claude Code SDK      │                    │
│                    │   (with MCP servers)   │                    │
│                    └───────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## Risks / Trade-offs

### Risk: Worker Starvation Under Load
If too many conversations need processing, some may be delayed.

**Mitigation:** Cap concurrent executions (MAX_CONCURRENT=5), monitor queue depth, scale workers horizontally if needed (FOR UPDATE SKIP LOCKED supports this).

### Risk: MCP OAuth Token Expiry During Background Work
Long-running tasks may hit expired tokens.

**Mitigation:** Detect auth errors, set conversation to `waiting_input` with reconnect prompt, create notification.

### Risk: Claude Session Expiry
Claude Code sessions may expire between worker runs.

**Mitigation:** Claude Code creates new session automatically; conversation.state is source of truth.

### Trade-off: Polling vs WebSockets
Chose 5-second polling over WebSockets for simplicity. Acceptable for 10s latency target.

## Migration Plan
N/A - This is a new system, no existing data to migrate.

## Open Questions
1. Should we support "pause" as a user-initiated action (vs only Claude-initiated waiting_input)?
2. What's the retry policy for failed MCP calls? (Currently: 3 retries with exponential backoff)
3. Should completed one-time tasks archive automatically or stay active for conversation?
