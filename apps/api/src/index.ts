/**
 * Agentic Tasks API
 *
 * Main entry point for the Hono API server.
 * Includes conversation routes, notification routes, and background worker.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createConversationRoutes } from './routes/conversations';
import { createNotificationRoutes } from './routes/notifications';
import { createBackgroundWorker, type WorkerConfig } from './worker/background-worker';
import { ChatProcessingService } from './services/chat-processing';
import { createClaudeClient, type ClaudeAgentClient, type MockClaudeClient } from './services/claude-client';

// Environment types
interface Env {
  Variables: {
    userId: string;
    db: DatabaseConnection;
    chatService: ChatProcessingService;
    claudeClient: ClaudeAgentClient | MockClaudeClient;
  };
}

// Database connection interface (to be implemented)
interface DatabaseConnection {
  // Conversation methods
  createConversation(data: { userId: string; title: string; status: string }): Promise<unknown>;
  getConversation(id: string): Promise<unknown>;
  getConversations(userId: string): Promise<unknown[]>;
  getMessages(conversationId: string, limit?: number): Promise<unknown[]>;
  updateConversation(id: string, updates: unknown): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  insertMessage(message: unknown): Promise<unknown>;

  // Notification methods
  getNotifications(userId: string, options?: { unreadOnly?: boolean }): Promise<unknown[]>;
  getNotification(id: string): Promise<unknown>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
  deleteNotification(id: string): Promise<void>;
  createNotification(notification: unknown): Promise<void>;

  // Integration methods
  getUserIntegrations(userId: string): Promise<unknown[]>;

  // Worker methods
  getReadyConversations(limit: number): Promise<unknown[]>;
}

// Claude Code client interface (used by ChatProcessingService and BackgroundWorker)
// The actual implementation is in ./services/claude-client.ts
interface ClaudeCodeClient {
  run(options: {
    prompt: string;
    systemPrompt?: string;
    sessionId?: string;
    mcpConfig?: unknown;
    timeout?: number;
  }): Promise<{
    response: string;
    sessionId: string;
  }>;
}

/**
 * Create the API application
 */
export function createApp(config: {
  db: DatabaseConnection;
  claudeClient: ClaudeAgentClient | MockClaudeClient;
  encryptionKey: Buffer;
}): Hono<Env> {
  const app = new Hono<Env>();

  // Middleware
  app.use('*', logger());
  app.use('*', cors({
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'],
    allowHeaders: ['Content-Type', 'X-User-ID', 'Accept'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));

  // Authentication middleware (placeholder - implement with JWT/API key)
  app.use('*', async (c, next) => {
    // TODO: Implement actual authentication
    // For now, check for X-User-ID header (development only)
    const userId = c.req.header('X-User-ID');

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Set context variables
    c.set('userId', userId);
    c.set('db', config.db as unknown as DatabaseConnection);
    c.set('claudeClient', config.claudeClient);

    // Create chat processing service
    const chatService = new ChatProcessingService({
      db: config.db as unknown as Parameters<typeof ChatProcessingService.prototype.processMessage>[0]['db'],
      claudeClient: config.claudeClient as unknown as Parameters<typeof ChatProcessingService.prototype.processMessage>[0]['claudeClient'],
      encryptionKey: config.encryptionKey,
      maxMessageHistory: 50,
    });
    c.set('chatService', chatService);

    await next();
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Mount routes
  app.route('/conversations', createConversationRoutes());
  app.route('/notifications', createNotificationRoutes());

  // Error handler
  app.onError((err, c) => {
    console.error('API Error:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500
    );
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not Found' }, 404);
  });

  return app;
}

/**
 * Start the server with background worker
 */
export async function startServer(config: {
  port: number;
  db: DatabaseConnection;
  claudeClient: ClaudeAgentClient | MockClaudeClient;
  encryptionKey: Buffer;
  workerConfig?: Partial<WorkerConfig>;
}): Promise<{
  app: Hono<Env>;
  worker: ReturnType<typeof createBackgroundWorker>;
  stop: () => void;
}> {
  // Create API app
  const app = createApp({
    db: config.db,
    claudeClient: config.claudeClient,
    encryptionKey: config.encryptionKey,
  });

  // Create and start background worker
  const worker = createBackgroundWorker({
    db: config.db as unknown as WorkerConfig['db'],
    claudeClient: config.claudeClient as unknown as WorkerConfig['claudeClient'],
    encryptionKey: config.encryptionKey,
    pollIntervalMs: config.workerConfig?.pollIntervalMs ?? 5000,
    maxConcurrent: config.workerConfig?.maxConcurrent ?? 5,
    maxMessagesToInclude: config.workerConfig?.maxMessagesToInclude ?? 20,
    executionTimeoutMs: config.workerConfig?.executionTimeoutMs ?? 300000,
    maxRetries: config.workerConfig?.maxRetries ?? 3,
  });

  worker.start();

  console.log(`Server starting on port ${config.port}`);
  console.log('Background worker started');

  // Return cleanup function
  const stop = () => {
    worker.stop();
    console.log('Server stopped');
  };

  return { app, worker, stop };
}

// Development server startup
if (import.meta.main) {
  // Global error handlers
  process.on('uncaughtException', (error) => {
    console.error('[API] Uncaught exception:', error);
    console.error('[API] Stack:', error.stack);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[API] Unhandled rejection at:', promise);
    console.error('[API] Reason:', reason);
  });

  console.log('[API] Starting server...');
  console.log('[API] Environment:', process.env.NODE_ENV || 'development');
  console.log('[API] Port:', process.env.PORT || '3000 (default)');

  console.log('[API] Loading database module...');
  const { db } = await import('../../../packages/db/src');
  console.log('[API] Database module loaded');

  const { eq, and, lte, isNotNull, sql } = await import('drizzle-orm');
  const { conversations, messages, notifications, userIntegrations } = await import('../../../packages/db/src/schema');
  console.log('[API] Schema loaded');

  // Create database adapter
  const dbAdapter: DatabaseConnection = {
    async createConversation(data) {
      const [conv] = await db.insert(conversations).values({
        userId: data.userId,
        title: data.title,
        status: data.status as 'active',
      }).returning();
      return conv;
    },
    async getConversation(id) {
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
      return conv || null;
    },
    async getConversations(userId) {
      return db.select().from(conversations).where(eq(conversations.userId, userId));
    },
    async getMessages(conversationId, limit = 50) {
      return db.select().from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt)
        .limit(limit);
    },
    async updateConversation(id, updates) {
      await db.update(conversations).set(updates as any).where(eq(conversations.id, id));
    },
    async deleteConversation(id) {
      await db.delete(conversations).where(eq(conversations.id, id));
    },
    async insertMessage(message: any) {
      const [msg] = await db.insert(messages).values(message).returning();
      return msg;
    },
    async getNotifications(userId, options) {
      if (options?.unreadOnly) {
        return db.select().from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 'false')));
      }
      return db.select().from(notifications).where(eq(notifications.userId, userId));
    },
    async getNotification(id) {
      const [notif] = await db.select().from(notifications).where(eq(notifications.id, id));
      return notif || null;
    },
    async markNotificationRead(id) {
      await db.update(notifications).set({ isRead: 'true' }).where(eq(notifications.id, id));
    },
    async markAllNotificationsRead(userId) {
      await db.update(notifications).set({ isRead: 'true' }).where(eq(notifications.userId, userId));
    },
    async deleteNotification(id) {
      await db.delete(notifications).where(eq(notifications.id, id));
    },
    async createNotification(notification: any) {
      await db.insert(notifications).values(notification);
    },
    async getUserIntegrations(userId) {
      return db.select().from(userIntegrations).where(eq(userIntegrations.userId, userId));
    },
    async getReadyConversations(limit) {
      return db.select().from(conversations)
        .where(and(
          isNotNull(conversations.scheduleType),
          eq(conversations.status, 'background'),
          lte(conversations.nextRunAt, new Date())
        ))
        .limit(limit);
    },
  };

  // Create Claude client (uses real SDK if ANTHROPIC_API_KEY is set, otherwise mock)
  console.log('[API] Creating Claude client...');
  console.log('[API] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET (hidden)' : 'NOT SET');
  const claudeClient = createClaudeClient();
  console.log('[API] Claude client created');

  // Encryption key (use a proper key in production)
  console.log('[API] Setting up encryption key...');
  const encryptionKey = Buffer.from(
    process.env.ENCRYPTION_KEY || '0'.repeat(64),
    'hex'
  );

  console.log('[API] Creating Hono app...');
  const app = createApp({
    db: dbAdapter,
    claudeClient,
    encryptionKey,
  });
  console.log('[API] Hono app created');

  // Start background worker
  console.log('[API] Creating background worker...');
  const worker = createBackgroundWorker({
    db: dbAdapter as unknown as WorkerConfig['db'],
    claudeClient: claudeClient as unknown as WorkerConfig['claudeClient'],
    encryptionKey,
    pollIntervalMs: 5000,
    maxConcurrent: 5,
    maxMessagesToInclude: 20,
    executionTimeoutMs: 300000,
    maxRetries: 3,
  });
  worker.start();
  console.log('[API] Background worker started');

  const port = parseInt(process.env.PORT || '3000');

  console.log(`[API] Starting Bun server on port ${port}...`);
  try {
    const server = Bun.serve({
      port,
      fetch: app.fetch,
      idleTimeout: 120, // 2 minutes for SSE streams
    });

    console.log(`[API] Server running at http://localhost:${server.port}`);
    console.log('[API] Background worker polling every 5s');
  } catch (err) {
    console.error('[API] Failed to start server:', err);
    process.exit(1);
  }

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    worker.stop();
    server.stop();
    process.exit(0);
  });
}
