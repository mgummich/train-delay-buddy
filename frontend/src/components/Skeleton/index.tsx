import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded bg-bg-subtle', className)}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-card rounded-card shadow-card p-4 flex flex-col gap-3">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-4 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-badge" />
        <Skeleton className="h-6 w-16 rounded-badge" />
      </div>
    </div>
  )
}
