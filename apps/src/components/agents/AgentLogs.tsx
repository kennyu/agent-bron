import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type { Message } from '@/types/api';
import { API_BASE_URL } from '@/config';

interface AgentLogsProps {
  conversationId: string;
  expanded: boolean;
}

export function AgentLogs({ conversationId, expanded }: AgentLogsProps) {
  const { state } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;

    const fetchMessages = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
          headers: {
            'X-User-ID': state.userId,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setMessages(data.messages.slice(-10)); // Show last 10 messages
        }
      } catch {
        // Ignore errors for log fetching
      } finally {
        setIsLoading(false);
      }
    };

    fetchMessages();
  }, [conversationId, expanded, state.userId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!expanded) return null;

  return (
    <div
      ref={scrollRef}
      className="mt-2 bg-muted/50 rounded p-2 max-h-40 overflow-y-auto text-xs font-mono"
    >
      {isLoading && messages.length === 0 && (
        <div className="text-muted-foreground">Loading logs...</div>
      )}

      {messages.length === 0 && !isLoading && (
        <div className="text-muted-foreground">No logs yet</div>
      )}

      {messages.map((message) => (
        <div
          key={message.id}
          className={`mb-1 ${
            message.role === 'user' ? 'text-blue-500' : 'text-foreground'
          }`}
        >
          <span className="opacity-50">
            [{message.role}]
          </span>{' '}
          <span className="break-words">
            {message.content.length > 200
              ? `${message.content.slice(0, 200)}...`
              : message.content}
          </span>
        </div>
      ))}
    </div>
  );
}
