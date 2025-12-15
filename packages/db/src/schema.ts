import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

// Conversation status enum
export const conversationStatusEnum = pgEnum('conversation_status', [
  'active',
  'background',
  'waiting_input',
  'archived',
]);

// Schedule type enum
export const scheduleTypeEnum = pgEnum('schedule_type', [
  'cron',
  'scheduled',
  'immediate',
]);

// Message role enum
export const messageRoleEnum = pgEnum('message_role', [
  'user',
  'assistant',
  'system',
]);

// Message source enum
export const messageSourceEnum = pgEnum('message_source', ['chat', 'worker']);

// Task status enum
export const taskStatusEnum = pgEnum('task_status', [
  'active',
  'paused',
  'completed',
  'deleted',
]);

// Interval unit enum
export const intervalUnitEnum = pgEnum('interval_unit', [
  'seconds',
  'minutes',
  'hours',
  'days',
]);

// Pending question type enum
export const pendingQuestionTypeEnum = pgEnum('pending_question_type', [
  'confirmation',
  'choice',
  'input',
]);

// Conversations table
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    title: text('title').notNull().default('New Conversation'),
    status: conversationStatusEnum('status').notNull().default('active'),

    // Scheduling
    scheduleType: scheduleTypeEnum('schedule_type'),
    cronExpression: text('cron_expression'),
    scheduledRunAt: timestamp('scheduled_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),

    // State for background work
    stateContext: jsonb('state_context').$type<Record<string, unknown>>(),
    stateStep: text('state_step'),
    stateData: jsonb('state_data').$type<Record<string, unknown>>(),

    // Pending question (when waiting_input)
    pendingQuestionType: pendingQuestionTypeEnum('pending_question_type'),
    pendingQuestionPrompt: text('pending_question_prompt'),
    pendingQuestionOptions: jsonb('pending_question_options').$type<string[]>(),

    // Claude session resumption
    claudeSessionId: text('claude_session_id'),

    // Skills to activate for this conversation
    skills: jsonb('skills').$type<string[]>(),

    // Error tracking
    consecutiveFailures: text('consecutive_failures').default('0'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Index for worker query: status + schedule + next_run_at
    index('idx_conversations_worker_query').on(
      table.status,
      table.scheduleType,
      table.nextRunAt
    ),
    // Index for user's conversations
    index('idx_conversations_user_id').on(table.userId),
  ]
);

// Messages table
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    source: messageSourceEnum('source').notNull().default('chat'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Index for fetching messages by conversation
    index('idx_messages_conversation_id').on(table.conversationId),
  ]
);

// User integrations table (MCP OAuth credentials)
export const userIntegrations = pgTable(
  'user_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    provider: text('provider').notNull(), // 'gmail', 'google_photos', 'slack', etc.

    // Encrypted OAuth credentials
    encryptedAccessToken: text('encrypted_access_token'),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

    // Provider-specific metadata (e.g., email address for Gmail)
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Status
    isActive: text('is_active').notNull().default('true'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Index for fetching user's integrations
    index('idx_user_integrations_user_id').on(table.userId),
    // Unique constraint: one integration per provider per user
    index('idx_user_integrations_user_provider').on(table.userId, table.provider),
  ]
);

// Notifications table
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),

    title: text('title').notNull(),
    body: text('body').notNull(),

    // Whether the user has seen/read this notification
    isRead: text('is_read').notNull().default('false'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Index for fetching user's notifications
    index('idx_notifications_user_id').on(table.userId),
    // Index for unread notifications
    index('idx_notifications_user_unread').on(table.userId, table.isRead),
  ]
);

// Tasks table
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),

    // Task identity
    name: text('name').notNull(),
    description: text('description'),

    // Status
    status: taskStatusEnum('status').notNull().default('active'),

    // Interval-based scheduling
    intervalValue: text('interval_value'),
    intervalUnit: intervalUnitEnum('interval_unit'),

    // Cron-based scheduling (alternative)
    cronExpression: text('cron_expression'),

    // Execution timing
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    // Expiration limits
    maxRuns: text('max_runs'),
    currentRuns: text('current_runs').default('0'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Task context
    taskContext: jsonb('task_context').$type<Record<string, unknown>>(),

    // Error tracking
    consecutiveFailures: text('consecutive_failures').default('0'),
    lastError: text('last_error'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Index for worker query: status + next_run_at
    index('idx_tasks_worker_query').on(table.status, table.nextRunAt),
    // Index for conversation's tasks
    index('idx_tasks_conversation_id').on(table.conversationId),
    // Index for user's tasks
    index('idx_tasks_user_id').on(table.userId),
  ]
);

// Type exports for use in application code
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
