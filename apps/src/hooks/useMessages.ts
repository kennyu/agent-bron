import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type {
  Message,
  ConversationWithMessagesResponse,
  SSEEvent,
  ConversationStatus,
} from '@/types/api';
import { API_BASE_URL } from '@/config';

interface StreamState {
  isStreaming: boolean;
  streamedContent: string;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  toolResults: Array<{ toolUseId: string; content: unknown }>;
}

interface UseMessagesReturn {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  streamState: StreamState;
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  refresh: () => Promise<void>;
  lastTransition: { type: ConversationStatus; title: string } | null;
  clearTransition: () => void;
}

export function useMessages(conversationId: string | null): UseMessagesReturn {
  const { state, dispatch, selectedConversation } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [streamState, setStreamState] = useState<StreamState>({
    isStreaming: false,
    streamedContent: '',
    toolUses: [],
    toolResults: [],
  });
  const [lastTransition, setLastTransition] = useState<{ type: ConversationStatus; title: string } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const clearTransition = useCallback(() => {
    setLastTransition(null);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ConversationWithMessagesResponse = await response.json();
      setMessages(data.messages);

      // Update conversation in global state
      dispatch({ type: 'UPDATE_CONVERSATION', payload: data.conversation });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, state.userId, dispatch]);

  const sendMessage = useCallback(async (content: string) => {
    if (!conversationId || !content.trim()) return;

    setError(null);
    setStreamState({
      isStreaming: true,
      streamedContent: '',
      toolUses: [],
      toolResults: [],
    });

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(
        `${API_BASE_URL}/conversations/${conversationId}/messages/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'X-User-ID': state.userId,
          },
          body: JSON.stringify({ content }),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as SSEEvent;
              handleSSEEvent(event);
            } catch {
              // Not valid JSON, skip
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled, don't treat as error
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setStreamState((prev) => ({ ...prev, isStreaming: false }));
      abortControllerRef.current = null;
    }
  }, [conversationId, state.userId]);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'user_message':
        setMessages((prev) => [...prev, event.data]);
        break;

      case 'assistant':
        setStreamState((prev) => ({
          ...prev,
          streamedContent: prev.streamedContent + event.data,
        }));
        break;

      case 'tool_use':
        setStreamState((prev) => ({
          ...prev,
          toolUses: [...prev.toolUses, event.data],
        }));
        break;

      case 'tool_result':
        setStreamState((prev) => ({
          ...prev,
          toolResults: [...prev.toolResults, event.data],
        }));
        break;

      case 'message_saved':
        // Add the complete assistant message
        setMessages((prev) => [...prev, event.data.message]);
        // Clear streamed content since we now have the complete message
        setStreamState((prev) => ({
          ...prev,
          streamedContent: '',
          toolUses: [],
          toolResults: [],
        }));

        // Handle conversation status changes
        if (event.data.conversationUpdated && event.data.newStatus) {
          // Show transition notification
          setLastTransition({
            type: event.data.newStatus,
            title: selectedConversation?.title || 'Conversation',
          });
          dispatch({ type: 'REFRESH_ALL' });
        }
        break;

      case 'error':
        setError(new Error(event.data.error));
        break;
    }
  }, [dispatch]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreamState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  // Fetch messages when conversation changes
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    messages,
    isLoading,
    error,
    streamState,
    sendMessage,
    stopStreaming,
    refresh: fetchMessages,
    lastTransition,
    clearTransition,
  };
}
