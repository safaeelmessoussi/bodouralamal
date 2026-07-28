import { LucideIcon } from "lucide-react"
import StatCard from "@/components/stat-card"
import { StatMetric } from "@/services/dashboard-adapter"

interface StatsGridProps {
  metrics: StatMetric[]
  icons?: (LucideIcon | null)[]
  isLoading?: boolean
  columns?: number
}

export default function StatsGrid({
  metrics,
  icons,
  isLoading = false,
  columns = 4,
}: StatsGridProps) {
  const gridClass = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3 lg:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4",
  }[columns] || "md:grid-cols-2 lg:grid-cols-4"

  return (
    <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
      {metrics.map((metric, idx) => (
        <StatCard
          key={`${metric.title}-${idx}`}
          title={metric.title}
          value={metric.value}
          description={metric.description}
          icon={icons?.[idx]}
          trend={metric.trend}
          isLoading={isLoading}
        />
      ))}
    </div>
  )
}
