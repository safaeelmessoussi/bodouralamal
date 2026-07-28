import { Skeleton } from "@/components/ui/skeleton"

export interface SkeletonListProps {
  count?: number
  isRtl?: boolean
}

export function SkeletonList({ count = 5, isRtl = true }: SkeletonListProps) {
  return (
    <div className="space-y-3" dir={isRtl ? "rtl" : "ltr"}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Skeleton className="h-4 w-4 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}
