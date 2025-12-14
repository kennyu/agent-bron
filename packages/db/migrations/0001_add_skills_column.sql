-- Add skills column to conversations table
ALTER TABLE "conversations" ADD COLUMN "skills" jsonb;
