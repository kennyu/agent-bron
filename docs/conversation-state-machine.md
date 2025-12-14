# Conversation State Machine

This document describes the conversation status lifecycle and transitions in the Agentic Tasks platform.

## Overview

Every conversation has a `status` field that determines its current state in the system. The status affects how the conversation is processed by both the chat handler and the background worker.

## Status States

### `active`

The default state for new conversations.

**Characteristics:**
- Normal interactive chat mode
- No background work scheduled
- User can send messages and receive immediate responses
- No polling by background worker

**Transitions From:**
- Initial creation
- `waiting_input` (after user responds and no schedule exists)
- `background` (when one-time task completes)

---

### `background`

The conversation has scheduled background work.

**Characteristics:**
- Background worker polls for this conversation
- Work executes according to schedule (cron, scheduled time, or immediately)
- User can still chat interactively while background work runs
- Has `nextRunAt` set to indicate when work should execute

**Transitions From:**
- `active` (when user creates a schedule via chat)
- `waiting_input` (when user responds and schedule exists)

**Transitions To:**
- `waiting_input` (when Claude needs user input)
- `active` (when one-time task completes)
- `archived` (when user archives)

---

### `waiting_input`

Claude has asked a question and is waiting for user response.

**Characteristics:**
- Background work is paused
- `pendingQuestion` contains the question details
- User must respond before work continues
- Notification is sent to user

**Transitions From:**
- `background` (when Claude returns `needs_input`)
- `active` (when Claude returns `needs_input` in chat)

**Transitions To:**
- `background` (when user responds and schedule exists)
- `active` (when user responds and no schedule exists)

---

### `archived`

The conversation is inactive and archived.

**Characteristics:**
- No messages can be sent
- No background work runs
- Schedule is cleared
- Conversation remains visible but read-only

**Transitions From:**
- Any state (via user action)

---

## State Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
┌──────────┐    schedule    ┌────────────┐    needs_input    ┌────────────────┐
│  active  │ ──────────────>│ background │ ─────────────────>│ waiting_input  │
└──────────┘                └────────────┘                   └────────────────┘
     ▲                           │   │                              │
     │                           │   │                              │
     │   complete (one-time)     │   │      user responds           │
     └───────────────────────────┘   │      (has schedule)          │
                                     │      ┌───────────────────────┘
                                     │      │
                                     │      ▼
                                     └──────┘

                    Any State ────────────────────> archived
                              (user archives)
```

## Transition Triggers

### Chat Handler Triggers

| Trigger | From | To | Description |
|---------|------|----|-------------|
| `create_schedule` response | active | background | Claude creates a scheduled task |
| `needs_input` response | active | waiting_input | Claude asks user a question |
| User response | waiting_input | active | User answers (no schedule) |
| User response | waiting_input | background | User answers (has schedule) |

### Worker Triggers

| Trigger | From | To | Description |
|---------|------|----|-------------|
| `needs_input` response | background | waiting_input | Claude needs user input |
| `complete` response (cron) | background | background | Task cycle done, reschedule |
| `complete` response (one-time) | background | active | Task finished |
| `continue` response | background | background | Keep working |
| Auth error | background | waiting_input | Credentials expired |

### User Triggers

| Trigger | From | To | Description |
|---------|------|----|-------------|
| Archive | any | archived | User archives conversation |

## Pending Questions

When a conversation enters `waiting_input`, it has a `pendingQuestion` object:

```typescript
interface PendingQuestion {
  type: 'confirmation' | 'choice' | 'input';
  prompt: string;
  options?: string[];  // For choice type
}
```

### Question Types

**Confirmation:**
```json
{
  "type": "confirmation",
  "prompt": "Should I proceed with deleting 5 files?"
}
```
Expected response: Yes/No affirmation

**Choice:**
```json
{
  "type": "choice",
  "prompt": "Which format do you prefer?",
  "options": ["PDF", "CSV", "Excel"]
}
```
Expected response: One of the provided options

**Input:**
```json
{
  "type": "input",
  "prompt": "What email address should I send the report to?"
}
```
Expected response: Free-form text

## Schedule Types

When a conversation has background work, the `schedule` object indicates the type:

### Cron

Recurring schedule using cron expressions:
```json
{
  "type": "cron",
  "cronExpression": "0 9 * * 1-5"
}
```
- Runs according to cron expression
- After completion, reschedules automatically
- Examples:
  - `0 9 * * *` - Daily at 9 AM
  - `*/5 * * * *` - Every 5 minutes
  - `0 9 * * 1-5` - Weekdays at 9 AM

### Scheduled

One-time execution at a specific time:
```json
{
  "type": "scheduled",
  "runAt": "2024-12-31T10:00:00.000Z"
}
```
- Runs once at the specified time
- Status returns to `active` after completion

### Immediate

Run as soon as possible:
```json
{
  "type": "immediate"
}
```
- Executes on next worker poll
- Used for tasks that should start right away
- Status returns to `active` after completion (unless `continue` response)

## State in Database

The conversation table stores state information:

```sql
-- Status
status: 'active' | 'background' | 'waiting_input' | 'archived'

-- Schedule
schedule_type: 'cron' | 'scheduled' | 'immediate' | NULL
cron_expression: string | NULL
scheduled_run_at: timestamp | NULL
next_run_at: timestamp | NULL

-- State data
state_context: JSONB      -- Task description, params
state_step: string        -- Current workflow step
state_data: JSONB         -- Accumulated state

-- Pending question
pending_question_type: 'confirmation' | 'choice' | 'input' | NULL
pending_question_prompt: string | NULL
pending_question_options: string[] | NULL
```

## Best Practices

1. **Always check status before sending messages**
   - Archived conversations reject new messages

2. **Handle `waiting_input` appropriately in UI**
   - Display the pending question prominently
   - Guide user to respond

3. **Show schedule information**
   - Display `nextRunAt` for background conversations
   - Indicate cron schedule in human-readable format

4. **Handle status changes from responses**
   - `newStatus` in response indicates transition occurred
   - Update UI accordingly

5. **Clear schedules when archiving**
   - Background work stops when archived
   - User should be warned before archiving active tasks
