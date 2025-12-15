/**
 * Task API Routes
 *
 * CRUD operations for scheduled tasks.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { TaskStatus, IntervalUnit } from '../../../../packages/shared-types/src';
import { getNextRunTime } from '../services/cron-parser';

// Request validation schemas
const createTaskSchema = z
  .object({
    conversationId: z.string().uuid(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),

    // Interval-based scheduling
    intervalValue: z.number().positive().optional(),
    intervalUnit: z.enum(['seconds', 'minutes', 'hours', 'days']).optional(),

    // Cron-based scheduling
    cronExpression: z.string().optional(),

    // Expiration
    maxRuns: z.number().int().positive().optional(),
    durationSeconds: z.number().positive().optional(),

    // Task context
    taskContext: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => {
      // Either interval or cron must be provided
      const hasInterval = data.intervalValue && data.intervalUnit;
      const hasCron = !!data.cronExpression;
      return hasInterval || hasCron;
    },
    { message: 'Either interval (intervalValue + intervalUnit) or cronExpression must be provided' }
  )
  .refine(
    (data) => {
      // Validate minimum 15 seconds for interval-based
      if (data.intervalValue && data.intervalUnit) {
        const ms = convertToMs(data.intervalValue, data.intervalUnit as IntervalUnit);
        return ms >= 15000;
      }
      return true;
    },
    { message: 'Minimum interval is 15 seconds' }
  );

const updateTaskSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  intervalValue: z.number().positive().optional(),
  intervalUnit: z.enum(['seconds', 'minutes', 'hours', 'days']).optional(),
  cronExpression: z.string().optional(),
  maxRuns: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// Types for Hono context
interface Env {
  Variables: {
    userId: string;
    db: DatabaseConnection;
  };
}

interface DatabaseConnection {
  createTask(data: NewTaskRecord): Promise<TaskRecord>;
  getTask(id: string): Promise<TaskRecord | null>;
  getTasks(userId: string, conversationId?: string): Promise<TaskRecord[]>;
  updateTask(id: string, updates: Partial<TaskRecord>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  getConversation(id: string): Promise<ConversationRecord | null>;
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
  status?: TaskStatus;
  intervalValue?: string;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  nextRunAt?: Date;
  maxRuns?: string;
  expiresAt?: Date;
  taskContext?: Record<string, unknown>;
}

interface ConversationRecord {
  id: string;
  userId: string;
}

/**
 * Convert interval to milliseconds
 */
function convertToMs(value: number, unit: IntervalUnit): number {
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
function calculateNextRunAt(
  intervalValue?: number,
  intervalUnit?: IntervalUnit,
  cronExpression?: string
): Date {
  const now = new Date();

  if (cronExpression) {
    return getNextRunTime(cronExpression);
  }

  if (intervalValue && intervalUnit) {
    const intervalMs = convertToMs(intervalValue, intervalUnit);
    return new Date(now.getTime() + intervalMs);
  }

  return now;
}

/**
 * Create task routes
 */
export function createTaskRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * GET /tasks - List user's tasks
   */
  app.get('/', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const conversationId = c.req.query('conversationId');

    const tasks = await db.getTasks(userId, conversationId);

    // Filter out deleted tasks
    const activeTasks = tasks.filter((t) => t.status !== 'deleted');

    return c.json({
      tasks: activeTasks.map((t) => ({
        id: t.id,
        conversationId: t.conversationId,
        name: t.name,
        description: t.description,
        status: t.status,
        schedule: t.intervalValue && t.intervalUnit
          ? { intervalValue: parseInt(t.intervalValue, 10), intervalUnit: t.intervalUnit }
          : t.cronExpression
          ? { cronExpression: t.cronExpression }
          : null,
        nextRunAt: t.nextRunAt?.toISOString() || null,
        lastRunAt: t.lastRunAt?.toISOString() || null,
        currentRuns: parseInt(t.currentRuns || '0', 10),
        maxRuns: t.maxRuns ? parseInt(t.maxRuns, 10) : null,
        expiresAt: t.expiresAt?.toISOString() || null,
        consecutiveFailures: parseInt(t.consecutiveFailures || '0', 10),
        lastError: t.lastError,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  });

  /**
   * GET /tasks/:id - Get a specific task
   */
  app.get('/:id', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const taskId = c.req.param('id');

    const task = await db.getTask(taskId);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({
      task: {
        id: task.id,
        conversationId: task.conversationId,
        name: task.name,
        description: task.description,
        status: task.status,
        schedule: task.intervalValue && task.intervalUnit
          ? { intervalValue: parseInt(task.intervalValue, 10), intervalUnit: task.intervalUnit }
          : task.cronExpression
          ? { cronExpression: task.cronExpression }
          : null,
        nextRunAt: task.nextRunAt?.toISOString() || null,
        lastRunAt: task.lastRunAt?.toISOString() || null,
        currentRuns: parseInt(task.currentRuns || '0', 10),
        maxRuns: task.maxRuns ? parseInt(task.maxRuns, 10) : null,
        expiresAt: task.expiresAt?.toISOString() || null,
        taskContext: task.taskContext,
        consecutiveFailures: parseInt(task.consecutiveFailures || '0', 10),
        lastError: task.lastError,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
    });
  });

  /**
   * POST /tasks - Create a new task
   */
  app.post('/', zValidator('json', createTaskSchema), async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const body = c.req.valid('json');

    // Verify conversation exists and belongs to user
    const conversation = await db.getConversation(body.conversationId);
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    if (conversation.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Calculate expiresAt from durationSeconds
    let expiresAt: Date | undefined;
    if (body.durationSeconds) {
      expiresAt = new Date(Date.now() + body.durationSeconds * 1000);
    }

    // Calculate initial nextRunAt
    const nextRunAt = calculateNextRunAt(
      body.intervalValue,
      body.intervalUnit as IntervalUnit | undefined,
      body.cronExpression
    );

    const task = await db.createTask({
      conversationId: body.conversationId,
      userId,
      name: body.name,
      description: body.description,
      intervalValue: body.intervalValue?.toString(),
      intervalUnit: body.intervalUnit as IntervalUnit | undefined,
      cronExpression: body.cronExpression,
      nextRunAt,
      maxRuns: body.maxRuns?.toString(),
      expiresAt,
      taskContext: body.taskContext || {},
    });

    return c.json(
      {
        task: {
          id: task.id,
          conversationId: task.conversationId,
          name: task.name,
          description: task.description,
          status: task.status,
          schedule: task.intervalValue && task.intervalUnit
            ? { intervalValue: parseInt(task.intervalValue, 10), intervalUnit: task.intervalUnit }
            : task.cronExpression
            ? { cronExpression: task.cronExpression }
            : null,
          nextRunAt: task.nextRunAt?.toISOString() || null,
          currentRuns: 0,
          maxRuns: task.maxRuns ? parseInt(task.maxRuns, 10) : null,
          expiresAt: task.expiresAt?.toISOString() || null,
          createdAt: task.createdAt.toISOString(),
        },
      },
      201
    );
  });

  /**
   * PATCH /tasks/:id - Update a task
   */
  app.patch('/:id', zValidator('json', updateTaskSchema), async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const taskId = c.req.param('id');
    const body = c.req.valid('json');

    const task = await db.getTask(taskId);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const updates: Partial<TaskRecord> = {
      updatedAt: new Date(),
    };

    if (body.status !== undefined) {
      updates.status = body.status;

      // If resuming, recalculate nextRunAt
      if (body.status === 'active' && task.status === 'paused') {
        updates.nextRunAt = calculateNextRunAt(
          task.intervalValue ? parseInt(task.intervalValue, 10) : undefined,
          task.intervalUnit || undefined,
          task.cronExpression || undefined
        );
        updates.consecutiveFailures = '0';
        updates.lastError = null;
      }

      // If pausing, clear nextRunAt
      if (body.status === 'paused') {
        updates.nextRunAt = null;
      }
    }

    if (body.intervalValue !== undefined && body.intervalUnit !== undefined) {
      // Validate minimum interval
      const ms = convertToMs(body.intervalValue, body.intervalUnit as IntervalUnit);
      if (ms < 15000) {
        return c.json({ error: 'Minimum interval is 15 seconds' }, 400);
      }

      updates.intervalValue = body.intervalValue.toString();
      updates.intervalUnit = body.intervalUnit as IntervalUnit;
      updates.cronExpression = null;

      // Recalculate next run if active
      if (task.status === 'active') {
        updates.nextRunAt = calculateNextRunAt(body.intervalValue, body.intervalUnit as IntervalUnit);
      }
    }

    if (body.cronExpression !== undefined) {
      updates.cronExpression = body.cronExpression;
      updates.intervalValue = null;
      updates.intervalUnit = null;

      // Recalculate next run if active
      if (task.status === 'active') {
        updates.nextRunAt = calculateNextRunAt(undefined, undefined, body.cronExpression);
      }
    }

    if (body.maxRuns !== undefined) {
      updates.maxRuns = body.maxRuns?.toString() || null;
    }

    if (body.expiresAt !== undefined) {
      updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }

    await db.updateTask(taskId, updates);

    const updatedTask = await db.getTask(taskId);

    return c.json({
      task: {
        id: updatedTask!.id,
        conversationId: updatedTask!.conversationId,
        name: updatedTask!.name,
        status: updatedTask!.status,
        nextRunAt: updatedTask!.nextRunAt?.toISOString() || null,
        updatedAt: updatedTask!.updatedAt.toISOString(),
      },
    });
  });

  /**
   * DELETE /tasks/:id - Delete a task (soft delete)
   */
  app.delete('/:id', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const taskId = c.req.param('id');

    const task = await db.getTask(taskId);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Soft delete
    await db.updateTask(taskId, {
      status: 'deleted',
      nextRunAt: null,
      updatedAt: new Date(),
    });

    return c.json({ success: true });
  });

  /**
   * POST /tasks/:id/run-now - Trigger immediate execution
   */
  app.post('/:id/run-now', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');
    const taskId = c.req.param('id');

    const task = await db.getTask(taskId);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (task.status !== 'active' && task.status !== 'paused') {
      return c.json({ error: 'Task cannot be run in its current state' }, 400);
    }

    await db.updateTask(taskId, {
      status: 'active',
      nextRunAt: new Date(),
      updatedAt: new Date(),
    });

    return c.json({ success: true, message: 'Task scheduled for immediate execution' });
  });

  return app;
}
