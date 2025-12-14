# Task Automation App - "Agentic Tasks"

## Overview

A multi-user task automation platform where everything is a conversation. Users chat with Claude to create background tasks that monitor, schedule, and execute work autonomously—checking back for human input when needed.

**Like Google Jules**: Chat interface spawns background work that runs independently and returns for confirmation.

---

## Core Concept: Everything is a Conversation

Instead of separate "tasks" and "chats", there's just **conversations**. A conversation can:
- Be a normal chat (no background work)
- Have scheduled background work (cron, one-time)
- Be waiting for user input (question, confirmation)

This simplifies the model and creates a natural UX—users just chat.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Claude Code SDK is JS-native, Cloudflare Workers support |
| Backend | Hono | Works in Node.js, Workers, Deno |
| Database | PostgreSQL + Drizzle | Reliable, handles queue via polling |
| AI | Claude Code SDK | MCP support, session resumption |
| Web | React + TanStack Query | Standard, shared API client |
| iOS | React Native | Code sharing with web |
| CLI | Commander.js | Same API client |

---

## Key Design Decisions

### 1. Conversation-Centric Model
- No separate "tasks" table
- Conversations have `status` and optional `schedule`
- Background work, questions, confirmations—all in conversation flow
- See "Conversation-Centric Design" doc

### 2. Generic "Waiting for Input"
- Not task-specific
- Covers: confirmations, clarifying questions, multiple choice, free input
- User just replies in chat to continue
- See `state.pending_question` in schema

### 3. Shared Claude Context
- Chat Claude and Worker Claude share same conversation
- Same messages, state, session ID
- Natural continuity: "how's that email task going?"
- See "Claude Code Memory & Context" doc

### 4. Polling Over WebSockets
- 5-second polling for notifications
- 10-second polling for conversation updates
- Simpler infrastructure, acceptable for 10s latency target

### 5. PostgreSQL as Queue
- `FOR UPDATE SKIP LOCKED` for safe concurrent pickup
- No Redis/RabbitMQ needed
- Worker polls every 5 seconds

### 6. Per-User MCP Isolation
- Each user's OAuth tokens encrypted separately
- Worker builds MCP config dynamically per conversation
- User A's Gmail never mixed with User B's

---

## Project Structure

```
agentic-tasks/
├── apps/
│   ├── api/                    # Hono API + Background Worker
│   │   ├── src/
│   │   │   ├── routes/         # API endpoints
│   │   │   ├── services/       # Chat processing, Claude execution
│   │   │   ├── worker/         # Polling background worker
│   │   │   └── index.ts
│   │   └── wrangler.toml       # Cloudflare config (optional)
│   ├── web/                    # React SPA
│   ├── mobile/                 # React Native iOS
│   └── cli/                    # Node.js CLI
├── packages/
│   ├── api-client/             # Shared fetch wrapper
│   ├── db/                     # Drizzle schema + migrations
│   └── shared-types/           # TypeScript types
├── docker-compose.yml          # Local dev (Postgres)
└── package.json
```

---

## Conversation Statuses

| Status | Meaning | Worker Picks Up? |
|--------|---------|------------------|
| `active` | Normal chat, no background work | No |
| `background` | Has scheduled work running | Yes (when due) |
| `waiting_input` | Claude asked something, paused | No |
| `archived` | Conversation complete/inactive | No |

---

## Example Flows

### Email Watcher
```
User: "Watch my email for AA flight receipts, email Rebecca when found"

Claude: "I'll monitor every 5 minutes. When I find one, I'll draft 
        an email and ask you to confirm."
        
[Status: background, schedule: */5 * * * *]

... 2 hours later, worker finds email ...

Claude: "Found a receipt! Here's the draft to Rebecca...
        Should I send it?"
        
[Status: waiting_input]

User: "Send it"

Claude: "✅ Email sent! Continuing to monitor."

[Status: background]
```

### Clarifying Question
```
User: "Help me find photos from my trip"

Claude: "I'd be happy to help! Which trip are you looking for?"

[Status: waiting_input]

User: "Japan last October"

Claude: "Found 247 photos from October 2024 in Japan! Here are highlights..."

[Status: active]
```

### Podcast Creation
```
User: "Create a podcast about AI news"

Claude: "I'll create an AI news podcast. A few questions:
        1. What length? 
        2. What tone?"
        
[Status: waiting_input]

User: "10 minutes, casual"

Claude: "Perfect! I'll research this week's AI stories and prepare 
        an outline for your review."
        
[Status: background, schedule: immediate]

... worker researches ...

Claude: "Here's the outline. Does this look good?"

[Status: waiting_input]
```

---

## Supported MCP Integrations

| Integration | Auth Type | Use Cases |
|-------------|-----------|-----------|
| Gmail | OAuth | Email monitoring, sending, drafts |
| Google Photos | OAuth | Photo search, albums |
| Google Drive | OAuth | File access, storage |
| Slack | OAuth | Message monitoring, sending |
| File System | Token | Local file access |

Users configure integrations in Settings. Each user has separate credentials.

---

## Security

- **OAuth tokens**: Encrypted at rest (AES-256)
- **Token decryption**: Only at execution time
- **User isolation**: Each conversation runs with only that user's MCP configs
- **JWT auth**: Short-lived access tokens, refresh rotation
- **API keys**: For CLI, long-lived but revocable

---

## Deployment

**Recommended: Fly.io**
- Single Node.js process (API + Worker)
- Fly Postgres
- ~$10-20/month to start
- No cold starts, easy debugging

**Alternative: Cloudflare Workers + Neon**
- Edge deployment
- Serverless Postgres
- May have issues with Claude Code subprocess model

See "Deployment & Infrastructure" doc for details.
