/**
 * Conversation API Routes
 *
 * Handles conversation CRUD operations and message sending.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ConversationStatus } from '../../../../packages/shared-types/src';
import {
  isCreateScheduleResponse,
  isChatNeedsInputResponse,
  isStateUpdateResponse,
} from '../../../../packages/shared-types/src';
import type { ClaudeAgentClient, MockClaudeClient, ClaudeStreamMessage } from '../services/claude-client';
import { getNextRunTime } from '../services/cron-parser';

// Request validation schemas
const createConversationSchema = z.object({
  title: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
});

// Types for Hono context
interface Env {
  Variables: {
    userId: string;
    db: DatabaseConnection;
    chatService: ChatProcessingService;
    claudeClient: ClaudeAgentClient | MockClaudeClient;
  };
}

interface DatabaseConnection {
  createConversation(data: {
    userId: string;
    title: string;
    status: ConversationStatus;
  }): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  getConversations(userId: string): Promise<ConversationRecord[]>;
  getMessages(conversationId: string): Promise<MessageRecord[]>;
  updateConversation(id: string, updates: Partial<ConversationRecord>): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  insertMessage(message: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<MessageRecord>;
}

interface ChatProcessingService {
  processMessage(conversationId: string, content: string): Promise<{
    userMessage: MessageRecord;
    assistantMessage: MessageRecord;
    conversationUpdated: boolean;
    newStatus?: ConversationStatus;
  }>;
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

/**
 * Create conversation routes
 */
export function createConversationRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * POST /conversations - Create a new conversation
   */
  app.post(
    '/',
    zValidator('json', createConversationSchema),
    async (c) => {
      const { title } = c.req.valid('json');
      const userId = c.get('userId');
      const db = c.get('db');

      const conversation = await db.createConversation({
        userId,
        title: title || 'New Conversation',
        status: 'active',
      });

      return c.json({
        conversation: formatConversationResponse(conversation),
      }, 201);
    }
  );

  /**
   * GET /conversations - List user's conversations
   */
  app.get('/', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');

    const conversations = await db.getConversations(userId);

    return c.json({
      conversations: conversations.map(formatConversationResponse),
    });
  });

  /**
   * GET /conversations/:id - Get a specific conversation with messages
   */
  app.get('/:id', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const conversation = await db.getConversation(conversationId);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const messages = await db.getMessages(conversationId);

    return c.json({
      conversation: formatConversationResponse(conversation),
      messages: messages.map(formatMessageResponse),
    });
  });

  /**
   * POST /conversations/:id/messages - Send a message
   */
  app.post(
    '/:id/messages',
    zValidator('json', sendMessageSchema),
    async (c) => {
      const conversationId = c.req.param('id');
      const { content } = c.req.valid('json');
      const userId = c.get('userId');
      const db = c.get('db');
      const chatService = c.get('chatService');

      // Verify conversation exists and belongs to user
      const conversation = await db.getConversation(conversationId);

      if (!conversation) {
        return c.json({ error: 'Conversation not found' }, 404);
      }

      if (conversation.userId !== userId) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      // Check if conversation is archived
      if (conversation.status === 'archived') {
        return c.json({ error: 'Cannot send messages to archived conversation' }, 400);
      }

      // Process the message through chat service
      const result = await chatService.processMessage(conversationId, content);

      return c.json({
        message: formatMessageResponse(result.userMessage),
        assistantMessage: formatMessageResponse(result.assistantMessage),
        conversationUpdated: result.conversationUpdated,
        newStatus: result.newStatus,
      });
    }
  );

  /**
   * POST /conversations/:id/messages/stream - Send a message with SSE streaming response
   */
  app.post(
    '/:id/messages/stream',
    zValidator('json', sendMessageSchema),
    async (c) => {
      const conversationId = c.req.param('id');
      const { content } = c.req.valid('json');
      const userId = c.get('userId');
      const db = c.get('db');
      const claudeClient = c.get('claudeClient');

      // Verify conversation exists and belongs to user
      const conversation = await db.getConversation(conversationId);

      if (!conversation) {
        return c.json({ error: 'Conversation not found' }, 404);
      }

      if (conversation.userId !== userId) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      if (conversation.status === 'archived') {
        return c.json({ error: 'Cannot send messages to archived conversation' }, 400);
      }

      // Insert user message first
      const userMessage = await db.insertMessage({
        conversationId,
        role: 'user',
        content,
        source: 'chat',
      });

      // Load message history for context
      const messages = await db.getMessages(conversationId);
      const historyLines = messages.map((m) => `${m.role}: ${m.content}`);
      const prompt = historyLines.length > 0
        ? `${historyLines.join('\n\n')}\n\nuser: ${content}`
        : content;

      // Stream the response via SSE
      return streamSSE(c, async (stream) => {
        let fullResponse = '';
        let sessionId = conversation.claudeSessionId || '';
        let aborted = false;

        console.log(`[SSE] Starting stream for conversation ${conversationId}`);

        // Handle client disconnect
        stream.onAbort(() => {
          aborted = true;
          console.log(`[SSE] Stream aborted for conversation ${conversationId}`);
        });

        try {
          // Send user message event first
          console.log(`[SSE] Sending user_message event`);
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'user_message',
              data: formatMessageResponse(userMessage),
            }),
          });

          // Stream Claude's response
          console.log(`[SSE] Starting Claude stream...`);
          for await (const message of claudeClient.stream({
            prompt,
            sessionId: conversation.claudeSessionId || undefined,
          })) {
            if (aborted) break;

            console.log(`[SSE] Received message: ${message.type}`);

            // Track session ID
            if (message.type === 'init' && message.sessionId) {
              sessionId = message.sessionId;
            }

            // Accumulate response text
            if (message.type === 'assistant' && message.content) {
              fullResponse += message.content;
            }

            // Send SSE event based on message type
            let sseData: unknown;
            switch (message.type) {
              case 'assistant':
                sseData = message.content || '';
                break;
              case 'tool_use':
                sseData = {
                  id: `tool-${Date.now()}`,
                  name: message.toolName,
                  input: message.toolInput,
                };
                break;
              case 'tool_result':
                sseData = {
                  toolUseId: `tool-${Date.now()}`,
                  content: message.toolResult,
                };
                break;
              case 'init':
                sseData = { sessionId: message.sessionId };
                break;
              default:
                sseData = message;
            }

            await stream.writeSSE({
              data: JSON.stringify({
                type: message.type,
                data: sseData,
              }),
            });
          }
          console.log(`[SSE] Claude stream finished`);

          // Save response to database if stream completed successfully
          if (!aborted && fullResponse) {
            const assistantMessage = await db.insertMessage({
              conversationId,
              role: 'assistant',
              content: fullResponse,
              source: 'chat',
            });

            // Parse response for schedule/needs_input/state_update
            const parsedResponse = parseClaudeResponse(fullResponse);
            const conversationUpdates: Partial<ConversationRecord> = {
              claudeSessionId: sessionId,
            };
            let newStatus: ConversationStatus | undefined;

            // Handle schedule creation
            if (isCreateScheduleResponse(parsedResponse)) {
              const { create_schedule } = parsedResponse;
              conversationUpdates.scheduleType = create_schedule.type;
              conversationUpdates.status = 'background';
              newStatus = 'background';

              if (create_schedule.type === 'cron' && create_schedule.cron_expression) {
                conversationUpdates.cronExpression = create_schedule.cron_expression;
                conversationUpdates.nextRunAt = getNextRunTime(create_schedule.cron_expression);
              } else if (create_schedule.type === 'scheduled' && create_schedule.run_at) {
                conversationUpdates.scheduledRunAt = new Date(create_schedule.run_at);
                conversationUpdates.nextRunAt = new Date(create_schedule.run_at);
              } else if (create_schedule.type === 'immediate') {
                conversationUpdates.nextRunAt = new Date();
              }

              if (create_schedule.initial_state) {
                conversationUpdates.stateContext = create_schedule.initial_state.context || {};
                conversationUpdates.stateStep = create_schedule.initial_state.step || 'initial';
                conversationUpdates.stateData = create_schedule.initial_state.data || {};
              }

              console.log(`[SSE] Schedule created: ${create_schedule.type}`);
            }
            // Handle needs_input
            else if (isChatNeedsInputResponse(parsedResponse)) {
              const { needs_input } = parsedResponse;
              conversationUpdates.status = 'waiting_input';
              newStatus = 'waiting_input';
              conversationUpdates.pendingQuestionType = needs_input.type as any;
              conversationUpdates.pendingQuestionPrompt = needs_input.prompt;
              conversationUpdates.pendingQuestionOptions = needs_input.options || null;
              console.log(`[SSE] Needs input: ${needs_input.prompt}`);
            }
            // Handle state_update
            else if (isStateUpdateResponse(parsedResponse)) {
              const { state_update } = parsedResponse;
              conversationUpdates.stateData = {
                ...(conversation.stateData || {}),
                ...state_update,
              };
              console.log(`[SSE] State updated`);
            }

            // Update conversation
            await db.updateConversation(conversationId, conversationUpdates);

            // Send saved message event with status info
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'message_saved',
                data: {
                  message: formatMessageResponse(assistantMessage),
                  conversationUpdated: !!newStatus,
                  newStatus,
                },
              }),
            });
          }
        } catch (error) {
          console.error(`SSE stream error for conversation ${conversationId}:`, error);
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'error',
              data: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            }),
          });
        }
      });
    }
  );

  /**
   * PATCH /conversations/:id - Update conversation (archive, change title, etc.)
   */
  app.patch(
    '/:id',
    zValidator('json', z.object({
      title: z.string().optional(),
      status: z.enum(['active', 'archived']).optional(),
    })),
    async (c) => {
      const conversationId = c.req.param('id');
      const updates = c.req.valid('json');
      const userId = c.get('userId');
      const db = c.get('db');

      const conversation = await db.getConversation(conversationId);

      if (!conversation) {
        return c.json({ error: 'Conversation not found' }, 404);
      }

      if (conversation.userId !== userId) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      // Only allow certain status transitions
      if (updates.status === 'archived' && conversation.status === 'background') {
        // Stop background work when archiving
        await db.updateConversation(conversationId, {
          status: 'archived',
          scheduleType: null,
          cronExpression: null,
          nextRunAt: null,
          title: updates.title || conversation.title,
        });
      } else {
        await db.updateConversation(conversationId, {
          title: updates.title || conversation.title,
          status: updates.status as ConversationStatus || conversation.status,
        });
      }

      const updated = await db.getConversation(conversationId);

      return c.json({
        conversation: formatConversationResponse(updated!),
      });
    }
  );

  /**
   * DELETE /conversations/:id - Delete a conversation
   */
  app.delete('/:id', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const conversation = await db.getConversation(conversationId);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db.deleteConversation(conversationId);

    return c.json({ success: true });
  });

  /**
   * PATCH /conversations/:id/pause - Pause a background agent
   */
  app.patch('/:id/pause', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const conversation = await db.getConversation(conversationId);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (conversation.status !== 'background') {
      return c.json({ error: 'Can only pause background agents' }, 400);
    }

    // Pause by setting nextRunAt far in the future
    const pausedUntil = new Date();
    pausedUntil.setFullYear(pausedUntil.getFullYear() + 100);

    await db.updateConversation(conversationId, {
      nextRunAt: pausedUntil,
    });

    const updated = await db.getConversation(conversationId);

    return c.json({
      conversation: formatConversationResponse(updated!),
      paused: true,
    });
  });

  /**
   * PATCH /conversations/:id/resume - Resume a paused background agent
   */
  app.patch('/:id/resume', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const conversation = await db.getConversation(conversationId);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (conversation.status !== 'background') {
      return c.json({ error: 'Can only resume background agents' }, 400);
    }

    // Calculate next run time based on schedule type
    let nextRunAt: Date | null = null;

    if (conversation.scheduleType === 'cron' && conversation.cronExpression) {
      nextRunAt = getNextRunTime(conversation.cronExpression);
    } else if (conversation.scheduleType === 'scheduled' && conversation.scheduledRunAt) {
      // If scheduled time is in the past, run immediately
      const scheduledTime = new Date(conversation.scheduledRunAt);
      nextRunAt = scheduledTime > new Date() ? scheduledTime : new Date();
    } else {
      // Immediate - run now
      nextRunAt = new Date();
    }

    await db.updateConversation(conversationId, {
      nextRunAt,
    });

    const updated = await db.getConversation(conversationId);

    return c.json({
      conversation: formatConversationResponse(updated!),
      resumed: true,
    });
  });

  /**
   * POST /conversations/:id/run-now - Trigger immediate execution of a background agent
   */
  app.post('/:id/run-now', async (c) => {
    const conversationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const conversation = await db.getConversation(conversationId);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (conversation.status !== 'background') {
      return c.json({ error: 'Can only run background agents' }, 400);
    }

    // Set nextRunAt to now to trigger immediate execution
    await db.updateConversation(conversationId, {
      nextRunAt: new Date(),
    });

    const updated = await db.getConversation(conversationId);

    return c.json({
      conversation: formatConversationResponse(updated!),
      triggeredAt: new Date(),
    });
  });

  return app;
}

/**
 * Format conversation for API response
 */
function formatConversationResponse(conversation: ConversationRecord) {
  return {
    id: conversation.id,
    userId: conversation.userId,
    title: conversation.title,
    status: conversation.status,
    schedule: conversation.scheduleType
      ? {
          type: conversation.scheduleType,
          cronExpression: conversation.cronExpression,
          runAt: conversation.scheduledRunAt,
        }
      : null,
    nextRunAt: conversation.nextRunAt,
    state: {
      context: conversation.stateContext || {},
      step: conversation.stateStep || 'initial',
      data: conversation.stateData || {},
      pendingQuestion: conversation.pendingQuestionPrompt
        ? {
            type: conversation.pendingQuestionType,
            prompt: conversation.pendingQuestionPrompt,
            options: conversation.pendingQuestionOptions,
          }
        : null,
    },
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * Format message for API response
 */
function formatMessageResponse(message: MessageRecord) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    source: message.source,
    createdAt: message.createdAt,
  };
}

/**
 * Parse Claude response for structured commands (schedule, needs_input, state_update)
 * Looks for JSON objects in the response text
 */
function parseClaudeResponse(response: string): Record<string, unknown> {
  // Try to find a JSON object in the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { message: response };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Preserve any text outside the JSON as the message
    if (!parsed.message) {
      const textOutsideJson = response.replace(jsonMatch[0], '').trim();
      parsed.message = textOutsideJson || response;
    }
    return parsed;
  } catch {
    return { message: response };
  }
}
