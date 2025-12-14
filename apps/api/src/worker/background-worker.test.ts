/**
 * Background Worker Integration Tests
 *
 * Tests the BackgroundWorker with mocked database and Claude SDK.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { BackgroundWorker, createBackgroundWorker } from './background-worker';
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
    title: 'Test Task',
    status: 'background',
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    scheduledRunAt: null,
    nextRunAt: new Date(),
    stateContext: { task: 'check email' },
    stateStep: 'initial',
    stateData: {},
    pendingQuestionType: null,
    pendingQuestionPrompt: null,
    pendingQuestionOptions: null,
    claudeSessionId: null,
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

describe('BackgroundWorker', () => {
  let mockDb: {
    getReadyConversations: ReturnType<typeof mock>;
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
  let worker: BackgroundWorker;
  let messageCounter: number;

  beforeEach(() => {
    messageCounter = 0;
    mockDb = {
      getReadyConversations: mock(() => Promise.resolve([])),
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
          response: JSON.stringify({ complete: true, message: 'Task done' }),
          sessionId: 'session-new',
        })
      ),
    };
    worker = createBackgroundWorker({
      db: mockDb,
      claudeClient: mockClaudeClient,
      encryptionKey: Buffer.from('0'.repeat(64), 'hex'),
      pollIntervalMs: 100, // Fast polling for tests
      maxConcurrent: 5,
      maxMessagesToInclude: 20,
      executionTimeoutMs: 5000,
      maxRetries: 3,
    });
  });

  afterEach(() => {
    worker.stop();
  });

  describe('worker lifecycle', () => {
    test('starts and stops correctly', () => {
      expect(() => worker.start()).not.toThrow();
      expect(() => worker.stop()).not.toThrow();
    });

    test('does not start twice', () => {
      worker.start();
      // Second start should be a no-op
      worker.start();
      worker.stop();
    });
  });

  describe('polling', () => {
    test('polls for ready conversations', async () => {
      mockDb.getReadyConversations = mock(() => Promise.resolve([]));

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      worker.stop();

      expect(mockDb.getReadyConversations).toHaveBeenCalled();
    });

    test('executes ready conversations', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => Promise.resolve([conversation]));

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      expect(mockClaudeClient.run).toHaveBeenCalled();
    });
  });

  describe('needs_input response handling', () => {
    test('sets conversation to waiting_input', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        // Return conversation once, then empty
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            needs_input: true,
            message: 'I need your approval',
            question: {
              type: 'confirmation',
              prompt: 'Should I proceed?',
            },
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      expect(updateCalls.length).toBeGreaterThan(0);

      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.status).toBe('waiting_input');
      expect(lastUpdate.pendingQuestionType).toBe('confirmation');
      expect(lastUpdate.pendingQuestionPrompt).toBe('Should I proceed?');
    });

    test('creates notification for needs_input', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            needs_input: true,
            message: 'I need approval',
            question: { type: 'confirmation', prompt: 'Proceed?' },
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      expect(mockDb.createNotification).toHaveBeenCalled();
      const notifCall = mockDb.createNotification.mock.calls[0][0];
      expect(notifCall.userId).toBe('user-456');
      expect(notifCall.conversationId).toBe('conv-123');
    });

    test('saves choice options in pending question', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            needs_input: true,
            message: 'Which one?',
            question: {
              type: 'choice',
              prompt: 'Select an option',
              options: ['A', 'B', 'C'],
            },
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.pendingQuestionOptions).toEqual(['A', 'B', 'C']);
    });
  });

  describe('complete response handling', () => {
    test('reschedules cron job after completion', async () => {
      const conversation = createMockConversation({
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ complete: true, message: 'Done for today' }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.status).toBe('background');
      expect(lastUpdate.nextRunAt).toBeInstanceOf(Date);
    });

    test('clears schedule for one-time task', async () => {
      const conversation = createMockConversation({
        scheduleType: 'scheduled',
        cronExpression: null,
        scheduledRunAt: new Date(),
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ complete: true, message: 'One-time task done' }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.status).toBe('active');
      expect(lastUpdate.scheduleType).toBeNull();
      expect(lastUpdate.nextRunAt).toBeNull();
    });

    test('creates notification for one-time task completion', async () => {
      const conversation = createMockConversation({
        scheduleType: 'immediate',
        cronExpression: null,
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ complete: true, message: 'All done!' }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      expect(mockDb.createNotification).toHaveBeenCalled();
    });
  });

  describe('continue response handling', () => {
    test('merges state_update into stateData', async () => {
      const conversation = createMockConversation({
        stateData: { count: 1, existing: 'value' },
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            continue: true,
            state_update: { count: 2, newField: 'added' },
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.stateData).toEqual({
        existing: 'value',
        count: 2,
        newField: 'added',
      });
    });

    test('updates step when next_step provided', async () => {
      const conversation = createMockConversation({
        stateStep: 'step1',
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            continue: true,
            next_step: 'step2',
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.stateStep).toBe('step2');
    });

    test('calculates next run time for cron', async () => {
      const conversation = createMockConversation({
        scheduleType: 'cron',
        cronExpression: '*/5 * * * *',
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ continue: true }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.nextRunAt).toBeInstanceOf(Date);
    });

    test('sets immediate next run for immediate type', async () => {
      const conversation = createMockConversation({
        scheduleType: 'immediate',
        cronExpression: null,
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ continue: true }),
          sessionId: 'session-new',
        })
      );

      const before = new Date();
      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();
      const after = new Date();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.nextRunAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(lastUpdate.nextRunAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    test('inserts status message when provided', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({
            continue: true,
            message: 'Processed 10 items',
          }),
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      expect(mockDb.insertMessage).toHaveBeenCalled();
      const insertCall = mockDb.insertMessage.mock.calls[0][0];
      expect(insertCall.content).toBe('Processed 10 items');
      expect(insertCall.source).toBe('worker');
    });
  });

  describe('response parsing', () => {
    test('handles non-JSON response as continue', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: 'Just some text without JSON',
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      // Should be treated as continue
      expect(mockDb.updateConversation).toHaveBeenCalled();
    });

    test('handles invalid JSON as continue', async () => {
      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: '{ invalid json }',
          sessionId: 'session-new',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      // Should not throw, treated as continue
      expect(mockDb.updateConversation).toHaveBeenCalled();
    });
  });

  describe('session management', () => {
    test('resets consecutive failures on success', async () => {
      const conversation = createMockConversation({
        consecutiveFailures: '2',
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.consecutiveFailures).toBe('0');
    });

    test('updates session ID', async () => {
      const conversation = createMockConversation({
        claudeSessionId: 'old-session',
      });
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });
      mockClaudeClient.run = mock(() =>
        Promise.resolve({
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'new-session',
        })
      );

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.claudeSessionId).toBe('new-session');
    });
  });

  describe('message history', () => {
    test('loads message history for context', async () => {
      const messages = [
        createMockMessage({ role: 'user', content: 'Start task' }),
        createMockMessage({ role: 'assistant', content: 'Starting...' }),
      ];
      mockDb.getMessages = mock(() => Promise.resolve(messages));

      const conversation = createMockConversation();
      mockDb.getReadyConversations = mock(() => {
        mockDb.getReadyConversations = mock(() => Promise.resolve([]));
        return Promise.resolve([conversation]);
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      expect(mockDb.getMessages).toHaveBeenCalledWith('conv-123', 20);
      const runCall = mockClaudeClient.run.mock.calls[0][0];
      expect(runCall.prompt).toContain('Start task');
      expect(runCall.prompt).toContain('Starting...');
    });
  });
});
