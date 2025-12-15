# Task Scheduling System Implementation Plan

## Overview
Add a multi-task scheduling system where conversations can have multiple scheduled tasks with interval-based scheduling, expiration limits, and natural language creation via Claude.

## Requirements
1. **Multiple tasks per conversation** - Users can create multiple scheduled tasks in one conversation
2. **Interval-based scheduling** - Support "every X seconds/minutes" with 15-second minimum
3. **Task expiration** - Both max runs AND max duration limits
4. **Task deletion** - Delete individual tasks without affecting conversation
5. **Natural language** - Claude creates tasks from "say hello every 15 seconds for 5 minutes"

---

## Phase 1: Database Schema

### File: `packages/db/src/schema.ts`

Add new enums and `tasks` table:

```typescript
// Task status enum
export const taskStatusEnum = pgEnum('task_status', [
  'active',
  'paused',
  'completed',
  'deleted',
]);

// Interval unit enum
export const intervalUnitEnum = pgEnum('interval_unit', [
  'seconds',
  'minutes',
  'hours',
  'days',
]);

// Tasks table
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),

    // Task identity
    name: text('name').notNull(),
    description: text('description'),

    // Status
    status: taskStatusEnum('status').notNull().default('active'),

    // Interval-based scheduling
    intervalValue: text('interval_value'),
    intervalUnit: intervalUnitEnum('interval_unit'),

    // Cron-based scheduling (alternative)
    cronExpression: text('cron_expression'),

    // Execution timing
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    // Expiration limits
    maxRuns: text('max_runs'),
    currentRuns: text('current_runs').default('0'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Task context
    taskContext: jsonb('task_context').$type<Record<string, unknown>>(),

    // Error tracking
    consecutiveFailures: text('consecutive_failures').default('0'),
    lastError: text('last_error'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tasks_worker_query').on(table.status, table.nextRunAt),
    index('idx_tasks_conversation_id').on(table.conversationId),
    index('idx_tasks_user_id').on(table.userId),
  ]
);

// Add type exports
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
```

### File: `packages/db/migrations/0002_add_tasks_table.sql`

Create SQL migration for the new table.

---

## Phase 2: Shared Types

### File: `packages/shared-types/src/index.ts`

Add task-related types:

```typescript
// Task types
export type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export interface Task {
  id: string;
  conversationId: string;
  userId: string;
  name: string;
  description?: string;
  status: TaskStatus;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  maxRuns?: number;
  currentRuns: number;
  expiresAt?: Date;
  taskContext: Record<string, unknown>;
  consecutiveFailures: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Request type for creating tasks
export interface CreateTaskRequest {
  name: string;
  description?: string;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  maxRuns?: number;
  durationSeconds?: number;  // Converted to expiresAt
  taskContext?: Record<string, unknown>;
}

// Claude response types for tasks
export interface CreateTaskResponse {
  create_task: CreateTaskRequest;
  message: string;
}

export interface DeleteTaskResponse {
  delete_task: {
    taskId?: string;
    taskName?: string;
  };
  message: string;
}

// Type guards
export function isCreateTaskResponse(response: unknown): response is CreateTaskResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'create_task' in response &&
    typeof (response as CreateTaskResponse).create_task === 'object'
  );
}

export function isDeleteTaskResponse(response: unknown): response is DeleteTaskResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'delete_task' in response &&
    typeof (response as DeleteTaskResponse).delete_task === 'object'
  );
}
```

---

## Phase 3: Task Worker

### File: `apps/api/src/worker/task-worker.ts`

Create new worker that polls `tasks` table:

**Key logic:**
1. Poll query:
   ```sql
   SELECT * FROM tasks
   WHERE status = 'active'
     AND next_run_at <= NOW()
     AND (expires_at IS NULL OR expires_at > NOW())
     AND (max_runs IS NULL OR current_runs::int < max_runs::int)
   FOR UPDATE SKIP LOCKED
   LIMIT $limit
   ```

2. Execution flow:
   - Load parent conversation and messages
   - Build task-specific prompt with task context
   - Run Claude with conversation context
   - Increment `currentRuns`, set `lastRunAt`
   - Calculate new `nextRunAt` or mark `completed` if limits reached

3. Next run calculation:
   ```typescript
   function calculateNextRunAt(task): Date | null {
     // Check if expired or max runs reached -> return null
     // For interval: now + intervalValue * intervalUnit
     // For cron: use existing getNextRunTime()
   }
   ```

### File: `apps/api/src/index.ts`

Start task worker alongside existing background worker.

---

## Phase 4: API Endpoints

### File: `apps/api/src/routes/tasks.ts`

New routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List user's tasks (filter by conversationId) |
| GET | `/tasks/:id` | Get task details |
| POST | `/tasks` | Create task |
| PATCH | `/tasks/:id` | Update task (pause/resume) |
| DELETE | `/tasks/:id` | Soft delete task |
| POST | `/tasks/:id/run-now` | Trigger immediate execution |

**Validation:**
- Interval minimum: 15 seconds
- Either interval OR cron required
- conversationId must exist and belong to user

---

## Phase 5: Claude Integration (Detailed)

### 5.1 Database Interface Extension

Add task operations to `DatabaseConnection` interface in `chat-processing.ts`:

```typescript
interface DatabaseConnection {
  // ... existing methods ...

  // New task methods
  getConversationTasks(conversationId: string): Promise<TaskRecord[]>;
  createTask(task: NewTaskRecord): Promise<TaskRecord>;
  deleteTask(taskId: string): Promise<void>;
  findTaskByName(conversationId: string, name: string): Promise<TaskRecord | null>;
}

interface TaskRecord {
  id: string;
  conversationId: string;
  userId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'deleted';
  intervalValue: string | null;
  intervalUnit: 'seconds' | 'minutes' | 'hours' | 'days' | null;
  cronExpression: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  maxRuns: string | null;
  currentRuns: string;
  expiresAt: Date | null;
  taskContext: Record<string, unknown> | null;
  consecutiveFailures: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NewTaskRecord {
  conversationId: string;
  userId: string;
  name: string;
  description?: string;
  intervalValue?: string;
  intervalUnit?: 'seconds' | 'minutes' | 'hours' | 'days';
  cronExpression?: string;
  nextRunAt?: Date;
  maxRuns?: string;
  expiresAt?: Date;
  taskContext?: Record<string, unknown>;
}
```

### 5.2 System Prompt Updates

Modify `buildSystemPrompt()` to include active tasks and task instructions:

```typescript
private buildSystemPrompt(
  conversation: ConversationRecord,
  integrations: IntegrationRecord[],
  tasks: TaskRecord[]  // NEW parameter
): string {
  // ... existing integration formatting ...

  // Format active tasks for Claude
  const activeTasks = tasks.filter(t => t.status === 'active');
  const tasksJson = activeTasks.length > 0
    ? JSON.stringify(
        activeTasks.map(t => ({
          id: t.id,
          name: t.name,
          schedule: t.intervalValue && t.intervalUnit
            ? `every ${t.intervalValue} ${t.intervalUnit}`
            : t.cronExpression,
          currentRuns: parseInt(t.currentRuns, 10),
          maxRuns: t.maxRuns ? parseInt(t.maxRuns, 10) : null,
          expiresAt: t.expiresAt?.toISOString() || null,
          lastRunAt: t.lastRunAt?.toISOString() || null,
        })),
        null,
        2
      )
    : 'No active tasks';

  return `You are an AI assistant in a conversation that can create and manage scheduled tasks.

USER'S CONNECTED INTEGRATIONS:
${connectedList}

AVAILABLE INTEGRATIONS (not connected):
${availableList}

CONVERSATION STATE:
${stateJson}

ACTIVE SCHEDULED TASKS:
${tasksJson}

CONVERSATION STATUS: ${conversation.status}
${statusContext}

INSTRUCTIONS:

For normal conversation, just respond naturally.

## Creating Scheduled Tasks

To create a scheduled task, include in your response:
{
  "create_task": {
    "name": "descriptive task name",
    "description": "what this task does (optional)",
    "intervalValue": 15,
    "intervalUnit": "seconds",
    "maxRuns": 10,
    "durationSeconds": 300,
    "taskContext": { "greeting": "Hello!" }
  },
  "message": "Your response to user"
}

### Schedule Options (pick ONE):

**Interval-based** (minimum 15 seconds):
- intervalValue: number (e.g., 15, 30, 1, 5)
- intervalUnit: "seconds" | "minutes" | "hours" | "days"

**Cron-based** (minimum 1 minute):
- cronExpression: standard 5-field cron (e.g., "*/5 * * * *" for every 5 minutes)

### Expiration Options (optional, can use both):

- maxRuns: stop after N executions (e.g., 10)
- durationSeconds: stop after N seconds from now (e.g., 300 for 5 minutes)

### Task Context:

- taskContext: object with any data the task needs when executing

## Deleting Tasks

To delete/stop a task:
{
  "delete_task": {
    "taskName": "task name to stop"
  },
  "message": "Your response"
}

Or by ID:
{
  "delete_task": {
    "taskId": "uuid-of-task"
  },
  "message": "Your response"
}

## Natural Language Examples:

| User says | You create |
|-----------|------------|
| "say hello every 15 seconds" | intervalValue: 15, intervalUnit: "seconds" |
| "remind me every hour" | intervalValue: 1, intervalUnit: "hours" |
| "check weather every 5 minutes for 1 hour" | intervalValue: 5, intervalUnit: "minutes", durationSeconds: 3600 |
| "say hi 5 times" | maxRuns: 5, intervalValue: 15, intervalUnit: "seconds" |
| "stop saying hello" | delete_task with matching name |
| "cancel the reminder" | delete_task with matching name |

## Important Rules:

1. Minimum interval is 15 seconds - explain this if user asks for faster
2. Task names should be descriptive and unique within the conversation
3. Always confirm what you're creating/deleting in your message
4. If user asks to stop/cancel something, look at ACTIVE SCHEDULED TASKS and use delete_task

${statusContext}`;
}
```

### 5.3 Response Handling

Add task handling to `handleChatResponse()`:

```typescript
private async handleChatResponse(
  conversation: ConversationRecord,
  response: ChatResponse,
  newSessionId: string
): Promise<{ updated: boolean; newStatus?: ConversationStatus }> {
  const updates: Partial<ConversationRecord> = {
    claudeSessionId: newSessionId,
    updatedAt: new Date(),
  };

  let newStatus: ConversationStatus | undefined;

  // NEW: Handle task creation
  if (isCreateTaskResponse(response)) {
    await this.handleCreateTask(conversation, response.create_task);
    // Task creation doesn't change conversation status
  }

  // NEW: Handle task deletion
  if (isDeleteTaskResponse(response)) {
    await this.handleDeleteTask(conversation, response.delete_task);
    // Task deletion doesn't change conversation status
  }

  // ... existing schedule/needs_input/state_update handling ...

  await this.db.updateConversation(conversation.id, updates);

  return {
    updated: Object.keys(updates).length > 2,
    newStatus,
  };
}

/**
 * Create a new scheduled task from Claude's response
 */
private async handleCreateTask(
  conversation: ConversationRecord,
  request: CreateTaskRequest
): Promise<void> {
  // 1. Validate minimum interval (15 seconds)
  if (request.intervalValue && request.intervalUnit) {
    const intervalMs = this.convertToMs(request.intervalValue, request.intervalUnit);
    if (intervalMs < 15000) {
      throw new Error('Minimum interval is 15 seconds');
    }
  }

  // 2. Validate that either interval OR cron is provided
  const hasInterval = request.intervalValue && request.intervalUnit;
  const hasCron = !!request.cronExpression;
  if (!hasInterval && !hasCron) {
    throw new Error('Either interval or cronExpression must be provided');
  }

  // 3. Calculate expiresAt from durationSeconds
  let expiresAt: Date | undefined;
  if (request.durationSeconds) {
    expiresAt = new Date(Date.now() + request.durationSeconds * 1000);
  }

  // 4. Calculate initial nextRunAt
  const nextRunAt = this.calculateNextRunAt({
    intervalValue: request.intervalValue?.toString(),
    intervalUnit: request.intervalUnit,
    cronExpression: request.cronExpression,
  });

  // 5. Insert task into database
  await this.db.createTask({
    conversationId: conversation.id,
    userId: conversation.userId,
    name: request.name,
    description: request.description,
    intervalValue: request.intervalValue?.toString(),
    intervalUnit: request.intervalUnit,
    cronExpression: request.cronExpression,
    nextRunAt,
    maxRuns: request.maxRuns?.toString(),
    expiresAt,
    taskContext: request.taskContext || {},
  });

  console.log(`Task "${request.name}" created for conversation ${conversation.id}`);
}

/**
 * Delete a task by ID or name
 */
private async handleDeleteTask(
  conversation: ConversationRecord,
  request: { taskId?: string; taskName?: string }
): Promise<void> {
  let taskId = request.taskId;

  // If name provided, find the task
  if (!taskId && request.taskName) {
    const task = await this.db.findTaskByName(conversation.id, request.taskName);
    if (!task) {
      console.warn(`Task "${request.taskName}" not found in conversation ${conversation.id}`);
      return;
    }
    taskId = task.id;
  }

  if (!taskId) {
    console.warn('No taskId or taskName provided for deletion');
    return;
  }

  // Soft delete: set status to 'deleted'
  await this.db.deleteTask(taskId);
  console.log(`Task ${taskId} deleted from conversation ${conversation.id}`);
}

/**
 * Convert interval to milliseconds
 */
private convertToMs(value: number, unit: IntervalUnit): number {
  switch (unit) {
    case 'seconds': return value * 1000;
    case 'minutes': return value * 60 * 1000;
    case 'hours': return value * 60 * 60 * 1000;
    case 'days': return value * 24 * 60 * 60 * 1000;
  }
}

/**
 * Calculate next run time based on schedule
 */
private calculateNextRunAt(task: {
  intervalValue?: string;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
}): Date {
  const now = new Date();

  if (task.cronExpression) {
    return getNextRunTime(task.cronExpression);
  }

  if (task.intervalValue && task.intervalUnit) {
    const intervalMs = this.convertToMs(
      parseInt(task.intervalValue, 10),
      task.intervalUnit
    );
    return new Date(now.getTime() + intervalMs);
  }

  // Default: run immediately
  return now;
}
```

### 5.4 Update processMessage Flow

Modify `processMessage()` to load tasks:

```typescript
async processMessage(
  conversationId: string,
  userContent: string
): Promise<ChatProcessingResult> {
  // 1. Load conversation with messages and state
  const conversation = await this.db.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const messages = await this.db.getMessages(conversationId, this.maxMessageHistory);

  // NEW: Load conversation's active tasks
  const tasks = await this.db.getConversationTasks(conversationId);

  // 2. Load user's MCP configs...
  // ... existing code ...

  // 4. Build system prompt with context AND TASKS
  const systemPrompt = this.buildSystemPrompt(conversation, activeIntegrations, tasks);

  // ... rest of existing code ...
}
```

### 5.5 Import Updates

Add new type imports at top of file:

```typescript
import type {
  // ... existing imports ...
  CreateTaskRequest,  // NEW
} from '../../../../packages/shared-types/src/index';
import {
  // ... existing imports ...
  isCreateTaskResponse,   // NEW
  isDeleteTaskResponse,   // NEW
} from '../../../../packages/shared-types/src/index';
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/db/src/schema.ts` | Add `tasks` table, enums, types |
| `packages/db/migrations/0002_add_tasks_table.sql` | SQL migration |
| `packages/shared-types/src/index.ts` | Task types, CreateTaskRequest, response types, type guards |
| `apps/api/src/worker/task-worker.ts` | **NEW** - Task-specific worker |
| `apps/api/src/routes/tasks.ts` | **NEW** - Task CRUD endpoints |
| `apps/api/src/services/chat-processing.ts` | Add task methods, update system prompt, handle create/delete responses |
| `apps/api/src/index.ts` | Mount routes, start task worker |

---

## Implementation Order

1. Database: schema + migration + run migration
2. Shared types
3. Chat processing: database interface + handleCreateTask + handleDeleteTask
4. Chat processing: system prompt updates
5. Task worker
6. API endpoints
7. Testing
