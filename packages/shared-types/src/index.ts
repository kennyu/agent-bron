// Conversation status types
export type ConversationStatus =
  | 'active'
  | 'background'
  | 'waiting_input'
  | 'archived';

// Schedule types
export type ScheduleType = 'cron' | 'scheduled' | 'immediate';

// Task types
export type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export interface Schedule {
  type: ScheduleType;
  cronExpression?: string;
  runAt?: Date;
}

// Message types
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageSource = 'chat' | 'worker';

// Pending question types
export type PendingQuestionType = 'confirmation' | 'choice' | 'input';

export interface PendingQuestion {
  type: PendingQuestionType;
  prompt: string;
  options?: string[];
}

// Conversation state
export interface ConversationState {
  context: Record<string, unknown>;
  step: string;
  data: Record<string, unknown>;
  pendingQuestion?: PendingQuestion;
}

// Full conversation interface (application-level)
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  schedule?: Schedule;
  nextRunAt?: Date;
  state: ConversationState;
  claudeSessionId?: string;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

// Message interface
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  source: MessageSource;
  createdAt: Date;
}

// User integration interface
export interface UserIntegration {
  id: string;
  userId: string;
  provider: string;
  tokenExpiresAt?: Date;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Notification interface
export interface Notification {
  id: string;
  userId: string;
  conversationId?: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: Date;
}

// Task interface
export interface Task {
  id: string;
  conversationId: string;
  userId: string;
  name: string;
  description?: string;
  status: TaskStatus;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  maxRuns?: number;
  currentRuns: number;
  expiresAt?: Date;
  taskContext: Record<string, unknown>;
  consecutiveFailures: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Request type for creating tasks
export interface CreateTaskRequest {
  name: string;
  description?: string;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  cronExpression?: string;
  maxRuns?: number;
  durationSeconds?: number;
  taskContext?: Record<string, unknown>;
}

// Claude response types for worker

/**
 * Response when Claude needs user input to continue
 */
export interface NeedsInputResponse {
  needs_input: true;
  message: string;
  question: PendingQuestion;
}

/**
 * Response when work should continue in background
 */
export interface ContinueResponse {
  continue: true;
  message?: string;
  state_update?: Record<string, unknown>;
  next_step?: string;
}

/**
 * Response when work is complete
 */
export interface CompleteResponse {
  complete: true;
  message: string;
}

/**
 * Union type for all worker response formats
 */
export type WorkerResponse =
  | NeedsInputResponse
  | ContinueResponse
  | CompleteResponse;

// Claude response types for chat

/**
 * Response when Claude wants to create a schedule
 */
export interface CreateScheduleResponse {
  create_schedule: {
    type: ScheduleType;
    cron_expression?: string;
    run_at?: string;
    initial_state?: {
      context: Record<string, unknown>;
      step: string;
      data?: Record<string, unknown>;
    };
  };
  message: string;
}

/**
 * Response when Claude needs input during chat
 */
export interface ChatNeedsInputResponse {
  needs_input: PendingQuestion;
  message: string;
}

/**
 * Response when Claude wants to update state without scheduling
 */
export interface StateUpdateResponse {
  state_update: Record<string, unknown>;
  message: string;
}

/**
 * Union type for chat response formats
 */
export type ChatResponse =
  | CreateScheduleResponse
  | ChatNeedsInputResponse
  | StateUpdateResponse
  | CreateTaskResponse
  | DeleteTaskResponse
  | { message: string }; // Plain response

/**
 * Response when Claude wants to create a scheduled task
 */
export interface CreateTaskResponse {
  create_task: CreateTaskRequest;
  message: string;
}

/**
 * Response when Claude wants to delete a task
 */
export interface DeleteTaskResponse {
  delete_task: {
    taskId?: string;
    taskName?: string;
  };
  message: string;
}

// API request/response types

export interface CreateConversationRequest {
  title?: string;
}

export interface CreateConversationResponse {
  conversation: Conversation;
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  message: Message;
  assistantMessage: Message;
  conversationUpdated: boolean;
}

export interface GetConversationResponse {
  conversation: Conversation;
  messages: Message[];
}

export interface GetNotificationsResponse {
  notifications: Notification[];
}

export interface MarkNotificationReadResponse {
  notification: Notification;
}

// MCP configuration types

export interface MCPServerConfig {
  provider: string;
  serverPath: string;
  args?: string[];
  env?: Record<string, string>;
}

// Skill system types

/**
 * MCP server configuration for skills (simplified format)
 */
export interface SkillMCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Agent definition for nested subagents within a skill
 */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
}

/**
 * Skill definition - bundles tools, MCP servers, and subagents
 */
export interface Skill {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
  mcpServers?: Record<string, SkillMCPServerConfig>;
  subagents?: Record<string, AgentDefinition>;
}

/**
 * Merged configuration from multiple skills
 */
export interface MergedSkillConfig {
  tools: string[];
  mcpServers: Record<string, SkillMCPServerConfig>;
  subagents: Record<string, AgentDefinition>;
  systemPromptAdditions: string;
}

/**
 * API response for skill listing
 */
export interface SkillResponse {
  name: string;
  description: string;
  tools: string[];
  hasMcpServers: boolean;
  hasSubagents: boolean;
}

export interface UserMCPConfig {
  servers: MCPServerConfig[];
}

// Type guards

export function isNeedsInputResponse(
  response: unknown
): response is NeedsInputResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'needs_input' in response &&
    (response as NeedsInputResponse).needs_input === true
  );
}

export function isContinueResponse(
  response: unknown
): response is ContinueResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'continue' in response &&
    (response as ContinueResponse).continue === true
  );
}

export function isCompleteResponse(
  response: unknown
): response is CompleteResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'complete' in response &&
    (response as CompleteResponse).complete === true
  );
}

export function isCreateScheduleResponse(
  response: unknown
): response is CreateScheduleResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'create_schedule' in response
  );
}

export function isChatNeedsInputResponse(
  response: unknown
): response is ChatNeedsInputResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'needs_input' in response &&
    typeof (response as ChatNeedsInputResponse).needs_input === 'object'
  );
}

export function isStateUpdateResponse(
  response: unknown
): response is StateUpdateResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'state_update' in response
  );
}

export function isCreateTaskResponse(
  response: unknown
): response is CreateTaskResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'create_task' in response &&
    typeof (response as CreateTaskResponse).create_task === 'object'
  );
}

export function isDeleteTaskResponse(
  response: unknown
): response is DeleteTaskResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'delete_task' in response &&
    typeof (response as DeleteTaskResponse).delete_task === 'object'
  );
}
