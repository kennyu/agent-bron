import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useChats } from '@/hooks/useChats';
import { ChatList } from './ChatList';
import { NewChatButton } from './NewChatButton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ChatsPanel() {
  const { state, dispatch } = useApp();
  const { chats, isLoading, createChat, deleteChat } = useChats();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleNewChat = async () => {
    await createChat();
  };

  const handleDeleteRequest = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmId) {
      await deleteChat(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  const togglePanel = () => {
    dispatch({ type: 'TOGGLE_CHATS_PANEL' });
  };

  if (state.chatsPanelCollapsed) {
    return (
      <div className="w-12 border-r border-border flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePanel}
          title="Expand chats panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Button>
        <div className="mt-4 [writing-mode:vertical-rl] text-xs text-muted-foreground">
          Chats ({chats.length})
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-border flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm">Chats</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={togglePanel}
          title="Collapse panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Button>
      </div>

      {/* New Chat Button */}
      <div className="p-3 border-b border-border">
        <NewChatButton onClick={handleNewChat} disabled={isLoading} />
      </div>

      {/* Chat List */}
      <ChatList chats={chats} isLoading={isLoading} onDelete={handleDeleteRequest} />

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-4 m-4 shadow-lg max-w-xs">
            <h3 className="font-semibold mb-2">Delete Chat?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This action cannot be undone. All messages will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={handleDeleteCancel}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
