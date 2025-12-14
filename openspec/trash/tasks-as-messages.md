# Claude Code Memory & Context

## The Question

Should the "chat Claude" (interactive) and "worker Claude" (background) share context, or be separate?

---

## Recommendation: Same Context

**They should share the same conversation context.** Here's why:

### 1. Continuity
When user asks "how's that email task going?", Claude should know what they're talking about without re-explaining.

### 2. Natural Interaction
User replies to background work naturally—"send it", "change the subject line", "actually cancel that". Claude needs conversation history to understand these.

### 3. Simpler Architecture
One conversation, one context. No syncing between separate systems.

---

## How It Works

### Chat Claude (Interactive)
- Handles real-time user messages
- Has full conversation history
- Can create/modify background schedules
- Responds immediately

### Worker Claude (Background)
- Runs on schedule (cron, delayed, etc.)
- **Loads same conversation + messages**
- Adds messages to same conversation
- Can pause and ask for input (becomes interactive)

### They're the Same Claude
Both use Claude Code SDK with:
- Same conversation history
- Same user MCP configs  
- Same `claude_session_id` for continuity

The difference is just **when** they run:
- Chat: When user sends message
- Worker: When `next_run_at` time comes

---

## Context Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Conversation                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Messages (shared history)                         │  │
│  │ • User: "Watch my email for..."                   │  │
│  │ • Assistant: "I'll monitor every 5 min..."        │  │
│  │ • Assistant: "Found a receipt! Send?"  ← Worker   │  │
│  │ • User: "Send it"                                 │  │
│  │ • Assistant: "✅ Sent!"                ← Chat     │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ State (shared)                                    │  │
│  │ • context: { description, params }                │  │
│  │ • step: "monitoring"                              │  │
│  │ • data: { searches_completed: 15 }                │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ claude_session_id (shared)                        │  │
│  │ • Allows Claude to resume context efficiently     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
          │                           │
          │                           │
    ┌─────┴─────┐               ┌─────┴─────┐
    │ Chat Flow │               │  Worker   │
    │ (user msg)│               │ (on cron) │
    └───────────┘               └───────────┘
```

---

## Session Resumption

Claude Code SDK supports session resumption:

```typescript
const claude = new ClaudeCode({
  sessionId: conversation.claude_session_id,  // Resume existing
  mcpServers: userMcpConfig,
});

const result = await claude.run({ prompt });

// Save for next run
conversation.claude_session_id = result.sessionId;
```

**Benefits:**
- Claude remembers tool results, reasoning from previous runs
- Cheaper (less context to re-process)
- More coherent multi-step workflows

**Both chat and worker use the same session ID**, so Claude has unified memory whether user is chatting or background work is running.

---

## What Gets Passed to Claude

### For Chat (user sends message)
```
System: You are helping with a conversation that may have background work.

Conversation state:
{conversation.state}

Recent messages:
[last N messages]

User's new message:
{new message}

If this conversation has scheduled work, you can:
- Check status, modify schedule
- Answer questions about what's happening
- Process user's response to pending questions
```

### For Worker (background run)
```
System: You are executing background work for a conversation.

Conversation state:
{conversation.state}

Recent messages:
[last N messages]

Instructions:
Continue the background task. Current step: {state.step}

Respond with one of:
- needs_input: true (pause and ask user)
- continue: true (keep running, update state)
- complete: true (finished)
```

---

## Example: Unified Context

### T+0: User starts conversation
```
User: Watch my email for AA receipts, email Rebecca when found

Claude: I'll monitor your inbox every 5 minutes for American Airlines 
receipts. When I find one, I'll draft an email to Rebecca and ask 
you to confirm before sending.

[Schedule created, status: background]
```

### T+30min: Worker finds email
```
Claude (worker): Found a flight receipt! Here's the draft...
Should I send this?

[Status: waiting_input]
```

### T+35min: User asks question
```
User: What flight is it?

Claude (chat): The receipt I found is for flight AA1234 on January 20th,
departing Austin (AUS) at 8:00 AM. Would you like me to send the 
email to Rebecca with these details?
```

Claude understood the question because it has the full conversation context—worker messages included.

### T+36min: User confirms
```
User: Yes, send it

Claude (chat): ✅ Email sent to Rebecca@gauntlet.ai!
I'll continue monitoring for more receipts.

[Status: background, schedule continues]
```

---

## When Context Is NOT Shared

You might want separate contexts if:
- Running many independent micro-tasks
- Tasks don't need conversational continuity
- Cost optimization (smaller context = cheaper)

But for this app's use cases (email watching, podcast creation, photo search), shared context makes the most sense. Users expect to chat naturally about their tasks.
