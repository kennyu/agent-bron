# Change: Add Dynamic Skills System

## Why
The current Claude Agent implementation has a fixed set of allowed tools configured globally. Users cannot customize agent capabilities based on their task needs, and the agent cannot adapt its behavior to different contexts. A dynamic skills system enables:
- Specialized agent behaviors for different use cases (code review, research, file operations)
- Auto-detection of required skills based on user intent
- Both predefined system skills and user-defined custom skills

## What Changes
- Add `skills` database table to store skill definitions (name, allowed tools, system prompt, optional MCP servers)
- Add predefined system skills seeded on startup (code-review, research, file-operations, web-search)
- Add skill detection service that analyzes user messages and activates relevant skills
- Modify `ClaudeAgentClient` to accept dynamic skill configurations per query
- Add API endpoints for skill management (CRUD for custom skills, list available skills)
- Store active skills per conversation in the `conversations` table

## Impact
- Affected specs: None existing (new capability)
- Affected code:
  - `packages/db/src/schema.ts` (add skills and conversation_skills tables)
  - `apps/api/src/services/claude-client.ts` (accept skill-based tool/prompt config)
  - `apps/api/src/services/skill-detector.ts` (new - analyzes intent, selects skills)
  - `apps/api/src/services/skill-manager.ts` (new - CRUD operations for skills)
  - `apps/api/src/routes/skills.ts` (new - REST endpoints)
  - `apps/api/src/routes/conversations.ts` (integrate skill detection)
  - `packages/shared-types/src/index.ts` (add skill types)
