import { Button } from '@/components/ui/button';

interface AgentControlsProps {
  isPaused?: boolean;
  onRunNow: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function AgentControls({
  isPaused,
  onRunNow,
  onPause,
  onResume,
  onCancel,
  disabled,
}: AgentControlsProps) {
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRunNow}
        disabled={disabled}
        title="Run now"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </Button>

      {isPaused ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onResume}
          disabled={disabled}
          title="Resume"
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
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPause}
          disabled={disabled}
          title="Pause"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCancel}
        disabled={disabled}
        title="Cancel"
        className="hover:text-destructive"
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
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </Button>
    </div>
  );
}
