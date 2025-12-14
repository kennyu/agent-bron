// Conversation status types
export type ConversationStatus = 'active' | 'archived' | 'background' | 'waiting_input';

// Schedule types
export type ScheduleType = 'cron' | 'scheduled' | 'immediate';

export interface Schedule {
  type: ScheduleType;
  cronExpression?: string;
  runAt?: string;
}

// Pending question types for waiting_input status
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
  pendingQuestion: PendingQuestion | null;
}

// Conversation object
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  schedule: Schedule | null;
  nextRunAt: string | null;
  state: ConversationState;
  createdAt: string;
  updatedAt: string;
}

// Message types
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageSource = 'chat' | 'worker';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  source: MessageSource;
  createdAt: string;
}

// API Response types
export interface ConversationsListResponse {
  conversations: Conversation[];
}

export interface ConversationResponse {
  conversation: Conversation;
}

export interface ConversationWithMessagesResponse {
  conversation: Conversation;
  messages: Message[];
}

export interface SendMessageResponse {
  message: Message;
  assistantMessage: Message;
  conversationUpdated: boolean;
  newStatus?: ConversationStatus;
}

// SSE Event types for streaming
export type SSEEventType =
  | 'user_message'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'message_saved'
  | 'error';

export interface SSEUserMessageEvent {
  type: 'user_message';
  data: Message;
}

export interface SSEAssistantEvent {
  type: 'assistant';
  data: string;
}

export interface SSEToolUseEvent {
  type: 'tool_use';
  data: {
    id: string;
    name: string;
    input: unknown;
  };
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  data: {
    toolUseId: string;
    content: unknown;
  };
}

export interface SSEMessageSavedEvent {
  type: 'message_saved';
  data: {
    message: Message;
    conversationUpdated: boolean;
    newStatus?: ConversationStatus;
  };
}

export interface SSEErrorEvent {
  type: 'error';
  data: {
    error: string;
  };
}

export type SSEEvent =
  | SSEUserMessageEvent
  | SSEAssistantEvent
  | SSEToolUseEvent
  | SSEToolResultEvent
  | SSEMessageSavedEvent
  | SSEErrorEvent;

// Notification types
export interface Notification {
  id: string;
  userId: string;
  conversationId: string | null;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsListResponse {
  notifications: Notification[];
}

export interface UnreadCountResponse {
  count: number;
}
