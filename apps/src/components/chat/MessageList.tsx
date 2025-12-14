import { useEffect, useRef } from 'react';
import type { Message } from '@/types/api';
import { MessageBubble } from './MessageBubble';
import { StreamingText } from './StreamingText';
import { ToolIndicator } from './ToolIndicator';

interface StreamState {
  isStreaming: boolean;
  streamedContent: string;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  toolResults: Array<{ toolUseId: string; content: unknown }>;
}

interface MessageListProps {
  messages: Message[];
  streamState: StreamState;
  isLoading: boolean;
}

export function MessageList({ messages, streamState, isLoading }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamState.streamedContent, streamState.toolUses]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    autoScrollRef.current = isAtBottom;
  };

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0 && !streamState.isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-center px-8">
        <div>
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">Send a message to begin chatting with the assistant.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {/* Show tool usage indicator during streaming */}
      {streamState.isStreaming && streamState.toolUses.length > 0 && (
        <ToolIndicator
          toolUses={streamState.toolUses}
          toolResults={streamState.toolResults}
        />
      )}

      {/* Show streaming text during streaming */}
      {streamState.isStreaming && streamState.streamedContent && (
        <StreamingText content={streamState.streamedContent} />
      )}

      {/* Show loading indicator when streaming but no content yet */}
      {streamState.isStreaming && !streamState.streamedContent && streamState.toolUses.length === 0 && (
        <div className="flex justify-start mb-4">
          <div className="bg-muted rounded-lg px-4 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
