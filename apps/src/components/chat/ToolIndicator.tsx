import { cn } from '@/lib/utils';

interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResult {
  toolUseId: string;
  content: unknown;
}

interface ToolIndicatorProps {
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  className?: string;
}

export function ToolIndicator({ toolUses, toolResults, className }: ToolIndicatorProps) {
  if (toolUses.length === 0) return null;

  return (
    <div className={cn('flex justify-start mb-4', className)}>
      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted/50 border border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
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
            className="animate-spin"
          >
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m4.9 4.9 2.9 2.9" />
          </svg>
          <span>Using tools...</span>
        </div>
        <div className="space-y-1">
          {toolUses.map((tool) => {
            const hasResult = toolResults.some((r) => r.toolUseId === tool.id);
            return (
              <div
                key={tool.id}
                className={cn(
                  'text-xs px-2 py-1 rounded flex items-center gap-2',
                  hasResult ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'
                )}
              >
                {hasResult ? (
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
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <span className="w-3 h-3 border-2 border-current rounded-full animate-spin border-t-transparent" />
                )}
                <span className="font-mono">{tool.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
