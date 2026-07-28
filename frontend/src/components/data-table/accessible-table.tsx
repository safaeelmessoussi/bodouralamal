import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AccessibleTableProps {
  caption?: string
  children: ReactNode
  className?: string
  striped?: boolean
  hover?: boolean
}

/**
 * Accessible data table with semantic HTML and ARIA attributes
 * Supports RTL, keyboard navigation, and responsive behavior
 */
export function AccessibleTable({
  caption,
  children,
  className,
  striped = true,
  hover = true,
}: AccessibleTableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border" dir="rtl">
      <table
        className={cn(
          "w-full border-collapse text-sm",
          className
        )}
        role="table"
      >
        {caption && (
          <caption className="sr-only text-left text-sm font-medium text-muted-foreground p-2">
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  )
}

interface TableHeadProps {
  children: ReactNode
  className?: string
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <thead
      className={cn(
        "border-b-2 border-border bg-muted/50",
        className
      )}
      role="rowgroup"
    >
      {children}
    </thead>
  )
}

interface TableBodyProps {
  children: ReactNode
  className?: string
  striped?: boolean
  hover?: boolean
}

export function TableBody({
  children,
  className,
  striped = true,
  hover = true,
}: TableBodyProps) {
  return (
    <tbody
      className={cn(
        striped && "[&>tr:nth-child(odd)]:bg-muted/30",
        hover && "[&>tr]:hover:bg-muted/50 [&>tr]:transition-colors",
        className
      )}
      role="rowgroup"
    >
      {children}
    </tbody>
  )
}

interface TableRowProps {
  children: ReactNode
  className?: string
  clickable?: boolean
  onClick?: () => void
}

export function TableRow({
  children,
  className,
  clickable = false,
  onClick,
}: TableRowProps) {
  return (
    <tr
      className={cn(
        "border-b border-border",
        clickable && "cursor-pointer",
        className
      )}
      role="row"
      onClick={onClick}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick?.()
        }
      }}
      tabIndex={clickable ? 0 : undefined}
    >
      {children}
    </tr>
  )
}

interface TableHeaderCellProps {
  children: ReactNode
  className?: string
  sortable?: boolean
  sorted?: "asc" | "desc"
  onSort?: () => void
}

export function TableHeaderCell({
  children,
  className,
  sortable = false,
  sorted,
  onSort,
}: TableHeaderCellProps) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-right font-semibold text-foreground",
        sortable && "cursor-pointer select-none hover:bg-muted/70",
        className
      )}
      role="columnheader"
      scope="col"
      onClick={onSort}
      onKeyDown={(e) => {
        if (sortable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onSort?.()
        }
      }}
      tabIndex={sortable ? 0 : undefined}
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}
    >
      <div className="flex items-center gap-2 justify-end">
        {children}
        {sorted && (
          <span className="text-xs">
            {sorted === "asc" ? "↑" : "↓"}
          </span>
        )}
      </div>
    </th>
  )
}

interface TableCellProps {
  children: ReactNode
  className?: string
  align?: "left" | "center" | "right"
  numeric?: boolean
}

export function TableCell({
  children,
  className,
  align = "right",
  numeric = false,
}: TableCellProps) {
  const alignMap = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  }

  return (
    <td
      className={cn(
        "px-4 py-3 text-foreground",
        alignMap[align],
        numeric && "font-mono",
        className
      )}
      role="cell"
    >
      {children}
    </td>
  )
}

/**
 * Simple table wrapper for common usage
 */
export function SimpleTable({
  headers,
  rows,
  caption,
}: {
  headers: string[]
  rows: (string | ReactNode)[][]
  caption?: string
}) {
  return (
    <AccessibleTable caption={caption}>
      <TableHead>
        <TableRow>
          {headers.map((header, idx) => (
            <TableHeaderCell key={idx}>{header}</TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, rowIdx) => (
          <TableRow key={rowIdx}>
            {row.map((cell, cellIdx) => (
              <TableCell key={cellIdx}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </AccessibleTable>
  )
}
