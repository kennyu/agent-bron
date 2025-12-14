/**
 * Error Handling Tests
 *
 * Tests error handling scenarios for both ChatProcessingService and BackgroundWorker.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { BackgroundWorker, createBackgroundWorker } from './background-worker';
import { ChatProcessingService } from '../services/chat-processing';
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

function createMockConversation(overrides: Partial<MockConversation> = {}): MockConversation {
  return {
    id: 'conv-123',
    userId: 'user-456',
    title: 'Test Task',
    status: 'background',
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    scheduledRunAt: null,
    nextRunAt: new Date(),
    stateContext: { task: 'test' },
    stateStep: 'initial',
    stateData: {},
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

describe('Error Handling', () => {
  describe('BackgroundWorker Error Handling', () => {
    let mockDb: {
      getReadyConversations: ReturnType<typeof mock>;
      getConversation: ReturnType<typeof mock>;
      getMessages: ReturnType<typeof mock>;
      getUserIntegrations: ReturnType<typeof mock>;
      updateConversation: ReturnType<typeof mock>;
      insertMessage: ReturnType<typeof mock>;
      createNotification: ReturnType<typeof mock>;
    };
    let mockClaudeClient: { run: ReturnType<typeof mock> };
    let worker: BackgroundWorker;

    beforeEach(() => {
      mockDb = {
        getReadyConversations: mock(() => Promise.resolve([])),
        getConversation: mock(() => Promise.resolve(createMockConversation())),
        getMessages: mock(() => Promise.resolve([])),
        getUserIntegrations: mock(() => Promise.resolve([])),
        updateConversation: mock(() => Promise.resolve()),
        insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
          Promise.resolve(createMockMessage({ ...msg }))
        ),
        createNotification: mock(() => Promise.resolve()),
      };
      mockClaudeClient = {
        run: mock(() =>
          Promise.resolve({
            response: JSON.stringify({ complete: true, message: 'Done' }),
            sessionId: 'session-new',
          })
        ),
      };
      worker = createBackgroundWorker({
        db: mockDb,
        claudeClient: mockClaudeClient,
        encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
        pollIntervalMs: 50,
        maxConcurrent: 3,
        maxMessagesToInclude: 20,
        executionTimeoutMs: 5000,
        maxRetries: 3,
      });
    });

    afterEach(() => {
      worker.stop();
    });

    describe('auth errors', () => {
      test('sets waiting_input status on auth error', async () => {
        const conversation = createMockConversation();
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('OAuth token expired');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        const updateCalls = mockDb.updateConversation.mock.calls;
        expect(updateCalls.length).toBeGreaterThan(0);
        const lastUpdate = updateCalls[updateCalls.length - 1][1];
        expect(lastUpdate.status).toBe('waiting_input');
        expect(lastUpdate.pendingQuestionPrompt).toContain('expired');
      });

      test('creates notification on auth error', async () => {
        const conversation = createMockConversation();
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('unauthorized access');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        expect(mockDb.createNotification).toHaveBeenCalled();
        const notifCall = mockDb.createNotification.mock.calls[0][0];
        expect(notifCall.title).toContain('expired');
      });

      test('detects auth failed error pattern', async () => {
        const conversation = createMockConversation({ id: 'conv-auth-failed' });
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('auth failed');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        const updateCalls = mockDb.updateConversation.mock.calls;
        const lastUpdate = updateCalls[updateCalls.length - 1][1];
        expect(lastUpdate.status).toBe('waiting_input');
      });

      test('detects invalid token error pattern', async () => {
        const conversation = createMockConversation({ id: 'conv-invalid-token' });
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('invalid token');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        const updateCalls = mockDb.updateConversation.mock.calls;
        const lastUpdate = updateCalls[updateCalls.length - 1][1];
        expect(lastUpdate.status).toBe('waiting_input');
      });
    });

    describe('retry behavior', () => {
      test('increments consecutive failures on error', async () => {
        const conversation = createMockConversation({ consecutiveFailures: '0' });
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('Network error');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        const updateCalls = mockDb.updateConversation.mock.calls;
        const lastUpdate = updateCalls[updateCalls.length - 1][1];
        expect(lastUpdate.consecutiveFailures).toBe('1');
      });

      test('notifies user after max retries', async () => {
        // Already at 2 failures, next failure is 3rd (max)
        const conversation = createMockConversation({ consecutiveFailures: '2' });
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('Persistent error');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        expect(mockDb.createNotification).toHaveBeenCalled();
        const notifCall = mockDb.createNotification.mock.calls[0][0];
        expect(notifCall.title).toContain('error');
        expect(notifCall.body).toContain('3 attempts');
      });

      test('does not notify before max retries for non-auth errors', async () => {
        const conversation = createMockConversation({ consecutiveFailures: '0' });
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => {
          throw new Error('Temporary network glitch');
        });

        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        // No notification for first failure (non-auth)
        expect(mockDb.createNotification).not.toHaveBeenCalled();
      });
    });

    describe('database errors', () => {
      test('handles database read error gracefully', async () => {
        mockDb.getReadyConversations = mock(async () => {
          throw new Error('Database connection lost');
        });

        // Should not crash
        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();

        // Worker should still be able to stop
        expect(true).toBe(true);
      });

      test('handles message insertion error', async () => {
        const conversation = createMockConversation();
        let returnsConv = true;
        mockDb.getReadyConversations = mock(() => {
          if (returnsConv) {
            returnsConv = false;
            return Promise.resolve([conversation]);
          }
          return Promise.resolve([]);
        });

        mockClaudeClient.run = mock(async () => ({
          response: JSON.stringify({
            needs_input: true,
            message: 'Question',
            question: { type: 'confirmation', prompt: 'OK?' },
          }),
          sessionId: 'session-new',
        }));

        mockDb.insertMessage = mock(async () => {
          throw new Error('Insert failed');
        });

        // Should handle gracefully (error logged but not crashing)
        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        worker.stop();
      });
    });
  });

  describe('ChatProcessingService Error Handling', () => {
    let mockDb: {
      getConversation: ReturnType<typeof mock>;
      getMessages: ReturnType<typeof mock>;
      getUserIntegrations: ReturnType<typeof mock>;
      updateConversation: ReturnType<typeof mock>;
      insertMessage: ReturnType<typeof mock>;
      createNotification: ReturnType<typeof mock>;
    };
    let mockClaudeClient: { run: ReturnType<typeof mock> };
    let service: ChatProcessingService;

    beforeEach(() => {
      let msgCounter = 0;
      mockDb = {
        getConversation: mock(() => Promise.resolve(createMockConversation({ status: 'active' }))),
        getMessages: mock(() => Promise.resolve([])),
        getUserIntegrations: mock(() => Promise.resolve([])),
        updateConversation: mock(() => Promise.resolve()),
        insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
          Promise.resolve(createMockMessage({ ...msg, id: `msg-${++msgCounter}` }))
        ),
        createNotification: mock(() => Promise.resolve()),
      };
      mockClaudeClient = {
        run: mock(() =>
          Promise.resolve({
            response: 'Hello!',
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

    describe('conversation errors', () => {
      test('throws error for non-existent conversation', async () => {
        mockDb.getConversation = mock(() => Promise.resolve(null));

        await expect(service.processMessage('non-existent', 'Hi')).rejects.toThrow(
          'Conversation not found'
        );
      });
    });

    describe('Claude SDK errors', () => {
      test('propagates Claude SDK errors', async () => {
        mockClaudeClient.run = mock(async () => {
          throw new Error('Claude API error');
        });

        await expect(service.processMessage('conv-123', 'Hi')).rejects.toThrow(
          'Claude API error'
        );
      });

      test('propagates timeout errors', async () => {
        mockClaudeClient.run = mock(async () => {
          throw new Error('Request timeout');
        });

        await expect(service.processMessage('conv-123', 'Hi')).rejects.toThrow(
          'Request timeout'
        );
      });
    });

    describe('response parsing errors', () => {
      test('handles malformed JSON gracefully', async () => {
        mockClaudeClient.run = mock(async () => ({
          response: '{ malformed json',
          sessionId: 'session-new',
        }));

        // Should not throw, returns the raw response as message
        const result = await service.processMessage('conv-123', 'Hi');
        expect(result.assistantMessage.content).toBe('{ malformed json');
      });

      test('handles empty response', async () => {
        mockClaudeClient.run = mock(async () => ({
          response: '',
          sessionId: 'session-new',
        }));

        const result = await service.processMessage('conv-123', 'Hi');
        expect(result.assistantMessage.content).toBe('');
      });

      test('handles response with only whitespace', async () => {
        mockClaudeClient.run = mock(async () => ({
          response: '   \n\t  ',
          sessionId: 'session-new',
        }));

        const result = await service.processMessage('conv-123', 'Hi');
        expect(result.assistantMessage.content.trim()).toBe('');
      });
    });

    describe('database errors', () => {
      test('propagates message insertion errors', async () => {
        mockDb.insertMessage = mock(async () => {
          throw new Error('Database write failed');
        });

        await expect(service.processMessage('conv-123', 'Hi')).rejects.toThrow(
          'Database write failed'
        );
      });

      test('propagates conversation update errors', async () => {
        mockClaudeClient.run = mock(async () => ({
          response: JSON.stringify({ create_schedule: { type: 'immediate' }, message: 'OK' }),
          sessionId: 'session-new',
        }));

        mockDb.updateConversation = mock(async () => {
          throw new Error('Update failed');
        });

        await expect(service.processMessage('conv-123', 'Schedule this')).rejects.toThrow(
          'Update failed'
        );
      });
    });
  });

  describe('Edge Cases', () => {
    test('handles very long error messages', async () => {
      const mockDb = {
        getReadyConversations: mock(() => Promise.resolve([])),
        getConversation: mock(() => Promise.resolve(createMockConversation())),
        getMessages: mock(() => Promise.resolve([])),
        getUserIntegrations: mock(() => Promise.resolve([])),
        updateConversation: mock(() => Promise.resolve()),
        insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
          Promise.resolve(createMockMessage({ ...msg }))
        ),
        createNotification: mock(() => Promise.resolve()),
      };

      const longErrorMessage = 'A'.repeat(10000);
      const mockClaudeClient = {
        run: mock(async () => {
          throw new Error(longErrorMessage);
        }),
      };

      const worker = createBackgroundWorker({
        db: mockDb,
        claudeClient: mockClaudeClient,
        encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
        pollIntervalMs: 50,
        maxConcurrent: 1,
        maxMessagesToInclude: 20,
        executionTimeoutMs: 5000,
        maxRetries: 0, // So it notifies immediately
      });

      const conversation = createMockConversation();
      let returnsConv = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConv) {
          returnsConv = false;
          return Promise.resolve([conversation]);
        }
        return Promise.resolve([]);
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      // Should handle without crashing
      expect(mockDb.updateConversation).toHaveBeenCalled();
    });

    test('handles error with special characters', async () => {
      const mockDb = {
        getReadyConversations: mock(() => Promise.resolve([])),
        getConversation: mock(() => Promise.resolve(createMockConversation())),
        getMessages: mock(() => Promise.resolve([])),
        getUserIntegrations: mock(() => Promise.resolve([])),
        updateConversation: mock(() => Promise.resolve()),
        insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
          Promise.resolve(createMockMessage({ ...msg }))
        ),
        createNotification: mock(() => Promise.resolve()),
      };

      const mockClaudeClient = {
        run: mock(async () => {
          throw new Error('Error with "quotes" and <tags> and &special chars');
        }),
      };

      const worker = createBackgroundWorker({
        db: mockDb,
        claudeClient: mockClaudeClient,
        encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
        pollIntervalMs: 50,
        maxConcurrent: 1,
        maxMessagesToInclude: 20,
        executionTimeoutMs: 5000,
        maxRetries: 0,
      });

      const conversation = createMockConversation();
      let returnsConv = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConv) {
          returnsConv = false;
          return Promise.resolve([conversation]);
        }
        return Promise.resolve([]);
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      // Should handle without crashing
      expect(mockDb.updateConversation).toHaveBeenCalled();
    });

    test('handles non-Error exception', async () => {
      const mockDb = {
        getReadyConversations: mock(() => Promise.resolve([])),
        getConversation: mock(() => Promise.resolve(createMockConversation())),
        getMessages: mock(() => Promise.resolve([])),
        getUserIntegrations: mock(() => Promise.resolve([])),
        updateConversation: mock(() => Promise.resolve()),
        insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
          Promise.resolve(createMockMessage({ ...msg }))
        ),
        createNotification: mock(() => Promise.resolve()),
      };

      const mockClaudeClient = {
        run: mock(async () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'String error instead of Error object';
        }),
      };

      const worker = createBackgroundWorker({
        db: mockDb,
        claudeClient: mockClaudeClient,
        encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
        pollIntervalMs: 50,
        maxConcurrent: 1,
        maxMessagesToInclude: 20,
        executionTimeoutMs: 5000,
        maxRetries: 0,
      });

      const conversation = createMockConversation();
      let returnsConv = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConv) {
          returnsConv = false;
          return Promise.resolve([conversation]);
        }
        return Promise.resolve([]);
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      // Should handle string throw without crashing
      expect(mockDb.updateConversation).toHaveBeenCalled();
    });
  });
});
