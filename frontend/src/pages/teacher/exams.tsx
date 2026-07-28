import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Award, Plus, Eye } from "lucide-react"

export default function TeacherExams() {
  const exams = [
    {
      id: 1,
      title: "Surah Al-Fatiha Quiz",
      group: "Group A1",
      date: "2026-01-28",
      total_questions: 10,
      submitted: 9,
      total_students: 12,
      status: "grading",
      avg_score: 8.2
    },
    {
      id: 2,
      title: "Islamic Studies Module 1",
      group: "Group B2",
      date: "2026-01-25",
      total_questions: 20,
      submitted: 10,
      total_students: 10,
      status: "completed",
      avg_score: 7.8
    },
    {
      id: 3,
      title: "Quran Recitation Test",
      group: "Group C1",
      date: "2026-01-22",
      total_questions: 0,
      submitted: 8,
      total_students: 8,
      status: "completed",
      avg_score: 8.9
    },
    {
      id: 4,
      title: "Islamic Principles Quiz",
      group: "Group A1",
      date: "2026-01-30",
      total_questions: 15,
      submitted: 0,
      total_students: 12,
      status: "draft",
      avg_score: 0
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Exam Management"
        description="Create, grade, and track student exams"
      >
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Exam
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Exams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">4</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Grade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">9</div>
            <p className="text-xs text-muted-foreground mt-1">Submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">8.3</div>
            <p className="text-xs text-muted-foreground mt-1">/10</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">75%</div>
            <p className="text-xs text-muted-foreground mt-1">Overall</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Exams</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead className="text-center">Group</TableHead>
                <TableHead className="text-center">Date</TableHead>
                <TableHead className="text-center">Submissions</TableHead>
                <TableHead className="text-center">Avg. Score</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className="font-medium">{exam.title}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{exam.group}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{exam.date}</TableCell>
                  <TableCell className="text-center">
                    <span className="font-medium">{exam.submitted}/{exam.total_students}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    {exam.avg_score > 0 ? (
                      <span className="font-medium">{exam.avg_score.toFixed(1)}/10</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {exam.status === "draft" && (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                    {exam.status === "grading" && (
                      <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                        Grading
                      </Badge>
                    )}
                    {exam.status === "completed" && (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        Done
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      <Eye className="h-4 w-4" />
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
