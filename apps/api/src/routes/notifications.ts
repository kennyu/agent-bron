/**
 * Notifications API Routes
 *
 * Handles notification retrieval and marking as read.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

// Types for Hono context
interface Env {
  Variables: {
    userId: string;
    db: DatabaseConnection;
  };
}

interface DatabaseConnection {
  getNotifications(userId: string, options?: { unreadOnly?: boolean }): Promise<NotificationRecord[]>;
  getNotification(id: string): Promise<NotificationRecord | null>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
  deleteNotification(id: string): Promise<void>;
}

interface NotificationRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  title: string;
  body: string;
  isRead: string;
  createdAt: Date;
}

/**
 * Create notification routes
 */
export function createNotificationRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * GET /notifications - Get user's notifications
   */
  app.get('/', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');

    // Check for unread-only filter
    const unreadOnly = c.req.query('unread') === 'true';

    const notifications = await db.getNotifications(userId, { unreadOnly });

    return c.json({
      notifications: notifications.map(formatNotificationResponse),
    });
  });

  /**
   * GET /notifications/unread/count - Get unread notification count
   */
  app.get('/unread/count', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');

    const notifications = await db.getNotifications(userId, { unreadOnly: true });

    return c.json({
      count: notifications.length,
    });
  });

  /**
   * PATCH /notifications/:id - Mark notification as read
   */
  app.patch(
    '/:id',
    zValidator('json', z.object({
      isRead: z.boolean(),
    })),
    async (c) => {
      const notificationId = c.req.param('id');
      const { isRead } = c.req.valid('json');
      const userId = c.get('userId');
      const db = c.get('db');

      const notification = await db.getNotification(notificationId);

      if (!notification) {
        return c.json({ error: 'Notification not found' }, 404);
      }

      if (notification.userId !== userId) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      if (isRead) {
        await db.markNotificationRead(notificationId);
      }

      const updated = await db.getNotification(notificationId);

      return c.json({
        notification: formatNotificationResponse(updated!),
      });
    }
  );

  /**
   * POST /notifications/mark-all-read - Mark all notifications as read
   */
  app.post('/mark-all-read', async (c) => {
    const userId = c.get('userId');
    const db = c.get('db');

    await db.markAllNotificationsRead(userId);

    return c.json({ success: true });
  });

  /**
   * DELETE /notifications/:id - Delete a notification
   */
  app.delete('/:id', async (c) => {
    const notificationId = c.req.param('id');
    const userId = c.get('userId');
    const db = c.get('db');

    const notification = await db.getNotification(notificationId);

    if (!notification) {
      return c.json({ error: 'Notification not found' }, 404);
    }

    if (notification.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db.deleteNotification(notificationId);

    return c.json({ success: true });
  });

  return app;
}

/**
 * Format notification for API response
 */
function formatNotificationResponse(notification: NotificationRecord) {
  return {
    id: notification.id,
    userId: notification.userId,
    conversationId: notification.conversationId,
    title: notification.title,
    body: notification.body,
    isRead: notification.isRead === 'true',
    createdAt: notification.createdAt,
  };
}
