# Tasks: Add Conversation-Centric Task System

## 1. Database Schema
- [x] 1.1 Create conversations table with status, schedule, state, claude_session_id fields
- [x] 1.2 Create messages table with role, content, source fields
- [x] 1.3 Create user_integrations table for MCP OAuth credentials (encrypted)
- [x] 1.4 Create notifications table for user alerts
- [x] 1.5 Add database indexes for worker query (status, schedule, next_run_at)
- [x] 1.6 Run migrations

## 2. Shared Types & Utilities
- [x] 2.1 Define TypeScript types for Conversation, Message, Schedule, State
- [x] 2.2 Define response format types (NeedsInputResponse, ContinueResponse, CompleteResponse)
- [x] 2.3 Create cron expression parser utility for next_run_at calculation
- [x] 2.4 Create MCP config builder utility for per-user isolation

## 3. Chat Processing Service
- [x] 3.1 Implement conversation loader (with messages and state)
- [x] 3.2 Implement MCP config loader with credential decryption
- [x] 3.3 Build system prompt generator with integration info and state
- [x] 3.4 Implement Claude Code SDK wrapper with session resumption
- [x] 3.5 Implement response parser (create_schedule, needs_input, state_update)
- [x] 3.6 Implement conversation state updater
- [x] 3.7 Handle waiting_input responses (clear pending_question, update status)

## 4. Background Worker
- [x] 4.1 Implement polling loop (5-second interval)
- [x] 4.2 Implement ready conversation query with FOR UPDATE SKIP LOCKED
- [x] 4.3 Implement concurrency tracker (MAX_CONCURRENT cap)
- [x] 4.4 Build worker prompt with context, step, data, and response instructions
- [x] 4.5 Implement needs_input handler (set waiting_input, create notification)
- [x] 4.6 Implement continue handler (merge state_update, calculate next_run_at)
- [x] 4.7 Implement complete handler (one-time vs cron logic)
- [x] 4.8 Implement error handling (retry, timeout, auth errors)

## 5. API Routes
- [x] 5.1 POST /conversations - Create new conversation
- [x] 5.2 GET /conversations/:id - Get conversation with messages
- [x] 5.3 POST /conversations/:id/messages - Send message (chat handler)
- [x] 5.4 GET /notifications - Get user notifications
- [x] 5.5 PATCH /notifications/:id - Mark notification read

## 6. Testing
- [x] 6.1 Unit tests for cron parser
- [x] 6.2 Unit tests for response parser
- [x] 6.3 Integration tests for chat flow (normal, schedule creation, needs_input)
- [x] 6.4 Integration tests for worker flow (continue, complete, needs_input)
- [x] 6.5 Test concurrent worker execution
- [x] 6.6 Test error handling scenarios

## 7. Documentation
- [x] 7.1 Document API endpoints
- [x] 7.2 Document conversation state machine
- [x] 7.3 Document MCP integration setup

## Dependencies
- Tasks 2.x can run in parallel with 1.x
- Task 3.x depends on 1.x and 2.x completion
- Task 4.x depends on 1.x and 2.x completion
- Tasks 3.x and 4.x can run in parallel
- Task 5.x depends on 3.x and 4.x
- Task 6.x depends on 5.x
- Task 7.x can run anytime after 5.x
