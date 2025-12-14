import { useState } from 'react';
import type { Conversation } from '@/types/api';
import { AgentControls } from './AgentControls';
import { AgentLogs } from './AgentLogs';
import { cn } from '@/lib/utils';

interface AgentCardProps {
  agent: Conversation;
  onRunNow: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function AgentCard({
  agent,
  onRunNow,
  onPause,
  onResume,
  onCancel,
}: AgentCardProps) {
  const [logsExpanded, setLogsExpanded] = useState(false);

  const scheduleType = agent.schedule?.type || 'immediate';
  const nextRun = agent.nextRunAt
    ? new Date(agent.nextRunAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const currentStep = agent.state?.step || 'unknown';

  // Determine if agent is "paused" (no nextRunAt in the past)
  const isPaused = agent.nextRunAt
    ? new Date(agent.nextRunAt).getTime() > Date.now() + 60000 // More than 1 min in future
    : true;

  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">
            {agent.title || 'Untitled Agent'}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                scheduleType === 'cron'
                  ? 'bg-purple-500/10 text-purple-600'
                  : scheduleType === 'scheduled'
                  ? 'bg-blue-500/10 text-blue-600'
                  : 'bg-green-500/10 text-green-600'
              )}
            >
              {scheduleType}
            </span>
            <span className="text-xs text-muted-foreground">
              Step: {currentStep}
            </span>
          </div>
        </div>

        <AgentControls
          isPaused={isPaused}
          onRunNow={onRunNow}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      </div>

      {/* Schedule info */}
      {agent.schedule && (
        <div className="mt-2 text-xs text-muted-foreground">
          {agent.schedule.type === 'cron' && agent.schedule.cronExpression && (
            <div>Cron: {agent.schedule.cronExpression}</div>
          )}
          {nextRun && <div>Next run: {nextRun}</div>}
        </div>
      )}

      {/* Logs toggle */}
      <button
        onClick={() => setLogsExpanded(!logsExpanded)}
        className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('transition-transform', logsExpanded && 'rotate-90')}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {logsExpanded ? 'Hide logs' : 'Show logs'}
      </button>

      {/* Logs */}
      <AgentLogs conversationId={agent.id} expanded={logsExpanded} />
    </div>
  );
}
