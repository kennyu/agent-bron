/**
 * Task Worker
 *
 * Polls for scheduled tasks and executes them.
 * Uses PostgreSQL FOR UPDATE SKIP LOCKED for safe concurrent pickup.
 */

import type {
  TaskStatus,
  IntervalUnit,
  UserMCPConfig,
} from '../../../../packages/shared-types/src';
import { getNextRunTime } from '../services/cron-parser';
import { buildUserMCPConfig } from '../services/mcp-config-builder';

/**
 * Worker configuration
 */
export interface TaskWorkerConfig {
  db: TaskWorkerDatabaseConnection;
  claudeClient: ClaudeCodeClient;
  encryptionKey: Buffer;
  pollIntervalMs: number;
  maxConcurrent: number;
  maxMessagesToInclude: number;
  executionTimeoutMs: number;
  maxRetries: number;
  minIntervalSeconds: number;
}

/**
 * Database interface for task worker operations
 */
interface TaskWorkerDatabaseConnection {
  getReadyTasks(limit: number): Promise<TaskRecord[]>;
  getTask(id: string): Promise<TaskRecord | null>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  getMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  getUserIntegrations(userId: string): Promise<IntegrationRecord[]>;
  updateTask(id: string, updates: Partial<TaskRecord>): Promise<void>;
  insertMessage(message: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<MessageRecord>;
  createNotification(notification: NotificationInput): Promise<void>;
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

interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  skills: string[] | null;
  claudeSessionId: string | null;
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

/**
 * Claude Code SDK interface
 */
interface ClaudeCodeClient {
  run(options: {
    prompt: string;
    systemPrompt: string;
    sessionId?: string;
    mcpConfig?: UserMCPConfig;
    timeout?: number;
    skills?: string[];
  }): Promise<{
    response: string;
    sessionId: string;
  }>;
}

/**
 * Task Worker
 */
export class TaskWorker {
  private config: TaskWorkerConfig;
  private activeCount = 0;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: TaskWorkerConfig) {
    this.config = {
      ...config,
      pollIntervalMs: config.pollIntervalMs ?? 5000,
      maxConcurrent: config.maxConcurrent ?? 5,
      maxMessagesToInclude: config.maxMessagesToInclude ?? 20,
      executionTimeoutMs: config.executionTimeoutMs ?? 300000, // 5 minutes
      maxRetries: config.maxRetries ?? 3,
      minIntervalSeconds: config.minIntervalSeconds ?? 15,
    };
  }

  /**
   * Start the worker polling loop
   */
  start(): void {
    if (this.isRunning) {
      console.log('[TaskWorker] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[TaskWorker] Started');
    console.log(
      `[TaskWorker] Config: poll=${this.config.pollIntervalMs}ms, maxConcurrent=${this.config.maxConcurrent}`
    );
    this.poll();
  }

  /**
   * Stop the worker
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[TaskWorker] Stopped');
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Check if we have capacity
      if (this.activeCount >= this.config.maxConcurrent) {
        console.log(
          `[TaskWorker] At max concurrent (${this.activeCount}/${this.config.maxConcurrent}), skipping poll`
        );
      } else {
        // Query for ready tasks
        const limit = this.config.maxConcurrent - this.activeCount;
        const tasks = await this.config.db.getReadyTasks(limit);

        if (tasks.length > 0) {
          console.log(`[TaskWorker] Found ${tasks.length} ready tasks`);
        }

        // Spawn execution for each (non-blocking)
        for (const task of tasks) {
          this.executeTask(task);
        }
      }
    } catch (error) {
      console.error('[TaskWorker] Error in poll:', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * Execute a single task (async, non-blocking)
   */
  private async executeTask(task: TaskRecord): Promise<void> {
    this.activeCount++;
    console.log(`[TaskWorker] Executing task "${task.name}" (${task.id}) (active=${this.activeCount})`);

    try {
      await this.runTask(task);
      console.log(`[TaskWorker] Completed task "${task.name}" (${task.id})`);
    } catch (error) {
      console.error(`[TaskWorker] Error in task "${task.name}" (${task.id}):`, error);
      await this.handleExecutionError(task, error);
    } finally {
      this.activeCount--;
    }
  }

  /**
   * Run Claude Code for a task
   */
  private async runTask(task: TaskRecord): Promise<void> {
    // 1. Load conversation
    const conversation = await this.config.db.getConversation(task.conversationId);
    if (!conversation) {
      console.error(`[TaskWorker] Conversation ${task.conversationId} not found for task ${task.id}`);
      await this.markTaskCompleted(task, 'Conversation not found');
      return;
    }

    // 2. Load messages
    const messages = await this.config.db.getMessages(
      task.conversationId,
      this.config.maxMessagesToInclude
    );
    console.log(`[TaskWorker] Loaded ${messages.length} messages for conversation context`);

    // 3. Load user's MCP configs
    const integrations = await this.config.db.getUserIntegrations(task.userId);
    const activeIntegrations = integrations.filter((i) => i.isActive === 'true');
    const mcpConfig = buildUserMCPConfig(
      activeIntegrations.map((i) => ({
        provider: i.provider,
        encryptedAccessToken: i.encryptedAccessToken,
        encryptedRefreshToken: i.encryptedRefreshToken,
        metadata: i.metadata || {},
        isActive: i.isActive === 'true',
      })),
      this.config.encryptionKey
    );

    // 4. Build task prompt
    const systemPrompt = this.buildTaskSystemPrompt(task);
    const prompt = this.buildTaskPrompt(task, messages);

    // Debug: Log prompts
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[TaskWorker] SYSTEM PROMPT for task "${task.name}":`);
    console.log(`${'='.repeat(80)}`);
    console.log(systemPrompt);
    console.log(`${'='.repeat(80)}`);
    console.log(`[TaskWorker] USER PROMPT:`);
    console.log(`${'='.repeat(80)}`);
    console.log(prompt);
    console.log(`${'='.repeat(80)}\n`);

    // 5. Run Claude Code with conversation's skills
    // NOTE: We intentionally don't pass sessionId - tasks run independently
    // to avoid conflicts with user's active sessions
    const result = await this.config.claudeClient.run({
      prompt,
      systemPrompt,
      // sessionId is omitted - each task execution starts fresh
      mcpConfig,
      timeout: this.config.executionTimeoutMs,
      skills: conversation.skills || undefined,
    });

    // 6. Insert assistant message
    console.log(`[TaskWorker] Claude response for "${task.name}": "${result.response.slice(0, 200)}${result.response.length > 200 ? '...' : ''}"`);

    const insertedMessage = await this.config.db.insertMessage({
      conversationId: task.conversationId,
      role: 'assistant',
      content: result.response,
      source: 'worker',
    });
    console.log(`[TaskWorker] Message inserted with id: ${(insertedMessage as any)?.id}`);

    // 7. Create notification so frontend knows there's a new message
    const currentRuns = parseInt(task.currentRuns || '0', 10) + 1;
    await this.config.db.createNotification({
      userId: task.userId,
      conversationId: task.conversationId,
      title: `Task: ${task.name}`,
      body: result.response.slice(0, 100) + (result.response.length > 100 ? '...' : ''),
    });
    console.log(`[TaskWorker] Notification created for task "${task.name}" (run ${currentRuns})`);

    // 8. Update task: increment runs, calculate next run
    await this.updateTaskAfterExecution(task);
  }

  /**
   * Build system prompt for task execution
   */
  private buildTaskSystemPrompt(task: TaskRecord): string {
    return `You are executing a scheduled task for the user.

TASK NAME: "${task.name}"
${task.description ? `DESCRIPTION: ${task.description}` : ''}

INSTRUCTIONS:
- If the task is "say hello" or similar greetings, respond with a friendly greeting message
- If the task involves checking something, provide the results
- Keep your response brief and friendly
- Do NOT include any JSON in your response - just respond naturally

Execute the task now and provide your response directly to the user.`;
  }

  /**
   * Build prompt with task context and conversation history
   */
  private buildTaskPrompt(task: TaskRecord, messages: MessageRecord[]): string {
    const currentRuns = parseInt(task.currentRuns || '0', 10);
    const maxRuns = task.maxRuns ? parseInt(task.maxRuns, 10) : null;

    const taskContextJson = JSON.stringify(task.taskContext || {}, null, 2);

    // Format recent message history
    const historyLines = messages.slice(-10).map((m) => {
      const sourceTag = m.source === 'worker' ? ' [task]' : '';
      return `${m.role}${sourceTag}: ${m.content}`;
    });

    const history =
      historyLines.length > 0
        ? `RECENT CONVERSATION:\n${historyLines.join('\n\n')}\n\n`
        : '';

    return `SCHEDULED TASK EXECUTION

TASK: ${task.name}
RUN NUMBER: ${currentRuns + 1}${maxRuns ? ` of ${maxRuns}` : ''}
${task.lastRunAt ? `LAST RUN: ${task.lastRunAt.toISOString()}` : 'FIRST RUN'}

TASK CONTEXT:
${taskContextJson}

${history}

Execute the task "${task.name}" now.`;
  }

  /**
   * Update task after successful execution
   */
  private async updateTaskAfterExecution(task: TaskRecord): Promise<void> {
    const currentRuns = parseInt(task.currentRuns || '0', 10) + 1;
    const maxRuns = task.maxRuns ? parseInt(task.maxRuns, 10) : null;
    const now = new Date();

    // Check if task should complete
    const shouldComplete =
      (maxRuns !== null && currentRuns >= maxRuns) ||
      (task.expiresAt && new Date(task.expiresAt) <= now);

    if (shouldComplete) {
      await this.markTaskCompleted(task, 'Task completed successfully');
      return;
    }

    // Calculate next run time
    const nextRunAt = this.calculateNextRunAt(task);

    await this.config.db.updateTask(task.id, {
      currentRuns: String(currentRuns),
      lastRunAt: now,
      nextRunAt,
      consecutiveFailures: '0',
      lastError: null,
      updatedAt: now,
    });

    console.log(
      `[TaskWorker] Task "${task.name}" run ${currentRuns}${maxRuns ? `/${maxRuns}` : ''}, next run at ${nextRunAt?.toISOString()}`
    );
  }

  /**
   * Mark task as completed
   */
  private async markTaskCompleted(task: TaskRecord, reason: string): Promise<void> {
    await this.config.db.updateTask(task.id, {
      status: 'completed',
      nextRunAt: null,
      lastRunAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`[TaskWorker] Task "${task.name}" completed: ${reason}`);

    // Notify user
    await this.config.db.createNotification({
      userId: task.userId,
      conversationId: task.conversationId,
      title: `Task completed: ${task.name}`,
      body: reason,
    });
  }

  /**
   * Calculate next run time based on task schedule
   */
  private calculateNextRunAt(task: TaskRecord): Date | null {
    const now = new Date();

    // Check expiration
    if (task.expiresAt && new Date(task.expiresAt) <= now) {
      return null;
    }

    // Cron-based scheduling
    if (task.cronExpression) {
      return getNextRunTime(task.cronExpression);
    }

    // Interval-based scheduling
    if (task.intervalValue && task.intervalUnit) {
      const intervalMs = this.convertToMs(
        parseInt(task.intervalValue, 10),
        task.intervalUnit
      );
      return new Date(now.getTime() + intervalMs);
    }

    return null;
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
   * Handle execution errors
   */
  private async handleExecutionError(task: TaskRecord, error: unknown): Promise<void> {
    const failures = parseInt(task.consecutiveFailures || '0', 10) + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const updates: Partial<TaskRecord> = {
      consecutiveFailures: String(failures),
      lastError: errorMessage,
      updatedAt: new Date(),
    };

    if (failures >= this.config.maxRetries) {
      // Max retries reached: pause task and notify user
      updates.status = 'paused';
      updates.nextRunAt = null;

      await this.config.db.createNotification({
        userId: task.userId,
        conversationId: task.conversationId,
        title: `Task paused: ${task.name}`,
        body: `Task failed after ${failures} attempts: ${errorMessage}`,
      });

      console.log(`[TaskWorker] Task "${task.name}" paused after ${failures} failures`);
    }

    await this.config.db.updateTask(task.id, updates);
  }
}

/**
 * Create a task worker
 */
export function createTaskWorker(config: TaskWorkerConfig): TaskWorker {
  return new TaskWorker(config);
}
