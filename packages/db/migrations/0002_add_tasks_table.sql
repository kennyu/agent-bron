-- Create task_status enum
CREATE TYPE "task_status" AS ENUM ('active', 'paused', 'completed', 'deleted');

-- Create interval_unit enum
CREATE TYPE "interval_unit" AS ENUM ('seconds', 'minutes', 'hours', 'days');

-- Create tasks table
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,

  -- Task identity
  "name" text NOT NULL,
  "description" text,

  -- Status
  "status" "task_status" NOT NULL DEFAULT 'active',

  -- Interval-based scheduling
  "interval_value" text,
  "interval_unit" "interval_unit",

  -- Cron-based scheduling (alternative)
  "cron_expression" text,

  -- Execution timing
  "next_run_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,

  -- Expiration limits
  "max_runs" text,
  "current_runs" text DEFAULT '0',
  "expires_at" timestamp with time zone,

  -- Task context
  "task_context" jsonb,

  -- Error tracking
  "consecutive_failures" text DEFAULT '0',
  "last_error" text,

  -- Timestamps
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_tasks_worker_query" ON "tasks" ("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "idx_tasks_conversation_id" ON "tasks" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_tasks_user_id" ON "tasks" ("user_id");
