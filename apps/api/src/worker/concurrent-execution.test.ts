/**
 * Concurrent Worker Execution Tests
 *
 * Tests the BackgroundWorker's ability to handle multiple conversations concurrently.
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

function createMockConversation(
  id: string,
  overrides: Partial<MockConversation> = {}
): MockConversation {
  return {
    id,
    userId: 'user-456',
    title: `Task ${id}`,
    status: 'background',
    scheduleType: 'immediate',
    cronExpression: null,
    scheduledRunAt: null,
    nextRunAt: new Date(),
    stateContext: { taskId: id },
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
    id: `msg-${Date.now()}-${Math.random()}`,
    conversationId: 'conv-123',
    role: 'user',
    content: 'Hello',
    source: 'chat',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('Concurrent Worker Execution', () => {
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
  let executionTimes: Map<string, { start: number; end: number }>;

  beforeEach(() => {
    executionTimes = new Map();
    mockDb = {
      getReadyConversations: mock(() => Promise.resolve([])),
      getConversation: mock(() => Promise.resolve(null)),
      getMessages: mock(() => Promise.resolve([])),
      getUserIntegrations: mock(() => Promise.resolve([])),
      updateConversation: mock(() => Promise.resolve()),
      insertMessage: mock((msg: Omit<MockMessage, 'id' | 'createdAt'>) =>
        Promise.resolve(createMockMessage({ ...msg }))
      ),
      createNotification: mock(() => Promise.resolve()),
    };
    mockClaudeClient = {
      run: mock(async () => {
        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      }),
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

  describe('concurrent execution limits', () => {
    test('processes multiple conversations in parallel', async () => {
      const conversations = [
        createMockConversation('conv-1'),
        createMockConversation('conv-2'),
        createMockConversation('conv-3'),
      ];

      let callCount = 0;
      mockDb.getReadyConversations = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(conversations);
        }
        return Promise.resolve([]);
      });

      // Track when each conversation starts execution
      const executionOrder: string[] = [];
      mockClaudeClient.run = mock(async (options: { prompt: string }) => {
        // Extract conversation ID from prompt
        const match = options.prompt.match(/"taskId":\s*"(conv-\d+)"/);
        const convId = match ? match[1] : 'unknown';
        executionOrder.push(convId);

        // Small delay to simulate work
        await new Promise((resolve) => setTimeout(resolve, 50));

        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      worker.stop();

      // All three should have been executed
      expect(mockClaudeClient.run).toHaveBeenCalledTimes(3);
    });

    test('respects maxConcurrent limit', async () => {
      // Create 6 conversations but maxConcurrent is 3
      const batch1 = [
        createMockConversation('conv-1'),
        createMockConversation('conv-2'),
        createMockConversation('conv-3'),
        createMockConversation('conv-4'),
        createMockConversation('conv-5'),
      ];

      let pollCount = 0;
      mockDb.getReadyConversations = mock((limit: number) => {
        pollCount++;
        if (pollCount === 1) {
          // First poll returns up to limit (which should be maxConcurrent - activeCount = 3)
          return Promise.resolve(batch1.slice(0, limit));
        }
        return Promise.resolve([]);
      });

      // Slow execution to keep conversations active
      mockClaudeClient.run = mock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that limit was requested correctly
      const firstCall = mockDb.getReadyConversations.mock.calls[0];
      expect(firstCall[0]).toBe(3); // maxConcurrent

      await new Promise((resolve) => setTimeout(resolve, 300));
      worker.stop();
    });

    test('skips poll when at max capacity', async () => {
      const slowConversations = [
        createMockConversation('conv-slow-1'),
        createMockConversation('conv-slow-2'),
        createMockConversation('conv-slow-3'),
      ];

      let pollCount = 0;
      mockDb.getReadyConversations = mock((limit: number) => {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(slowConversations);
        }
        return Promise.resolve([]);
      });

      // Very slow execution
      mockClaudeClient.run = mock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Second poll should skip because we're at capacity
      // (logged as "At max concurrent")

      await new Promise((resolve) => setTimeout(resolve, 500));
      worker.stop();
    });
  });

  describe('concurrent state management', () => {
    test('tracks active count correctly', async () => {
      const conversations = [
        createMockConversation('conv-1'),
        createMockConversation('conv-2'),
      ];

      let returnsConversations = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConversations) {
          returnsConversations = false;
          return Promise.resolve(conversations);
        }
        return Promise.resolve([]);
      });

      // Track concurrent executions
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockClaudeClient.run = mock(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        await new Promise((resolve) => setTimeout(resolve, 100));

        currentConcurrent--;
        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      worker.stop();

      // Both conversations should have run concurrently
      expect(maxConcurrent).toBe(2);
      // At the end, no concurrent executions
      expect(currentConcurrent).toBe(0);
    });

    test('each conversation updates independently', async () => {
      const conversations = [
        createMockConversation('conv-1', { stateData: { value: 1 } }),
        createMockConversation('conv-2', { stateData: { value: 2 } }),
      ];

      let returnsConversations = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConversations) {
          returnsConversations = false;
          return Promise.resolve(conversations);
        }
        return Promise.resolve([]);
      });

      mockClaudeClient.run = mock(async (options: { prompt: string }) => {
        // Extract value from prompt and increment it
        const match = options.prompt.match(/"value":\s*(\d+)/);
        const value = match ? parseInt(match[1]) : 0;

        return {
          response: JSON.stringify({
            complete: true,
            message: `Updated value to ${value + 10}`,
          }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      worker.stop();

      // Each conversation should have been updated
      expect(mockDb.updateConversation).toHaveBeenCalledTimes(2);

      // Verify updates were for different conversations
      const updateCalls = mockDb.updateConversation.mock.calls;
      const updatedIds = updateCalls.map((call) => call[0]);
      expect(updatedIds).toContain('conv-1');
      expect(updatedIds).toContain('conv-2');
    });
  });

  describe('error isolation', () => {
    test('one failing conversation does not affect others', async () => {
      const conversations = [
        createMockConversation('conv-fail'),
        createMockConversation('conv-success'),
      ];

      let returnsConversations = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConversations) {
          returnsConversations = false;
          return Promise.resolve(conversations);
        }
        return Promise.resolve([]);
      });

      mockClaudeClient.run = mock(async (options: { prompt: string }) => {
        if (options.prompt.includes('conv-fail')) {
          throw new Error('Simulated failure');
        }
        return {
          response: JSON.stringify({ complete: true, message: 'Success!' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      worker.stop();

      // Both should have update calls (one for error, one for success)
      expect(mockDb.updateConversation).toHaveBeenCalledTimes(2);

      // Find the successful conversation's update
      const updateCalls = mockDb.updateConversation.mock.calls;
      const successUpdate = updateCalls.find((call) => call[0] === 'conv-success');
      expect(successUpdate).toBeDefined();
      if (successUpdate) {
        expect(successUpdate[1].status).toBe('active'); // completed
      }
    });

    test('failed conversation increments failure count', async () => {
      const failingConversation = createMockConversation('conv-fail', {
        consecutiveFailures: '1',
      });

      let returnsConversations = true;
      mockDb.getReadyConversations = mock(() => {
        if (returnsConversations) {
          returnsConversations = false;
          return Promise.resolve([failingConversation]);
        }
        return Promise.resolve([]);
      });

      mockClaudeClient.run = mock(async () => {
        throw new Error('Execution failed');
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      worker.stop();

      const updateCalls = mockDb.updateConversation.mock.calls;
      expect(updateCalls.length).toBeGreaterThan(0);
      const lastUpdate = updateCalls[updateCalls.length - 1][1];
      expect(lastUpdate.consecutiveFailures).toBe('2'); // 1 + 1
    });
  });

  describe('batch processing', () => {
    test('processes conversations as capacity becomes available', async () => {
      // First batch of 3
      const batch1 = [
        createMockConversation('conv-1'),
        createMockConversation('conv-2'),
        createMockConversation('conv-3'),
      ];
      // Second batch of 2
      const batch2 = [
        createMockConversation('conv-4'),
        createMockConversation('conv-5'),
      ];

      let pollCount = 0;
      mockDb.getReadyConversations = mock((limit: number) => {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(batch1);
        } else if (pollCount === 2 || pollCount === 3) {
          // Return remaining after first batch completes
          return Promise.resolve(batch2.slice(0, limit));
        }
        return Promise.resolve([]);
      });

      let completedCount = 0;
      mockClaudeClient.run = mock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        completedCount++;
        return {
          response: JSON.stringify({ complete: true, message: 'Done' }),
          sessionId: 'session-new',
        };
      });

      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      worker.stop();

      // All conversations should eventually be processed
      expect(completedCount).toBeGreaterThanOrEqual(3);
    });
  });
});
