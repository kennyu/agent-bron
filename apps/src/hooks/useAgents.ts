import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types/api';
import { API_BASE_URL } from '@/config';

const POLL_INTERVAL = 5000; // 5 seconds

interface UseAgentsReturn {
  agents: Conversation[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  pauseAgent: (id: string) => Promise<boolean>;
  resumeAgent: (id: string) => Promise<boolean>;
  cancelAgent: (id: string) => Promise<boolean>;
  runNow: (id: string) => Promise<boolean>;
}

export function useAgents(): UseAgentsReturn {
  const { state, dispatch, backgroundAgents } = useApp();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAgents = useCallback(async () => {
    // Only set loading on first fetch
    if (backgroundAgents.length === 0) {
      setIsLoading(true);
    }
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

      const data = await response.json();
      dispatch({ type: 'SET_CONVERSATIONS', payload: data.conversations });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [state.userId, dispatch, backgroundAgents.length]);

  const pauseAgent = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations/${id}/pause`, {
        method: 'PATCH',
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Optimistic update - refresh to get actual state
      dispatch({ type: 'REFRESH_AGENTS' });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    }
  }, [state.userId, dispatch]);

  const resumeAgent = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations/${id}/resume`, {
        method: 'PATCH',
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      dispatch({ type: 'REFRESH_AGENTS' });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    }
  }, [state.userId, dispatch]);

  const cancelAgent = useCallback(async (id: string): Promise<boolean> => {
    try {
      // Cancel by archiving the conversation
      const response = await fetch(`${API_BASE_URL}/conversations/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': state.userId,
        },
        body: JSON.stringify({ status: 'archived' }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      dispatch({ type: 'REFRESH_ALL' });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    }
  }, [state.userId, dispatch]);

  const runNow = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations/${id}/run-now`, {
        method: 'POST',
        headers: {
          'X-User-ID': state.userId,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      dispatch({ type: 'REFRESH_AGENTS' });
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    }
  }, [state.userId, dispatch]);

  // Set up polling
  useEffect(() => {
    fetchAgents();

    pollIntervalRef.current = setInterval(fetchAgents, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchAgents, state.agentsRefreshTrigger]);

  return {
    agents: backgroundAgents,
    isLoading,
    error,
    refresh: fetchAgents,
    pauseAgent,
    resumeAgent,
    cancelAgent,
    runNow,
  };
}
