import { cn } from '@/lib/utils';
import type { ConnectionStatus as ConnectionStatusType } from '@/hooks/useSSE';

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  className?: string;
}

export function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  const statusConfig = {
    disconnected: {
      color: 'bg-gray-400',
      text: 'Disconnected',
    },
    connecting: {
      color: 'bg-yellow-400 animate-pulse',
      text: 'Connecting...',
    },
    connected: {
      color: 'bg-green-400',
      text: 'Connected',
    },
    error: {
      color: 'bg-red-400',
      text: 'Error',
    },
  };

  const config = statusConfig[status];

  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <span className={cn('w-2 h-2 rounded-full', config.color)} />
      <span>{config.text}</span>
    </div>
  );
}
