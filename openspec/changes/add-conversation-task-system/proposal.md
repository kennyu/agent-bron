# Change: Add Conversation-Centric Task System

## Why
Users need a natural way to create and manage background tasks through conversation. Instead of a separate "tasks" UI, the system treats everything as a conversation that can optionally have scheduled background work. This enables natural interactions like "watch my email for X" that spawn autonomous agents checking back for human input when needed.

## What Changes
- **NEW** Conversation model with status states (active, background, waiting_input, archived)
- **NEW** Background worker system that polls for scheduled conversations and executes Claude Code
- **NEW** Chat processing service that handles real-time messages with MCP tool access
- **NEW** Shared context between interactive chat and background worker (same session, messages, state)
- **NEW** Structured response handling for worker outputs (needs_input, continue, complete)
- **NEW** Per-user MCP isolation with encrypted OAuth credentials

## Impact
- Affected specs: `conversation`, `background-worker`, `chat-processing` (all new capabilities)
- Affected code: Database schema, API routes, worker process, chat service
- This establishes the core architecture for the entire Agentic Tasks platform
