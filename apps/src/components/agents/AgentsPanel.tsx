import { useApp } from '@/context/AppContext';
import { useAgents } from '@/hooks/useAgents';
import { AgentCard } from './AgentCard';
import { Button } from '@/components/ui/button';

export function AgentsPanel() {
  const { state, dispatch } = useApp();
  const {
    agents,
    isLoading,
    error,
    pauseAgent,
    resumeAgent,
    cancelAgent,
    runNow,
  } = useAgents();

  const togglePanel = () => {
    dispatch({ type: 'TOGGLE_AGENTS_PANEL' });
  };

  if (state.agentsPanelCollapsed) {
    return (
      <div className="w-12 border-l border-border flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePanel}
          title="Expand agents panel"
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
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Button>
        <div className="mt-4 [writing-mode:vertical-rl] text-xs text-muted-foreground">
          Agents ({agents.length})
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">Background Agents</h2>
          {agents.length > 0 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">
              {agents.length}
            </span>
          )}
        </div>
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
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Button>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs">
          {error.message}
        </div>
      )}

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && agents.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading agents...
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8 px-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto mb-3 opacity-50"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <p>No background agents</p>
            <p className="text-xs mt-1 opacity-70">
              Schedule a task from a chat to create an agent
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onRunNow={() => runNow(agent.id)}
                onPause={() => pauseAgent(agent.id)}
                onResume={() => resumeAgent(agent.id)}
                onCancel={() => cancelAgent(agent.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with refresh indicator */}
      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground text-center">
        Auto-refreshing every 5s
      </div>
    </div>
  );
}
