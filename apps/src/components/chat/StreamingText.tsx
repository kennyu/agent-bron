import { cn } from '@/lib/utils';

interface StreamingTextProps {
  content: string;
  className?: string;
}

export function StreamingText({ content, className }: StreamingTextProps) {
  if (!content) return null;

  return (
    <div className={cn('flex justify-start mb-4', className)}>
      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
        <div className="whitespace-pre-wrap break-words text-sm">
          {content}
          <span className="inline-block w-2 h-4 ml-0.5 bg-foreground/50 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
