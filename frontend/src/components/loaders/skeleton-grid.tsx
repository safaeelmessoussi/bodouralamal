import { Skeleton } from "@/components/ui/skeleton"

export interface SkeletonGridProps {
  count?: number
  columns?: 1 | 2 | 3 | 4
  height?: string
  isRtl?: boolean
}

export function SkeletonGrid({
  count = 4,
  columns = 4,
  height = "h-48",
  isRtl = true,
}: SkeletonGridProps) {
  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  }[columns]

  return (
    <div
      className={`grid gap-4 ${gridClass}`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className={`${height}`} />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
