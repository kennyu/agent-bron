import { useApp } from '@/context/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { InputWidget } from './InputWidget';
import { TransitionNotification } from './TransitionNotification';

export function ChatWindow() {
  const { selectedConversation } = useApp();
  const {
    messages,
    isLoading,
    error,
    streamState,
    sendMessage,
    stopStreaming,
    lastTransition,
    clearTransition,
  } = useMessages(selectedConversation?.id ?? null);

  // Handle input widget submission
  const handleWidgetSubmit = (value: string) => {
    sendMessage(value);
  };

  // Show placeholder when no conversation is selected
  if (!selectedConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-4 opacity-50"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-lg mb-1">No conversation selected</p>
        <p className="text-sm">Select a chat or create a new one to get started</p>
      </div>
    );
  }

  const hasWaitingInput = selectedConversation.status === 'waiting_input';
  const pendingQuestion = selectedConversation.state?.pendingQuestion;

  // Get transition message based on type
  const getTransitionMessage = () => {
    if (!lastTransition) return '';
    switch (lastTransition.type) {
      case 'background':
        return `"${lastTransition.title}" is now running as a scheduled task. Check the Agents panel to monitor its progress.`;
      case 'waiting_input':
        return `"${lastTransition.title}" needs your input to continue.`;
      default:
        return `"${lastTransition.title}" status changed to ${lastTransition.type}.`;
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-semibold truncate">
            {selectedConversation.title || 'Untitled Chat'}
          </h2>
          {selectedConversation.status === 'waiting_input' && (
            <span className="text-xs bg-yellow-500/10 text-yellow-600 px-2 py-0.5 rounded-full">
              Waiting for input
            </span>
          )}
          {selectedConversation.status === 'background' && (
            <span className="text-xs bg-purple-500/10 text-purple-600 px-2 py-0.5 rounded-full">
              Background
            </span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          Error: {error.message}
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        streamState={streamState}
        isLoading={isLoading}
      />

      {/* Input Widget for waiting_input status */}
      {hasWaitingInput && pendingQuestion && (
        <div className="px-4 pb-4">
          <InputWidget
            pendingQuestion={pendingQuestion}
            onSubmit={handleWidgetSubmit}
            disabled={streamState.isStreaming}
          />
        </div>
      )}

      {/* Regular Chat Input */}
      {!hasWaitingInput && selectedConversation.status !== 'background' && (
        <ChatInput
          onSend={sendMessage}
          onStop={stopStreaming}
          isStreaming={streamState.isStreaming}
          disabled={isLoading}
        />
      )}

      {/* Background agent message */}
      {selectedConversation.status === 'background' && (
        <div className="px-4 py-3 border-t border-border text-center text-sm text-muted-foreground">
          This conversation is running as a background agent. View it in the Agents panel.
        </div>
      )}

      {/* Transition notification */}
      <TransitionNotification
        show={!!lastTransition}
        message={getTransitionMessage()}
        onDismiss={clearTransition}
      />
    </div>
  );
}
