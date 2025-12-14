# Chat Processing Flow

## Overview

When a user sends a message, the system processes it through Claude with full conversation context. Claude can:
- Respond conversationally
- Create background schedules
- Answer pending questions
- Use MCP tools directly

---

## Message Processing Pipeline

```
User sends message
        │
        ▼
┌─────────────────────────────────────┐
│ Load conversation + messages        │
│ Load conversation.state             │
│ Load user's MCP configs             │
└───────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│ Is conversation waiting_input?      │
│                                     │
│ Yes → User is answering a question  │
│ No  → Normal chat message           │
└───────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│ Call Claude Code SDK                │
│ • Full message history              │
│ • Conversation state                │
│ • User's MCP servers                │
│ • Session resumption                │
└───────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│ Process Claude's response           │
│ • Save assistant message            │
│ • Update conversation state/status  │
│ • Create notification if needed     │
└─────────────────────────────────────┘
```

---

## Claude's Capabilities in Chat

### 1. Normal Conversation
Just chat—answer questions, help with tasks, no background work.

### 2. Create Background Schedule
When user asks for monitoring, scheduled, or long-running work:

```json
{
  "create_schedule": {
    "type": "cron",
    "cron_expression": "*/5 * * * *",
    "initial_state": {
      "context": { "description": "Monitor for AA receipts" },
      "step": "monitoring"
    }
  },
  "message": "I'll monitor your inbox every 5 minutes..."
}
```

System sets `conversation.schedule`, `conversation.status = 'background'`, `next_run_at`.

### 3. Ask for Input
When Claude needs clarification or confirmation:

```json
{
  "needs_input": {
    "type": "choice",
    "prompt": "Which Gmail account should I monitor?",
    "options": ["Work (john@company.com)", "Personal (john@gmail.com)"]
  },
  "message": "I can monitor either of your Gmail accounts. Which one?"
}
```

System sets `conversation.status = 'waiting_input'`, `state.pending_question`.

### 4. Use MCP Tools Directly
For immediate actions (search photos, check email now):

Claude calls MCP tools, gets results, responds—all synchronous in the chat.

---

## System Prompt Structure

```
You are an AI assistant in a conversation that may have background work.

USER'S CONNECTED INTEGRATIONS:
- Gmail (john@company.com)
- Google Photos

AVAILABLE INTEGRATIONS (not connected):
- Slack
- Google Drive

CONVERSATION STATE:
{conversation.state as JSON}

CONVERSATION STATUS: {status}
{if waiting_input: "User is responding to: {pending_question.prompt}"}
{if background: "Background work is scheduled: {schedule}"}

INSTRUCTIONS:

For normal conversation, just respond naturally.

To create background/scheduled work, include in your response:
{
  "create_schedule": { "type": "cron|scheduled|immediate", ... },
  "message": "Your response to user"
}

To ask for user input (question, confirmation, choice), include:
{
  "needs_input": { "type": "confirmation|choice|input", "prompt": "...", "options": [...] },
  "message": "Your response to user"
}

To update conversation state without scheduling:
{
  "state_update": { "key": "value" },
  "message": "Your response"
}

If user is responding to a pending question, process their answer appropriately.
```

---

## Handling User Responses

When `conversation.status = 'waiting_input'` and user sends a message:

### Confirmation Response
```
Pending: "Should I send this email?" [Send, Edit, Cancel]
User: "Send it"

Claude processes → sends email via MCP → responds with result
System clears pending_question, updates status
```

### Choice Response
```
Pending: "Which account?" [Work, Personal]
User: "Work"

Claude processes → updates state with choice → continues
```

### Free Input Response
```
Pending: "What subject line would you like?"
User: "Meeting next Tuesday"

Claude processes → uses input → continues
```

### Off-Topic Response
```
Pending: "Should I send this email?"
User: "Wait, what's in the email again?"

Claude can answer the question while keeping pending_question active
Or re-present the question with more context
```

---

## MCP Integration Check

Before creating schedules that need specific integrations:

```
User: "Monitor my Slack for mentions"

Claude checks: User has Slack configured? 

No → "To monitor Slack, you'll need to connect it first. 
      Go to Settings → Integrations to add Slack."
      
Yes → Creates schedule with Slack MCP
```

---

## Example: Full Email Watcher Flow

### Message 1: User Request
```
User: "Watch my email for AA flight receipts from Austin. 
       When found, draft an email to Rebecca@gauntlet.ai 
       and ask me before sending."

Claude response:
{
  "create_schedule": {
    "type": "cron",
    "cron_expression": "*/5 * * * *",
    "initial_state": {
      "context": {
        "description": "Monitor for AA flight receipts from Austin",
        "action": "Draft email to Rebecca@gauntlet.ai, confirm before send"
      },
      "step": "monitoring",
      "data": {}
    }
  },
  "message": "I'll check your inbox every 5 minutes for American Airlines 
              receipts mentioning Austin. When I find one, I'll draft an 
              email to Rebecca and ask you to review it before sending.
              
              I'll let you know as soon as I find something!"
}
```

Conversation now:
- `status`: "background"
- `schedule`: { type: "cron", cron_expression: "*/5 * * * *" }
- `next_run_at`: 5 minutes from now

### Message 2: Worker Finds Email (background)

See "Background Worker System" doc—worker adds message, sets `waiting_input`.

### Message 3: User Confirms

```
User: "Send it"

Claude (synchronous in chat):
- Sees pending confirmation about sending email
- Calls Gmail MCP to send the draft
- Responds: "✅ Email sent to Rebecca@gauntlet.ai! 
            I'll continue monitoring for more receipts."

Conversation now:
- `status`: "background" (back to monitoring)
- `state.pending_question`: null
- `next_run_at`: 5 minutes from now
```

### Message 4: User Asks Status

```
User: "Any more receipts?"

Claude (has full context):
"Not yet! I've checked 15 times since we started. I found that one 
receipt for flight AA1234 to Austin, which I sent to Rebecca. 
I'll keep monitoring and let you know if I find more."
```

---

## Error Cases

### Missing MCP Integration
```
User: "Search my Google Drive for tax documents"

Claude: "I don't have access to your Google Drive yet. 
        Please connect it in Settings → Integrations, 
        then I'll be able to search your files."
```

### Expired OAuth Token
```
User sends message, but Gmail token is expired

Claude: "I'm having trouble accessing your Gmail—the connection 
        may have expired. Please reconnect Gmail in Settings 
        to continue monitoring."

Update conversation status to waiting_input with reconnect prompt
```

### Ambiguous Request
```
User: "Watch for important emails"

Claude: "I'd be happy to monitor your inbox! To help me filter 
        effectively, could you tell me:
        - What senders or subjects should I look for?
        - What should I do when I find a match?"
        
{
  "needs_input": {
    "type": "input",
    "prompt": "What specific emails should I watch for?"
  }
}
```
