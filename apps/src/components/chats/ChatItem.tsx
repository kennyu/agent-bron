import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types/api';
import { cn } from '@/lib/utils';

interface ChatItemProps {
  conversation: Conversation;
  onDelete?: (id: string) => void;
}

export function ChatItem({ conversation, onDelete }: ChatItemProps) {
  const { state, dispatch } = useApp();
  const isSelected = state.selectedConversationId === conversation.id;

  const handleClick = () => {
    dispatch({ type: 'SELECT_CONVERSATION', payload: conversation.id });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(conversation.id);
  };

  const statusIcon = conversation.status === 'waiting_input' ? (
    <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Waiting for input" />
  ) : (
    <span className="w-2 h-2 rounded-full bg-green-500" title="Active" />
  );

  const formattedDate = new Date(conversation.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      onClick={handleClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer rounded-md transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent'
      )}
    >
      {statusIcon}

      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">
          {conversation.title || 'Untitled Chat'}
        </div>
        <div className="text-xs text-muted-foreground">
          {formattedDate}
        </div>
      </div>

      <button
        onClick={handleDelete}
        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
        title="Delete chat"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}
