import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseSSEOptions<T> {
  onMessage?: (event: T) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
  parseEvent?: (event: MessageEvent) => T | null;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  baseReconnectDelay?: number;
}

interface UseSSEReturn {
  status: ConnectionStatus;
  connect: (url: string, options?: RequestInit) => void;
  disconnect: () => void;
  error: Error | null;
}

export function useSSE<T = unknown>(options: UseSSEOptions<T> = {}): UseSSEReturn {
  const {
    onMessage,
    onError,
    onOpen,
    onClose,
    parseEvent,
    reconnect = false,
    maxReconnectAttempts = 5,
    baseReconnectDelay = 1000,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef<string | null>(null);
  const requestOptionsRef = useRef<RequestInit | undefined>(undefined);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    reconnectAttemptsRef.current = 0;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus('disconnected');
    onClose?.();
  }, [clearReconnectTimeout, onClose]);

  const connect = useCallback((url: string, requestOptions?: RequestInit) => {
    // Store for potential reconnection
    urlRef.current = url;
    requestOptionsRef.current = requestOptions;

    // Disconnect existing connection
    if (eventSourceRef.current || abortControllerRef.current) {
      disconnect();
    }

    setStatus('connecting');
    setError(null);

    // For POST requests with body, we need to use fetch with streaming
    if (requestOptions?.method === 'POST') {
      abortControllerRef.current = new AbortController();

      fetch(url, {
        ...requestOptions,
        signal: abortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...requestOptions.headers,
        },
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('Response body is null');
          }

          setStatus('connected');
          reconnectAttemptsRef.current = 0;
          onOpen?.();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    continue;
                  }

                  try {
                    const parsed = JSON.parse(data);
                    if (parseEvent) {
                      const event = parseEvent({ data } as MessageEvent);
                      if (event) onMessage?.(event);
                    } else {
                      onMessage?.(parsed as T);
                    }
                  } catch {
                    // Not JSON, pass raw data
                    onMessage?.(data as T);
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          setStatus('disconnected');
          onClose?.();
        })
        .catch((err) => {
          if (err.name === 'AbortError') {
            return;
          }

          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setStatus('error');
          onError?.(error);

          // Attempt reconnection with exponential backoff
          if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
            reconnectAttemptsRef.current++;

            reconnectTimeoutRef.current = setTimeout(() => {
              if (urlRef.current) {
                connect(urlRef.current, requestOptionsRef.current);
              }
            }, delay);
          }
        });
    } else {
      // For GET requests, use native EventSource
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        onOpen?.();
      };

      eventSource.onmessage = (event) => {
        if (parseEvent) {
          const parsed = parseEvent(event);
          if (parsed) onMessage?.(parsed);
        } else {
          try {
            onMessage?.(JSON.parse(event.data) as T);
          } catch {
            onMessage?.(event.data as T);
          }
        }
      };

      eventSource.onerror = () => {
        const error = new Error('EventSource connection error');
        setError(error);
        setStatus('error');
        onError?.(error);

        eventSource.close();
        eventSourceRef.current = null;

        // Attempt reconnection with exponential backoff
        if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            if (urlRef.current) {
              connect(urlRef.current, requestOptionsRef.current);
            }
          }, delay);
        }
      };
    }
  }, [
    disconnect,
    onMessage,
    onError,
    onOpen,
    onClose,
    parseEvent,
    reconnect,
    maxReconnectAttempts,
    baseReconnectDelay,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    error,
  };
}
