/**
 * Chat Processing Integration Tests
 *
 * Tests the ChatProcessingService with mocked database and Claude SDK.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ChatProcessingService } from './chat-processing';
import type { ConversationStatus } from '../../../../packages/shared-types/src';

// Mock types
interface MockConversation {
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

interface MockMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: 'chat' | 'worker';
  createdAt: Date;
}

// Mock factory functions
function createMockConversation(overrides: Partial<MockConversation> = {}): MockConversation {
  return {
    id: 'conv-123',
    userId: 'user-456',
    title: 'Test Conversation',
    status: 'active',
    scheduleType: null,
    cronExpression: null,
    scheduledRunAt: null,
    nextRunAt: null,
    stateContext: null,
    stateStep: null,
    stateData: null,
    pendingQuestionType: null,
    pendingQuestionPrompt: null,
    pendingQuestionOptions: null,
    claudeSessionId: null,
    skills: null,
    consecutiveFailures: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: `msg-${Date.now()}`,
    conversationId: 'conv-123',
    role: 'user',
    content: 'Hello',
    source: 'chat',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('ChatProcessingService', () => {
  let mockDb: {
    getConversation: ReturnType<typeof mock>;
    getMessages: ReturnType<typeof mock>;
    getUserIntegrations: ReturnType<typeof mock>;
    updateConversation: ReturnType<typeof mock>;
    insertMessage: ReturnType<typeof mock>;
    createNotification: ReturnType<typeof mock>;
  };
  let mockClaudeClient: {
    run: ReturnType<typeof mock>;
  };
  let service: ChatProcessingService;
  let messageCounter: number;

  beforeEach(() => {
    messageCounter = 0;
    mockDb = {
      getConversation: mock(() => Promise.resolve(createMockConversation())),
      getMessages: mock(() => Promise.resolve([])),
      getUserIntegrations: mock(() => Promise.resolve([])),
      updateConversation: mock(() => Promise.resolve()),
      insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
        Promise.resolve(createMockMessage({ ...msg, id: `msg-${++messageCounter}` }))
      ),
      createNotification: mock(() => Promise.resolve()),
    };
    mockClaudeClient = {
      run: mock(() =>
        Promise.resolve({
          response: 'Hello! How can I help you?',
          sessionId: 'session-new',
        })
      ),
    };
    service = new ChatProcessingService({
      db: mockDb,
      claudeClient: mockClaudeClient,
      encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
      maxMessageHistory: 50,
    });
  });

  describe('normal chat flow', () => {
    test('processes a simple message successfully', async () => {
      const result = await service.processMessage('conv-123', 'Hello');

      expect(mockDb.getConversation).toHaveBeenCalledWith('conv-123');
      expect(mockDb.getMessages).toHaveBeenCalledWith('conv-123', 50);
      expect(mockDb.insertMessage).toHaveBeenCalledTimes(2); // user + assistant
      expect(mockClaudeClient.run).toHaveBeenCalledTimes(1);

      expect(result.userMessage.content).toBe('Hello');
      expect(result.userMessage.role).toBe('user');
      expect(result.assistantMessage.content).toBe('Hello! How can I help you?');
      expect(result.assistantMessage.role).toBe('assistant');
    });

    test('throws error for non-existent conversation', async () => {
      mockDb.getConversation = mock(() => Promise.resolve(null));

      await expect(service.processMessage('non-existent', 'Hello')).rejects.toThrow(
        'Conversation not found'
      );
    });

    test('includes message history in prompt', async () => {
      const existingMessages = [
        createMockMessage({ role: 'user', content: 'Previous question' }),
        createMockMessage({ role: 'assistant', content: 'Previous answer' }),
      ];
      mockDb.getMessages = mock(() => Promise.resolve(existingMessages));

      await service.processMessage('conv-123', 'New question');

      const runCall = mockClaudeClient.run.mock.calls[0];
      const prompt = runCall[0].prompt;
      expect(prompt).toContain('Previous question');
      expect(prompt).toContain('Previous answer');
      expect(prompt).toContain('New question');
    });

    test('updates session ID after response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: 'Response',
          sessionId: 'new-session-id',
        })
      );

      await service.processMessage('conv-123', 'Hello');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].claudeSessionId).toBe('new-session-id');
    });
  });

  describe('schedule creation flow', () => {
    test('creates cron schedule from response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            create_schedule: {
              type: 'cron',
              cron_expression: '0 9 * * *',
              initial_state: {
                context: { task: 'check email' },
                step: 'initial',
                data: {},
              },
            },
            message: 'I will check your email daily at 9 AM.',
          }),
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Check my email every day at 9 AM');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].status).toBe('background');
      expect(updateCall[1].scheduleType).toBe('cron');
      expect(updateCall[1].cronExpression).toBe('0 9 * * *');
      expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
      expect(updateCall[1].stateContext).toEqual({ task: 'check email' });
      expect(result.newStatus).toBe('background');
    });

    test('creates immediate schedule from response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            create_schedule: { type: 'immediate' },
            message: 'Running the task now.',
          }),
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Run this now');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].status).toBe('background');
      expect(updateCall[1].scheduleType).toBe('immediate');
      expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
      expect(result.newStatus).toBe('background');
    });

    test('creates scheduled (one-time) task from response', async () => {
      const futureDate = new Date('2024-12-31T10:00:00.000Z');
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            create_schedule: {
              type: 'scheduled',
              run_at: futureDate.toISOString(),
            },
            message: 'Will run on December 31st.',
          }),
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Do this on Dec 31');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].scheduleType).toBe('scheduled');
      expect(updateCall[1].scheduledRunAt).toEqual(futureDate);
      expect(updateCall[1].nextRunAt).toEqual(futureDate);
      expect(result.newStatus).toBe('background');
    });
  });

  describe('needs_input flow', () => {
    test('handles needs_input response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            needs_input: {
              type: 'confirmation',
              prompt: 'Should I proceed with the deletion?',
            },
            message: 'This will delete 5 files. Confirm?',
          }),
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Delete all temp files');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].status).toBe('waiting_input');
      expect(updateCall[1].pendingQuestionType).toBe('confirmation');
      expect(updateCall[1].pendingQuestionPrompt).toBe('Should I proceed with the deletion?');
      expect(result.newStatus).toBe('waiting_input');
    });

    test('handles choice type needs_input', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            needs_input: {
              type: 'choice',
              prompt: 'Which format?',
              options: ['PDF', 'CSV', 'Excel'],
            },
            message: 'Please select your preferred format.',
          }),
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Export my data');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].pendingQuestionType).toBe('choice');
      expect(updateCall[1].pendingQuestionOptions).toEqual(['PDF', 'CSV', 'Excel']);
      expect(result.newStatus).toBe('waiting_input');
    });

    test('clears pending question when user responds', async () => {
      const conversation = createMockConversation({
        status: 'waiting_input',
        pendingQuestionType: 'confirmation',
        pendingQuestionPrompt: 'Proceed?',
      });
      mockDb.getConversation = mock(() => Promise.resolve(conversation));
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: 'Great, proceeding now.',
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Yes');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].pendingQuestionType).toBeNull();
      expect(updateCall[1].pendingQuestionPrompt).toBeNull();
      expect(updateCall[1].status).toBe('active');
      expect(result.newStatus).toBe('active');
    });

    test('resumes background work when answering question on scheduled conversation', async () => {
      const conversation = createMockConversation({
        status: 'waiting_input',
        pendingQuestionType: 'confirmation',
        pendingQuestionPrompt: 'Proceed?',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
      });
      mockDb.getConversation = mock(() => Promise.resolve(conversation));
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: 'OK, resuming the schedule.',
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Yes, continue');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].status).toBe('background');
      expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
      expect(result.newStatus).toBe('background');
    });
  });

  describe('state_update flow', () => {
    test('merges state update with existing data', async () => {
      const conversation = createMockConversation({
        stateData: { existing: 'value', count: 1 },
      });
      mockDb.getConversation = mock(() => Promise.resolve(conversation));
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            state_update: { count: 2, newField: 'added' },
            message: 'Updated the count.',
          }),
          sessionId: 'session-new',
        })
      );

      await service.processMessage('conv-123', 'Increment counter');

      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].stateData).toEqual({
        existing: 'value',
        count: 2,
        newField: 'added',
      });
    });
  });

  describe('MCP integration', () => {
    test('loads user integrations and builds MCP config', async () => {
      const integrations = [
        {
          id: 'int-1',
          userId: 'user-456',
          provider: 'gmail',
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          tokenExpiresAt: null,
          metadata: { email: 'user@example.com' },
          isActive: 'true',
        },
      ];
      mockDb.getUserIntegrations = mock(() => Promise.resolve(integrations));

      await service.processMessage('conv-123', 'Check my email');

      expect(mockDb.getUserIntegrations).toHaveBeenCalledWith('user-456');
      const runCall = mockClaudeClient.run.mock.calls[0];
      expect(runCall[0].systemPrompt).toContain('gmail');
    });

    test('includes integration info in system prompt', async () => {
      const integrations = [
        {
          id: 'int-1',
          userId: 'user-456',
          provider: 'gmail',
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          tokenExpiresAt: null,
          metadata: { email: 'user@example.com' },
          isActive: 'true',
        },
      ];
      mockDb.getUserIntegrations = mock(() => Promise.resolve(integrations));

      await service.processMessage('conv-123', 'Check my email');

      const runCall = mockClaudeClient.run.mock.calls[0];
      expect(runCall[0].systemPrompt).toContain('user@example.com');
    });
  });

  describe('session management', () => {
    test('uses existing session ID if available', async () => {
      const conversation = createMockConversation({
        claudeSessionId: 'existing-session',
      });
      mockDb.getConversation = mock(() => Promise.resolve(conversation));

      await service.processMessage('conv-123', 'Continue');

      const runCall = mockClaudeClient.run.mock.calls[0];
      expect(runCall[0].sessionId).toBe('existing-session');
    });

    test('omits session ID for new conversation', async () => {
      const conversation = createMockConversation({
        claudeSessionId: null,
      });
      mockDb.getConversation = mock(() => Promise.resolve(conversation));

      await service.processMessage('conv-123', 'Start');

      const runCall = mockClaudeClient.run.mock.calls[0];
      expect(runCall[0].sessionId).toBeUndefined();
    });
  });

  describe('response parsing', () => {
    test('handles mixed text and JSON response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: `Sure, I'll help with that.

{"create_schedule": {"type": "immediate"}, "message": "Starting now."}

Let me know if you need anything else.`,
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Run this');

      // Should extract the JSON and create schedule
      const updateCall = mockDb.updateConversation.mock.calls[0];
      expect(updateCall[1].scheduleType).toBe('immediate');
      // Message should be from the JSON
      expect(result.assistantMessage.content).toBe('Starting now.');
    });

    test('handles plain text response', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: 'Just a simple text response with no JSON.',
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Hi');

      expect(result.assistantMessage.content).toBe(
        'Just a simple text response with no JSON.'
      );
      expect(result.conversationUpdated).toBe(false);
    });

    test('handles invalid JSON gracefully', async () => {
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: '{ invalid json content here }',
          sessionId: 'session-new',
        })
      );

      const result = await service.processMessage('conv-123', 'Test');

      // Should treat as plain text
      expect(result.assistantMessage.content).toBe('{ invalid json content here }');
    });
  });
});
