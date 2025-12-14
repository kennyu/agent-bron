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
} from '../../../../packages/shared-types/src/index';
import {
  isCreateScheduleResponse,
  isChatNeedsInputResponse,
  isStateUpdateResponse,
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

    // 2. Load user's MCP configs with credential decryption
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

    // 3. Insert user message
    const userMessage = await this.db.insertMessage({
      conversationId,
      role: 'user',
      content: userContent,
      source: 'chat',
    });

    // 4. Build system prompt with context
    const systemPrompt = this.buildSystemPrompt(conversation, activeIntegrations);

    // 5. Build conversation prompt with message history
    const prompt = this.buildPrompt(messages, userContent, conversation);

    // 6. Call Claude Code SDK
    const result = await this.claudeClient.run({
      prompt,
      systemPrompt,
      sessionId: conversation.claudeSessionId || undefined,
      mcpConfig,
      timeout: 120000, // 2 minutes
    });

    // 7. Parse Claude's response
    const parsedResponse = this.parseClaudeResponse(result.response);

    // 8. Update conversation based on response
    const updates = await this.handleChatResponse(
      conversation,
      parsedResponse,
      result.sessionId
    );

    // 9. Insert assistant message
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
   * Build system prompt with user integrations and conversation state
   */
  private buildSystemPrompt(
    conversation: ConversationRecord,
    integrations: IntegrationRecord[]
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

    let statusContext = '';
    if (conversation.status === 'waiting_input' && conversation.pendingQuestionPrompt) {
      statusContext = `User is responding to: "${conversation.pendingQuestionPrompt}"`;
    } else if (conversation.status === 'background' && conversation.scheduleType) {
      statusContext = `Background work is scheduled: ${conversation.scheduleType}`;
      if (conversation.cronExpression) {
        statusContext += ` (${conversation.cronExpression})`;
      }
    }

    return `You are an AI assistant in a conversation that may have background work.

USER'S CONNECTED INTEGRATIONS:
${connectedList}

AVAILABLE INTEGRATIONS (not connected):
${availableList}

CONVERSATION STATE:
${stateJson}

CONVERSATION STATUS: ${conversation.status}
${statusContext}

INSTRUCTIONS:

For normal conversation, just respond naturally.

To create background/scheduled work, include in your response:
{
  "create_schedule": { "type": "cron|scheduled|immediate", "cron_expression": "...", "initial_state": {...} },
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
