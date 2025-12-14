# Background Worker System

## Overview

The worker processes conversations that have background work (scheduled, cron, or immediate). It's a simple polling loop that:

1. Finds conversations ready to run
2. Executes Claude Code with full conversation context
3. Updates conversation state based on result
4. Creates notifications when user input needed

---

## Worker Loop

```
Every 5 seconds:
  1. Query for ready conversations (max 5)
  2. For each, spawn execution (concurrent, don't block)
  3. Track active count (cap at 5-10)
```

### Ready Conversation Query

```sql
SELECT * FROM conversations
WHERE schedule IS NOT NULL
  AND status = 'background'  -- Not waiting on user
  AND next_run_at <= NOW()
FOR UPDATE SKIP LOCKED
LIMIT 5
```

Key points:
- `FOR UPDATE SKIP LOCKED` prevents double-pickup
- Only picks up `background` status (not `waiting_input`)
- Respects `next_run_at` scheduling

---

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Worker Process                       │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Load conversation + messages + state                 │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Load user's MCP configs, decrypt credentials         │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Build prompt from conversation history + state       │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Run Claude Code SDK with MCP servers                 │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Parse response, update conversation                  │
└─────────────────────────────────────────────────────────┘
```

---

## Claude Code Integration

### Building MCP Config Per-User

Each user has different OAuth tokens. Worker builds config dynamically:

```
User A's Gmail tokens → MCP config for User A's conversation
User B's Gmail tokens → MCP config for User B's conversation
```

Never mixed. Full isolation.

### Session Resumption

- Store `claude_session_id` on conversation
- Pass to Claude Code SDK on each run
- Claude retains context from previous runs
- Cheaper (less re-processing) and more coherent

If session expires, Claude Code creates new session—conversation state in DB is source of truth.

---

## Prompt Construction

The worker builds a prompt that gives Claude full context:

```
CONVERSATION CONTEXT:
{conversation.state.context}

CURRENT STEP: {conversation.state.step}

CONVERSATION HISTORY:
[Recent messages from conversation]

CURRENT STATE DATA:
{conversation.state.data}

INSTRUCTIONS:
You are continuing a background task. Based on the conversation 
and current state, take the next appropriate action.

If you need user input, respond with:
{
  "needs_input": true,
  "message": "Your message to the user",
  "question": {
    "type": "confirmation|choice|input",
    "prompt": "What you're asking",
    "options": ["Option 1", "Option 2"]  // if applicable
  }
}

If work is complete, respond with:
{
  "complete": true,
  "message": "Summary of what was accomplished"
}

If continuing background work, respond with:
{
  "continue": true,
  "message": "Status update for user (optional)",
  "state_update": { ... },
  "next_step": "step_name"
}
```

---

## Response Handling

### Case 1: Needs User Input

Claude returns:
```json
{
  "needs_input": true,
  "message": "Found a receipt! Here's the draft email...\n\nShould I send it?",
  "question": {
    "type": "confirmation",
    "prompt": "Should I send this email?",
    "options": ["Send", "Edit", "Cancel"]
  }
}
```

Worker actions:
1. Insert assistant message with `message` content
2. Update conversation:
   - `status` → `waiting_input`
   - `state.pending_question` → question object
3. Create notification for user
4. Do NOT update `next_run_at` (paused until user responds)

### Case 2: Work Complete

Claude returns:
```json
{
  "complete": true,
  "message": "✅ Email sent successfully!"
}
```

Worker actions:
1. Insert assistant message
2. Update conversation:
   - For one-time: `status` → `active`, `schedule` → null
   - For cron: `status` → `background`, update `next_run_at`
3. Create notification (optional, for significant completions)

### Case 3: Continue Background Work

Claude returns:
```json
{
  "continue": true,
  "message": null,
  "state_update": { "searches_completed": 13 },
  "next_step": "monitoring"
}
```

Worker actions:
1. Optionally insert status message (or skip to avoid noise)
2. Update conversation:
   - `state.data` merged with `state_update`
   - `state.step` → `next_step`
   - `next_run_at` → calculated from cron expression
3. No notification (nothing for user to do)

---

## Example: Email Watcher Full Flow

### Initial Setup (via chat)

User: "Watch my email for AA flight receipts from Austin, email Rebecca when found"

Claude (in chat, not worker):
- Creates conversation with schedule
- Sets initial state

```json
{
  "status": "background",
  "schedule": { "type": "cron", "cron_expression": "*/5 * * * *" },
  "next_run_at": "2025-01-15T10:05:00Z",
  "state": {
    "context": {
      "description": "Monitor inbox for AA flight receipts from Austin",
      "action": "Draft email to Rebecca@gauntlet.ai"
    },
    "step": "monitoring",
    "data": {}
  }
}
```

### Worker Run #1-10 (no email found)

Every 5 minutes, worker picks up conversation, runs Claude Code.

Claude searches Gmail, finds nothing:
```json
{ "continue": true, "state_update": { "searches_completed": 10 } }
```

Worker updates `next_run_at`, conversation stays in `background`.

### Worker Run #11 (email found!)

Claude searches Gmail, finds receipt:
```json
{
  "needs_input": true,
  "message": "Found a flight receipt from American Airlines!\n\nFlight: AA1234\nDate: Jan 20, 2025\nRoute: Austin (AUS) → Dallas (DFW)\n\nHere's the draft email to Rebecca@gauntlet.ai:\n\n---\nSubject: Flight Details - AA1234\n\nHi Rebecca,\n\nHere are my flight details:\n- Flight: AA1234\n- Date: January 20, 2025\n- Departure: Austin (AUS) 8:00 AM\n- Arrival: Dallas (DFW) 9:15 AM\n\nLet me know if you need anything else!\n\nBest,\n[User]\n---\n\nShould I send this email?",
  "question": {
    "type": "confirmation",
    "prompt": "Should I send this email?",
    "options": ["Send", "Edit", "Cancel"]
  }
}
```

Worker:
1. Inserts assistant message
2. Sets `status` → `waiting_input`
3. Sets `state.pending_question`
4. Creates notification: "Email Monitor needs your attention"

### User Responds (via API)

User sends message: "Send it"

API handler:
1. Sees conversation is `waiting_input`
2. Passes message to Claude (synchronous, not worker)
3. Claude confirms and sends via Gmail MCP
4. Returns response: "✅ Email sent!"
5. Updates conversation:
   - `status` → `background` (continue monitoring)
   - `state.pending_question` → null
   - `next_run_at` → 5 minutes from now

### Conversation continues monitoring...

---

## Error Handling

### MCP Server Failure
- Retry up to 3 times with exponential backoff
- If persistent, set conversation to `waiting_input` with error message
- "I'm having trouble accessing Gmail. Please check your connection in Settings."

### Claude Code Timeout
- Mark this run as failed
- Conversation stays in `background`, will retry on next `next_run_at`
- After 3 consecutive failures, notify user

### Invalid/Expired OAuth Tokens
- Detect auth errors from MCP
- Set conversation to `waiting_input`
- "Your Gmail connection has expired. Please reconnect in Settings."
- Create notification with link to settings

---

## Concurrency Model

Simple in-process tracking:

```
MAX_CONCURRENT = 5

active_count = 0

worker_loop:
  if active_count >= MAX_CONCURRENT:
    skip this cycle
  
  conversations = query_ready_conversations(limit: MAX_CONCURRENT - active_count)
  
  for each conversation:
    active_count++
    spawn async:
      try:
        execute(conversation)
      finally:
        active_count--
```

No Redis, no external queue. Database `FOR UPDATE SKIP LOCKED` handles multi-instance safety if you scale horizontally later.