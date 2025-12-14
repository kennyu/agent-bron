import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        className
      )}
    />
  );
}

export function ChatItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton className="w-2 h-2 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-1" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3].map((i) => (
        <ChatItemSkeleton key={i} />
      ))}
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
        <Skeleton className="h-4 w-48 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

export function MessageListSkeleton() {
  return (
    <div className="p-4">
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%]">
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </div>
      <MessageSkeleton />
      <MessageSkeleton />
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <Skeleton className="h-4 w-28 mb-2" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-12 rounded" />
            <Skeleton className="h-5 w-16 rounded" />
          </div>
        </div>
        <div className="flex gap-1">
          <Skeleton className="w-7 h-7 rounded" />
          <Skeleton className="w-7 h-7 rounded" />
          <Skeleton className="w-7 h-7 rounded" />
        </div>
      </div>
    </div>
  );
}

export function AgentsPanelSkeleton() {
  return (
    <div className="space-y-3 p-3">
      <AgentCardSkeleton />
      <AgentCardSkeleton />
    </div>
  );
}
