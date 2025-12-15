/**
 * Chat Processing Service
 *
 * Handles real-time user messages in conversations.
 * Processes messages through Claude Code SDK with MCP tool access.
 */

import type {
  Conversation,
  Message,
  ConversationStatus,
  Schedule,
  PendingQuestion,
  ChatResponse,
  UserMCPConfig,
  CreateTaskRequest,
  IntervalUnit,
  TaskStatus,
} from '../../../../packages/shared-types/src/index';
import {
  isCreateScheduleResponse,
  isChatNeedsInputResponse,
  isStateUpdateResponse,
  isCreateTaskResponse,
  isDeleteTaskResponse,
} from '../../../../packages/shared-types/src/index';
import { getNextRunTime } from './cron-parser';
import {
  buildUserMCPConfig,
  formatIntegrationsForPrompt,
  getAvailableIntegrations,
} from './mcp-config-builder';

/**
 * Database interface (to be implemented with actual DB connection)
 */
interface DatabaseConnection {
  getConversation(id: string): Promise<ConversationRecord | null>;
  getMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  getUserIntegrations(userId: string): Promise<IntegrationRecord[]>;
  updateConversation(id: string, updates: Partial<ConversationRecord>): Promise<void>;
  insertMessage(message: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<MessageRecord>;
  createNotification(notification: NotificationInput): Promise<void>;
  // Task methods
  getConversationTasks(conversationId: string): Promise<TaskRecord[]>;
  createTask(task: NewTaskRecord): Promise<TaskRecord>;
  updateTask(id: string, updates: Partial<TaskRecord>): Promise<void>;
  findTaskByName(conversationId: string, name: string): Promise<TaskRecord | null>;
}

interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  scheduleType: string | null;
  cronExpression: string | null;
  scheduledRunAt: Date | null;
  nextRunAt: Date | null;
  stateContext: Record<string, unknown> | null;
  stateStep: string | null;
  stateData: Record<string, unknown> | null;
  pendingQuestionType: string | null;
  pendingQuestionPrompt: string | null;
  pendingQuestionOptions: string[] | null;
  claudeSessionId: string | null;
  consecutiveFailures: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: 'chat' | 'worker';
  createdAt: Date;
}

interface IntegrationRecord {
  id: string;
  userId: string;
  provider: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  metadata: Record<string, unknown>;
  isActive: string;
}

interface NotificationInput {
  userId: string;
  conversationId: string;
  title: string;
  body: string;
}

interface TaskRecord {
  id: string;
  conversationId: string;
  userId: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  intervalValue: string | null;
  intervalUnit: IntervalUnit | null;
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
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  nextRunAt?: Date;
  maxRuns?: string;
  expiresAt?: Date;
  taskContext?: Record<string, unknown>;
}

/**
 * Claude Code SDK interface (to be implemented with actual SDK)
 */
interface ClaudeCodeClient {
  run(options: {
    prompt: string;
    systemPrompt: string;
    sessionId?: string;
    mcpConfig?: UserMCPConfig;
    timeout?: number;
  }): Promise<{
    response: string;
    sessionId: string;
  }>;
}

/**
 * Chat Processing Service Configuration
 */
interface ChatProcessingConfig {
  db: DatabaseConnection;
  claudeClient: ClaudeCodeClient;
  encryptionKey: Buffer;
  maxMessageHistory: number;
}

/**
 * Result of processing a chat message
 */
export interface ChatProcessingResult {
  userMessage: Message;
  assistantMessage: Message;
  conversationUpdated: boolean;
  newStatus?: ConversationStatus;
}

/**
 * Chat Processing Service
 */
export class ChatProcessingService {
  private db: DatabaseConnection;
  private claudeClient: ClaudeCodeClient;
  private encryptionKey: Buffer;
  private maxMessageHistory: number;

  constructor(config: ChatProcessingConfig) {
    this.db = config.db;
    this.claudeClient = config.claudeClient;
    this.encryptionKey = config.encryptionKey;
    this.maxMessageHistory = config.maxMessageHistory || 50;
  }

  /**
   * Process a user message in a conversation
   */
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

    // 2. Load conversation's tasks
    const tasks = await this.db.getConversationTasks(conversationId);

    // 3. Load user's MCP configs with credential decryption
    const integrations = await this.db.getUserIntegrations(conversation.userId);
    const activeIntegrations = integrations.filter((i) => i.isActive === 'true');
    const mcpConfig = buildUserMCPConfig(
      activeIntegrations.map((i) => ({
        provider: i.provider,
        encryptedAccessToken: i.encryptedAccessToken,
        encryptedRefreshToken: i.encryptedRefreshToken,
        metadata: i.metadata || {},
        isActive: i.isActive === 'true',
      })),
      this.encryptionKey
    );

    // 4. Insert user message
    const userMessage = await this.db.insertMessage({
      conversationId,
      role: 'user',
      content: userContent,
      source: 'chat',
    });

    // 5. Build system prompt with context and tasks
    const systemPrompt = this.buildSystemPrompt(conversation, activeIntegrations, tasks);

    // Debug: Log system prompt
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[ChatProcessing] SYSTEM PROMPT for conversation ${conversationId.slice(0, 8)}:`);
    console.log(`${'='.repeat(80)}`);
    console.log(systemPrompt);
    console.log(`${'='.repeat(80)}\n`);

    // 6. Build conversation prompt with message history
    const prompt = this.buildPrompt(messages, userContent, conversation);

    // 7. Call Claude Code SDK
    const result = await this.claudeClient.run({
      prompt,
      systemPrompt,
      sessionId: conversation.claudeSessionId || undefined,
      mcpConfig,
      timeout: 120000, // 2 minutes
    });

    // 8. Parse Claude's response
    const parsedResponse = this.parseClaudeResponse(result.response);

    // Log response classification
    this.logResponseClassification(parsedResponse, conversationId);

    // 9. Update conversation and handle tasks based on response
    const updates = await this.handleChatResponse(
      conversation,
      parsedResponse,
      result.sessionId
    );

    // 10. Insert assistant message
    const assistantMessage = await this.db.insertMessage({
      conversationId,
      role: 'assistant',
      content: parsedResponse.message || result.response,
      source: 'chat',
    });

    return {
      userMessage: {
        id: userMessage.id,
        conversationId: userMessage.conversationId,
        role: userMessage.role,
        content: userMessage.content,
        source: userMessage.source,
        createdAt: userMessage.createdAt,
      },
      assistantMessage: {
        id: assistantMessage.id,
        conversationId: assistantMessage.conversationId,
        role: assistantMessage.role,
        content: assistantMessage.content,
        source: assistantMessage.source,
        createdAt: assistantMessage.createdAt,
      },
      conversationUpdated: updates.updated,
      newStatus: updates.newStatus,
    };
  }

  /**
   * Build system prompt with user integrations, conversation state, and tasks
   */
  private buildSystemPrompt(
    conversation: ConversationRecord,
    integrations: IntegrationRecord[],
    tasks: TaskRecord[]
  ): string {
    const connectedProviders = integrations.map((i) => i.provider);
    const availableIntegrations = getAvailableIntegrations(connectedProviders);

    const connectedList = formatIntegrationsForPrompt(
      integrations.map((i) => ({
        provider: i.provider,
        metadata: i.metadata || {},
      }))
    );

    const availableList =
      availableIntegrations.length > 0
        ? availableIntegrations.map((i) => `- ${i.name}: ${i.description}`).join('\n')
        : 'All integrations connected.';

    const stateJson = JSON.stringify(
      {
        context: conversation.stateContext,
        step: conversation.stateStep,
        data: conversation.stateData,
      },
      null,
      2
    );

    // Format active tasks for Claude
    const activeTasks = tasks.filter((t) => t.status === 'active');
    const tasksJson =
      activeTasks.length > 0
        ? JSON.stringify(
            activeTasks.map((t) => ({
              id: t.id,
              name: t.name,
              schedule:
                t.intervalValue && t.intervalUnit
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

    let statusContext = '';
    if (conversation.status === 'waiting_input' && conversation.pendingQuestionPrompt) {
      statusContext = `User is responding to: "${conversation.pendingQuestionPrompt}"`;
    } else if (conversation.status === 'background' && conversation.scheduleType) {
      statusContext = `Background work is scheduled: ${conversation.scheduleType}`;
      if (conversation.cronExpression) {
        statusContext += ` (${conversation.cronExpression})`;
      }
    }

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

## Important Rules:

1. Minimum interval is 15 seconds - explain this if user asks for faster
2. Task names should be descriptive and unique within the conversation
3. Always confirm what you're creating/deleting in your message
4. If user asks to stop/cancel something, look at ACTIVE SCHEDULED TASKS and use delete_task

## Other Actions

To ask for user input:
{
  "needs_input": { "type": "confirmation|choice|input", "prompt": "...", "options": [...] },
  "message": "Your response to user"
}

To update conversation state:
{
  "state_update": { "key": "value" },
  "message": "Your response"
}

For requests requiring unconnected integrations, explain that the user needs to connect them in Settings.`;
  }

  /**
   * Build the user prompt with message history
   */
  private buildPrompt(
    messages: MessageRecord[],
    userContent: string,
    conversation: ConversationRecord
  ): string {
    // Format message history
    const historyLines = messages.map((m) => {
      const sourceTag = m.source === 'worker' ? ' [background]' : '';
      return `${m.role}${sourceTag}: ${m.content}`;
    });

    const history = historyLines.length > 0
      ? `CONVERSATION HISTORY:\n${historyLines.join('\n\n')}\n\n`
      : '';

    return `${history}USER MESSAGE:\n${userContent}`;
  }

  /**
   * Parse Claude's response for structured data
   */
  private parseClaudeResponse(response: string): ChatResponse {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Plain text response
      return { message: response };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // Ensure message is present
      if (!parsed.message) {
        parsed.message = response.replace(jsonMatch[0], '').trim() || response;
      }

      return parsed as ChatResponse;
    } catch {
      // Failed to parse JSON, return as plain response
      return { message: response };
    }
  }

  /**
   * Handle Claude's response and update conversation accordingly
   */
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

    // Handle schedule creation
    if (isCreateScheduleResponse(response)) {
      const { create_schedule } = response;

      updates.scheduleType = create_schedule.type;
      updates.status = 'background';
      newStatus = 'background';

      if (create_schedule.type === 'cron' && create_schedule.cron_expression) {
        updates.cronExpression = create_schedule.cron_expression;
        updates.nextRunAt = getNextRunTime(create_schedule.cron_expression);
      } else if (create_schedule.type === 'scheduled' && create_schedule.run_at) {
        updates.scheduledRunAt = new Date(create_schedule.run_at);
        updates.nextRunAt = new Date(create_schedule.run_at);
      } else if (create_schedule.type === 'immediate') {
        updates.nextRunAt = new Date();
      }

      if (create_schedule.initial_state) {
        updates.stateContext = create_schedule.initial_state.context || {};
        updates.stateStep = create_schedule.initial_state.step || 'initial';
        updates.stateData = create_schedule.initial_state.data || {};
      }

      // Clear any pending question
      updates.pendingQuestionType = null;
      updates.pendingQuestionPrompt = null;
      updates.pendingQuestionOptions = null;
    }

    // Handle needs_input
    else if (isChatNeedsInputResponse(response)) {
      const { needs_input } = response;

      updates.status = 'waiting_input';
      newStatus = 'waiting_input';
      updates.pendingQuestionType = needs_input.type;
      updates.pendingQuestionPrompt = needs_input.prompt;
      updates.pendingQuestionOptions = needs_input.options || null;
    }

    // Handle state_update
    else if (isStateUpdateResponse(response)) {
      const { state_update } = response;

      // Merge state update with existing data
      updates.stateData = {
        ...(conversation.stateData || {}),
        ...state_update,
      };
    }

    // Handle task creation
    if (isCreateTaskResponse(response)) {
      await this.handleCreateTask(conversation, response.create_task);
    }

    // Handle task deletion
    if (isDeleteTaskResponse(response)) {
      await this.handleDeleteTask(conversation, response.delete_task);
    }

    // If user was answering a question and we got a plain response,
    // clear the pending question and potentially resume background work
    else if (
      conversation.status === 'waiting_input' &&
      conversation.pendingQuestionPrompt
    ) {
      updates.pendingQuestionType = null;
      updates.pendingQuestionPrompt = null;
      updates.pendingQuestionOptions = null;

      // If there's a schedule, go back to background status
      if (conversation.scheduleType) {
        updates.status = 'background';
        newStatus = 'background';

        // Recalculate next run time
        if (conversation.scheduleType === 'cron' && conversation.cronExpression) {
          updates.nextRunAt = getNextRunTime(conversation.cronExpression);
        } else if (conversation.scheduleType === 'immediate') {
          updates.nextRunAt = new Date();
        }
      } else {
        updates.status = 'active';
        newStatus = 'active';
      }
    }

    // Apply updates
    await this.db.updateConversation(conversation.id, updates);

    return {
      updated: Object.keys(updates).length > 2, // More than just sessionId and updatedAt
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
        console.warn('[ChatProcessing] Task interval too small, minimum is 15 seconds');
        return;
      }
    }

    // 2. Validate that either interval OR cron is provided
    const hasInterval = request.intervalValue && request.intervalUnit;
    const hasCron = !!request.cronExpression;
    if (!hasInterval && !hasCron) {
      console.warn('[ChatProcessing] Task must have either interval or cronExpression');
      return;
    }

    // 3. Calculate expiresAt from durationSeconds
    let expiresAt: Date | undefined;
    if (request.durationSeconds) {
      expiresAt = new Date(Date.now() + request.durationSeconds * 1000);
    }

    // 4. Calculate initial nextRunAt
    const nextRunAt = this.calculateNextRunAt(
      request.intervalValue,
      request.intervalUnit,
      request.cronExpression
    );

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

    console.log(`[ChatProcessing] Task "${request.name}" created for conversation ${conversation.id}`);
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
        console.warn(
          `[ChatProcessing] Task "${request.taskName}" not found in conversation ${conversation.id}`
        );
        return;
      }
      taskId = task.id;
    }

    if (!taskId) {
      console.warn('[ChatProcessing] No taskId or taskName provided for deletion');
      return;
    }

    // Soft delete: set status to 'deleted'
    await this.db.updateTask(taskId, {
      status: 'deleted',
      nextRunAt: null,
      updatedAt: new Date(),
    });

    console.log(`[ChatProcessing] Task ${taskId} deleted from conversation ${conversation.id}`);
  }

  /**
   * Convert interval to milliseconds
   */
  private convertToMs(value: number, unit: IntervalUnit): number {
    switch (unit) {
      case 'seconds':
        return value * 1000;
      case 'minutes':
        return value * 60 * 1000;
      case 'hours':
        return value * 60 * 60 * 1000;
      case 'days':
        return value * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Calculate next run time based on schedule
   */
  private calculateNextRunAt(
    intervalValue?: number,
    intervalUnit?: IntervalUnit,
    cronExpression?: string
  ): Date {
    const now = new Date();

    if (cronExpression) {
      return getNextRunTime(cronExpression);
    }

    if (intervalValue && intervalUnit) {
      const intervalMs = this.convertToMs(intervalValue, intervalUnit);
      return new Date(now.getTime() + intervalMs);
    }

    return now;
  }

  /**
   * Log the classification of Claude's response
   */
  private logResponseClassification(response: ChatResponse, conversationId: string): void {
    const timestamp = new Date().toISOString();
    const prefix = `[ChatProcessing][${timestamp}][${conversationId.slice(0, 8)}]`;

    if (isCreateTaskResponse(response)) {
      const task = response.create_task;
      const schedule = task.intervalValue && task.intervalUnit
        ? `every ${task.intervalValue} ${task.intervalUnit}`
        : task.cronExpression || 'unknown';
      console.log(`${prefix} 📋 TASK_CREATE: "${task.name}" | Schedule: ${schedule} | MaxRuns: ${task.maxRuns || 'unlimited'} | Duration: ${task.durationSeconds ? `${task.durationSeconds}s` : 'unlimited'}`);
    } else if (isDeleteTaskResponse(response)) {
      const target = response.delete_task.taskName || response.delete_task.taskId || 'unknown';
      console.log(`${prefix} 🗑️  TASK_DELETE: "${target}"`);
    } else if (isCreateScheduleResponse(response)) {
      const sched = response.create_schedule;
      console.log(`${prefix} ⏰ SCHEDULE_CREATE: type=${sched.type} | cron=${sched.cron_expression || 'none'} | runAt=${sched.run_at || 'none'}`);
    } else if (isChatNeedsInputResponse(response)) {
      const input = response.needs_input;
      console.log(`${prefix} ❓ NEEDS_INPUT: type=${input.type} | prompt="${input.prompt.slice(0, 50)}..."`);
    } else if (isStateUpdateResponse(response)) {
      const keys = Object.keys(response.state_update);
      console.log(`${prefix} 🔄 STATE_UPDATE: keys=[${keys.join(', ')}]`);
    } else {
      const msgPreview = response.message?.slice(0, 80) || 'no message';
      console.log(`${prefix} 💬 PLAIN_RESPONSE: "${msgPreview}..."`);
    }
  }
}

/**
 * Handle waiting_input response - clear pending question and update status
 */
export function clearPendingQuestion(
  conversation: ConversationRecord
): Partial<ConversationRecord> {
  return {
    pendingQuestionType: null,
    pendingQuestionPrompt: null,
    pendingQuestionOptions: null,
    status: conversation.scheduleType ? 'background' : 'active',
  };
}
