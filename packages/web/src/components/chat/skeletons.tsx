import { Skeleton } from "@/components/ui/skeleton";

export function ChatListSkeleton() {
  return (
    <div className="space-y-4 px-2 py-3" data-testid="chat-list-skeleton">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-5/6" />
        </div>
      ))}
    </div>
  );
}

export function ChatThreadSkeleton() {
  return (
    <div className="flex h-full flex-col" data-testid="chat-thread-skeleton">
      <div className="flex h-12 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 rounded-md" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="ml-auto h-8 w-52" />
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-end gap-5 px-4 py-6">
        <div className="flex justify-end">
          <Skeleton className="h-16 w-64 rounded-2xl" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="size-6 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Skeleton className="mx-auto h-20 max-w-[760px] rounded-xl" />
      </div>
    </div>
  );
}
