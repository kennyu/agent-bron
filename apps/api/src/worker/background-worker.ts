/**
 * Background Worker
 *
 * Polls for conversations with scheduled background work and executes them.
 * Uses PostgreSQL FOR UPDATE SKIP LOCKED for safe concurrent pickup.
 */

import type {
  ConversationStatus,
  WorkerResponse,
  UserMCPConfig,
} from '../../../../packages/shared-types/src';
import {
  isNeedsInputResponse,
  isContinueResponse,
  isCompleteResponse,
} from '../../../../packages/shared-types/src';
import { getNextRunTime } from '../services/cron-parser';
import { buildUserMCPConfig } from '../services/mcp-config-builder';

/**
 * Worker configuration
 */
export interface WorkerConfig {
  db: WorkerDatabaseConnection;
  claudeClient: ClaudeCodeClient;
  encryptionKey: Buffer;
  pollIntervalMs: number;
  maxConcurrent: number;
  maxMessagesToInclude: number;
  executionTimeoutMs: number;
  maxRetries: number;
}

/**
 * Database interface for worker operations
 */
interface WorkerDatabaseConnection {
  // Query for ready conversations with FOR UPDATE SKIP LOCKED
  getReadyConversations(limit: number): Promise<ConversationRecord[]>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  getMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  getUserIntegrations(userId: string): Promise<IntegrationRecord[]>;
  updateConversation(id: string, updates: Partial<ConversationRecord>): Promise<void>;
  insertMessage(message: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<MessageRecord>;
  createNotification(notification: NotificationInput): Promise<void>;
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
  skills: string[] | null;
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
 * Background Worker
 */
export class BackgroundWorker {
  private config: WorkerConfig;
  private activeCount = 0;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: WorkerConfig) {
    this.config = {
      ...config,
      pollIntervalMs: config.pollIntervalMs ?? 5000,
      maxConcurrent: config.maxConcurrent ?? 5,
      maxMessagesToInclude: config.maxMessagesToInclude ?? 20,
      executionTimeoutMs: config.executionTimeoutMs ?? 300000, // 5 minutes
      maxRetries: config.maxRetries ?? 3,
    };
  }

  /**
   * Start the worker polling loop
   */
  start(): void {
    if (this.isRunning) {
      console.log('[Worker] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Worker] Started');
    console.log(`[Worker] Config: poll=${this.config.pollIntervalMs}ms, maxConcurrent=${this.config.maxConcurrent}`);
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
    console.log('[Worker] Stopped');
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
          `[Worker] At max concurrent (${this.activeCount}/${this.config.maxConcurrent}), skipping poll`
        );
      } else {
        // Query for ready conversations
        const limit = this.config.maxConcurrent - this.activeCount;
        console.log(`[Worker] Polling for ready conversations (limit=${limit})...`);
        const conversations = await this.config.db.getReadyConversations(limit);

        console.log(`[Worker] Found ${conversations.length} ready conversations`);

        // Spawn execution for each (non-blocking)
        for (const conversation of conversations) {
          this.executeConversation(conversation);
        }
      }
    } catch (error) {
      console.error('[Worker] Error in poll:', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * Execute a single conversation (async, non-blocking)
   */
  private async executeConversation(conversation: ConversationRecord): Promise<void> {
    this.activeCount++;
    console.log(`[Worker] Executing conversation ${conversation.id} (active=${this.activeCount})`);

    try {
      await this.runConversation(conversation);
      console.log(`[Worker] Completed conversation ${conversation.id}`);
    } catch (error) {
      console.error(`[Worker] Error in conversation ${conversation.id}:`, error);
      await this.handleExecutionError(conversation, error);
    } finally {
      this.activeCount--;
      console.log(`[Worker] Finished conversation ${conversation.id} (active=${this.activeCount})`);
    }
  }

  /**
   * Run Claude Code for a conversation
   */
  private async runConversation(conversation: ConversationRecord): Promise<void> {
    // 1. Load messages
    const messages = await this.config.db.getMessages(
      conversation.id,
      this.config.maxMessagesToInclude
    );

    // 2. Load user's MCP configs
    const integrations = await this.config.db.getUserIntegrations(conversation.userId);
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

    // 3. Build worker prompt
    const systemPrompt = this.buildWorkerSystemPrompt();
    const prompt = this.buildWorkerPrompt(conversation, messages);

    // 4. Run Claude Code with conversation's skills
    const result = await this.config.claudeClient.run({
      prompt,
      systemPrompt,
      sessionId: conversation.claudeSessionId || undefined,
      mcpConfig,
      timeout: this.config.executionTimeoutMs,
      skills: conversation.skills || undefined,
    });

    // 5. Parse and handle response
    const parsedResponse = this.parseWorkerResponse(result.response);
    await this.handleWorkerResponse(
      conversation,
      parsedResponse,
      result.sessionId,
      result.response
    );
  }

  /**
   * Build system prompt for worker execution
   */
  private buildWorkerSystemPrompt(): string {
    return `You are executing background work for a conversation.

Based on the conversation context and current state, take the next appropriate action.

RESPONSE FORMAT:

If you need user input, respond with:
{
  "needs_input": true,
  "message": "Your message to the user",
  "question": {
    "type": "confirmation|choice|input",
    "prompt": "What you're asking",
    "options": ["Option 1", "Option 2"]
  }
}

If work is complete (for this cycle), respond with:
{
  "complete": true,
  "message": "Summary of what was accomplished"
}

If continuing background work, respond with:
{
  "continue": true,
  "message": "Status update for user (optional, can be null)",
  "state_update": { ... },
  "next_step": "step_name"
}

Always respond with valid JSON in one of these formats.`;
  }

  /**
   * Build prompt with conversation context
   */
  private buildWorkerPrompt(
    conversation: ConversationRecord,
    messages: MessageRecord[]
  ): string {
    const contextJson = JSON.stringify(conversation.stateContext || {}, null, 2);
    const dataJson = JSON.stringify(conversation.stateData || {}, null, 2);

    // Format message history
    const historyLines = messages.map((m) => {
      const sourceTag = m.source === 'worker' ? ' [background]' : '';
      return `${m.role}${sourceTag}: ${m.content}`;
    });

    const history =
      historyLines.length > 0
        ? `CONVERSATION HISTORY:\n${historyLines.join('\n\n')}\n\n`
        : '';

    return `CONVERSATION CONTEXT:
${contextJson}

CURRENT STEP: ${conversation.stateStep || 'initial'}

${history}CURRENT STATE DATA:
${dataJson}

Continue the background task. Take the next appropriate action based on the context and state.`;
  }

  /**
   * Parse worker response JSON
   */
  private parseWorkerResponse(response: string): WorkerResponse {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Treat as continue with no updates
      return { continue: true };
    }

    try {
      return JSON.parse(jsonMatch[0]) as WorkerResponse;
    } catch {
      // Failed to parse, treat as continue
      console.warn('Failed to parse worker response as JSON:', response);
      return { continue: true };
    }
  }

  /**
   * Handle worker response and update conversation
   */
  private async handleWorkerResponse(
    conversation: ConversationRecord,
    response: WorkerResponse,
    newSessionId: string,
    rawResponse: string
  ): Promise<void> {
    const updates: Partial<ConversationRecord> = {
      claudeSessionId: newSessionId,
      consecutiveFailures: '0', // Reset on successful execution
      updatedAt: new Date(),
    };

    // Handle needs_input response
    if (isNeedsInputResponse(response)) {
      await this.handleNeedsInput(conversation, response, updates, rawResponse);
    }
    // Handle complete response
    else if (isCompleteResponse(response)) {
      await this.handleComplete(conversation, response, updates);
    }
    // Handle continue response
    else if (isContinueResponse(response)) {
      await this.handleContinue(conversation, response, updates);
    }

    // Apply updates
    await this.config.db.updateConversation(conversation.id, updates);
  }

  /**
   * Handle needs_input response: pause and ask user
   */
  private async handleNeedsInput(
    conversation: ConversationRecord,
    response: { needs_input: true; message: string; question: { type: string; prompt: string; options?: string[] } },
    updates: Partial<ConversationRecord>,
    rawResponse: string
  ): Promise<void> {
    // 1. Insert assistant message
    await this.config.db.insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: response.message,
      source: 'worker',
    });

    // 2. Update conversation status
    updates.status = 'waiting_input';
    updates.pendingQuestionType = response.question.type as 'confirmation' | 'choice' | 'input';
    updates.pendingQuestionPrompt = response.question.prompt;
    updates.pendingQuestionOptions = response.question.options || null;

    // 3. Do NOT update next_run_at (paused)

    // 4. Create notification
    await this.config.db.createNotification({
      userId: conversation.userId,
      conversationId: conversation.id,
      title: conversation.title || 'Task needs your attention',
      body: response.question.prompt,
    });

    console.log(`Conversation ${conversation.id} paused for user input`);
  }

  /**
   * Handle complete response: finish task cycle
   */
  private async handleComplete(
    conversation: ConversationRecord,
    response: { complete: true; message: string },
    updates: Partial<ConversationRecord>
  ): Promise<void> {
    // 1. Insert assistant message
    await this.config.db.insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: response.message,
      source: 'worker',
    });

    // 2. Handle based on schedule type
    if (conversation.scheduleType === 'cron' && conversation.cronExpression) {
      // Cron job: keep running, schedule next execution
      updates.status = 'background';
      updates.nextRunAt = getNextRunTime(conversation.cronExpression);
      console.log(
        `Conversation ${conversation.id} cron cycle complete, next run at ${updates.nextRunAt}`
      );
    } else {
      // One-time or scheduled: mark as active, clear schedule
      updates.status = 'active';
      updates.scheduleType = null;
      updates.cronExpression = null;
      updates.scheduledRunAt = null;
      updates.nextRunAt = null;
      console.log(`Conversation ${conversation.id} completed`);

      // Create notification for significant completions
      await this.config.db.createNotification({
        userId: conversation.userId,
        conversationId: conversation.id,
        title: conversation.title || 'Task completed',
        body: response.message,
      });
    }
  }

  /**
   * Handle continue response: keep running
   */
  private async handleContinue(
    conversation: ConversationRecord,
    response: { continue: true; message?: string; state_update?: Record<string, unknown>; next_step?: string },
    updates: Partial<ConversationRecord>
  ): Promise<void> {
    // 1. Optionally insert status message
    if (response.message) {
      await this.config.db.insertMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: response.message,
        source: 'worker',
      });
    }

    // 2. Merge state_update into state.data
    if (response.state_update) {
      updates.stateData = {
        ...(conversation.stateData || {}),
        ...response.state_update,
      };
    }

    // 3. Update step
    if (response.next_step) {
      updates.stateStep = response.next_step;
    }

    // 4. Calculate next_run_at based on schedule
    if (conversation.scheduleType === 'cron' && conversation.cronExpression) {
      updates.nextRunAt = getNextRunTime(conversation.cronExpression);
    } else if (conversation.scheduleType === 'immediate') {
      // For immediate, run again right away
      updates.nextRunAt = new Date();
    } else if (conversation.scheduleType === 'scheduled' && conversation.scheduledRunAt) {
      // For scheduled, use the scheduled time (already passed, so this shouldn't happen)
      updates.nextRunAt = conversation.scheduledRunAt;
    }

    console.log(
      `Conversation ${conversation.id} continuing, next run at ${updates.nextRunAt}`
    );
  }

  /**
   * Handle execution errors
   */
  private async handleExecutionError(
    conversation: ConversationRecord,
    error: unknown
  ): Promise<void> {
    const failures = parseInt(conversation.consecutiveFailures || '0', 10) + 1;

    const updates: Partial<ConversationRecord> = {
      consecutiveFailures: String(failures),
      updatedAt: new Date(),
    };

    // Check error type
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isAuthError =
      errorMessage.includes('auth') ||
      errorMessage.includes('token') ||
      errorMessage.includes('expired') ||
      errorMessage.includes('unauthorized');

    if (isAuthError) {
      // Auth error: set waiting_input, notify user
      updates.status = 'waiting_input';
      updates.pendingQuestionType = 'input';
      updates.pendingQuestionPrompt =
        'Your connection has expired. Please reconnect in Settings.';

      await this.config.db.createNotification({
        userId: conversation.userId,
        conversationId: conversation.id,
        title: 'Connection expired',
        body: 'Please reconnect your integration in Settings to continue.',
      });
    } else if (failures >= this.config.maxRetries) {
      // Max retries reached: notify user
      await this.config.db.createNotification({
        userId: conversation.userId,
        conversationId: conversation.id,
        title: 'Task error',
        body: `Task failed after ${failures} attempts: ${errorMessage}`,
      });
    }

    // Keep conversation in background status for retry (unless auth error)
    // next_run_at stays the same, will be picked up on next poll

    await this.config.db.updateConversation(conversation.id, updates);
  }
}

/**
 * Create and start a background worker
 */
export function createBackgroundWorker(config: WorkerConfig): BackgroundWorker {
  const worker = new BackgroundWorker(config);
  return worker;
}
