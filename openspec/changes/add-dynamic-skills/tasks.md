# Tasks: Add Dynamic Skills System

## 1. Types and Interfaces
- [x] 1.1 Add `Skill`, `AgentDefinition`, `MergedSkillConfig` types to `packages/shared-types/src/index.ts`
- [x] 1.2 Add `skills` field to `ClaudeQueryOptions` interface in `claude-client.ts`

## 2. Skill Registry
- [x] 2.1 Create `apps/api/src/config/skills.ts` with predefined skills
- [x] 2.2 Implement `getSkill(name)` and `getAllSkills()` functions
- [x] 2.3 Implement `mergeSkills(skills[])` function

## 3. Claude Client Integration
- [x] 3.1 Update `buildQueryOptions()` to resolve and merge skills
- [x] 3.2 Pass merged `agents` to SDK options
- [x] 3.3 Merge skill MCP servers with user MCP config
- [x] 3.4 Append skill prompts to system prompt

## 4. API Endpoints
- [x] 4.1 Create `apps/api/src/routes/skills.ts` with GET /skills endpoint
- [x] 4.2 Add GET /skills/:name endpoint for skill details
- [x] 4.3 Register routes in `apps/api/src/index.ts`

## 5. Testing
- [x] 5.1 Add unit tests for `mergeSkills()` function
- [x] 5.2 Add unit tests for skill resolution in `buildQueryOptions()`
- [x] 5.3 Add API tests for /skills endpoints
