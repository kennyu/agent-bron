# Agent Bron

An agentic task system powered by Claude and the Claude Agent SDK. Supports background tasks, scheduled execution, and dynamic skills.

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and DATABASE_URL

# Run migrations
bun run db:migrate

# Start the server
bun run dev
```

## Docker

```bash
# Start PostgreSQL + API
ANTHROPIC_API_KEY=sk-... docker compose up -d

# Run migrations
docker compose --profile migrate run migrate
```

## API Endpoints

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/conversations` | Create a conversation |
| GET | `/conversations` | List conversations |
| GET | `/conversations/:id` | Get conversation with messages |
| POST | `/conversations/:id/messages` | Send a message |
| POST | `/conversations/:id/messages/stream` | Send message (SSE streaming) |
| PATCH | `/conversations/:id` | Update conversation |
| DELETE | `/conversations/:id` | Delete conversation |
| PATCH | `/conversations/:id/pause` | Pause background agent |
| PATCH | `/conversations/:id/resume` | Resume background agent |
| POST | `/conversations/:id/run-now` | Trigger immediate execution |

### Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/skills` | List available skills |
| GET | `/skills/:name` | Get skill details |

## Skills

Skills bundle tools, MCP servers, and subagents into reusable packages.

### Available Skills

| Skill | Tools | Features |
|-------|-------|----------|
| `code-reviewer` | Read, Grep, Glob | `security-scanner` subagent |
| `file-editor` | Read, Write, Edit, Glob | - |
| `code-runner` | Bash, Read, Grep | `test-runner` subagent |
| `researcher` | WebSearch, WebFetch, Read | - |
| `email-assistant` | Read | Gmail MCP server |

### Using Skills

**Set default skills when creating a conversation:**
```json
POST /conversations
{
  "title": "Code Review Session",
  "skills": ["code-reviewer"]
}
```

**Override skills per message:**
```json
POST /conversations/:id/messages/stream
{
  "content": "Review this code",
  "skills": ["code-reviewer", "researcher"]
}
```

## Background Tasks

Conversations can transition to background mode with scheduled execution:

- **Cron**: Recurring schedule (e.g., `0 9 * * *` for daily at 9am)
- **Scheduled**: One-time execution at a specific time
- **Immediate**: Run as soon as possible

The background worker polls for ready conversations and executes them with the Claude Agent SDK.

## Project Structure

```
apps/
  api/
    src/
      config/skills.ts    # Skill definitions
      routes/             # API endpoints
      services/           # Claude client, chat processing
      worker/             # Background worker
packages/
  db/
    src/schema.ts         # Drizzle schema
    migrations/           # SQL migrations
  shared-types/           # TypeScript types
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |

## Development

```bash
# Run tests
bun test

# Generate migration
bun run db:generate

# Open Drizzle Studio
bun run db:studio
```
