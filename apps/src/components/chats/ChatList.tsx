import type { Conversation } from '@/types/api';
import { ChatItem } from './ChatItem';

interface ChatListProps {
  chats: Conversation[];
  isLoading: boolean;
  onDelete?: (id: string) => void;
}

export function ChatList({ chats, isLoading, onDelete }: ChatListProps) {
  if (isLoading && chats.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-4 text-center">
        No active chats.
        <br />
        Start a new conversation!
      </div>
    );
  }

  // Sort by most recently updated
  const sortedChats = [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-1 p-2">
        {sortedChats.map((chat) => (
          <div key={chat.id} className="group">
            <ChatItem conversation={chat} onDelete={onDelete} />
          </div>
        ))}
      </div>
    </div>
  );
}
