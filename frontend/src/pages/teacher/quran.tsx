import PageHeader from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { BookOpen, CheckCircle2, Circle } from "lucide-react"

export default function TeacherQuran() {
  const quranData = [
    { surah: "Al-Fatiha", verses: 7, students_completed: 12, total_students: 12, status: "completed" },
    { surah: "Al-Baqarah", verses: 286, students_completed: 8, total_students: 12, status: "in-progress" },
    { surah: "Ali Imran", verses: 200, students_completed: 5, total_students: 12, status: "in-progress" },
    { surah: "An-Nisa", verses: 176, students_completed: 2, total_students: 12, status: "pending" },
    { surah: "Al-Ma'idah", verses: 120, students_completed: 0, total_students: 12, status: "pending" },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Quran Memorization Tracking"
        description="Monitor student progress through the Quran"
      >
        <Button>Add Milestone</Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Surahs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">114</div>
            <p className="text-xs text-muted-foreground mt-1">In the Quran</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">5.2</div>
            <p className="text-xs text-muted-foreground mt-1">Surahs per student</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Performer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Ahmed</div>
            <p className="text-xs text-muted-foreground mt-1">15 Surahs completed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Surah Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surah</TableHead>
                <TableHead className="text-right">Verses</TableHead>
                <TableHead className="text-center">Progress</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quranData.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{row.surah}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{row.verses}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${(row.students_completed / row.total_students) * 100}%`
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium">
                        {row.students_completed}/{row.total_students}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {row.status === "completed" ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Done
                      </Badge>
                    ) : row.status === "in-progress" ? (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        <Circle className="mr-1 h-3 w-3" />
                        In Progress
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
