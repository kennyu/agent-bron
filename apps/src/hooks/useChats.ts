import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type { Conversation, ConversationsListResponse } from '@/types/api';
import { API_BASE_URL } from '@/config';

interface UseChatsReturn {
  chats: Conversation[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  createChat: (title?: string) => Promise<Conversation | null>;
  deleteChat: (id: string) => Promise<boolean>;
}

export function useChats(): UseChatsReturn {
  const { state, dispatch, interactiveChats } = useApp();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/conversations`, {
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ConversationsListResponse = await response.json();
      dispatch({ type: 'SET_CONVERSATIONS', payload: data.conversations });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [state.userId, dispatch]);

  const createChat = useCallback(async (title?: string): Promise<Conversation | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': state.userId,
        },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const conversation = data.conversation as Conversation;
      dispatch({ type: 'ADD_CONVERSATION', payload: conversation });
      dispatch({ type: 'SELECT_CONVERSATION', payload: conversation.id });
      return conversation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return null;
    }
  }, [state.userId, dispatch]);

  const deleteChat = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/conversations/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      dispatch({ type: 'REMOVE_CONVERSATION', payload: id });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    }
  }, [state.userId, dispatch]);

  // Fetch on mount and when refresh trigger changes
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, state.chatsRefreshTrigger]);

  return {
    chats: interactiveChats,
    isLoading,
    error,
    refresh: fetchConversations,
    createChat,
    deleteChat,
  };
}
