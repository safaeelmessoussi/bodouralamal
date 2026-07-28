import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, Eye } from "lucide-react"
import { useNavigate } from "react-router-dom"

export default function TeacherGroups() {
  const navigate = useNavigate()

  const groups = [
    {
      id: 1,
      name: "Group A1",
      level: "Beginner",
      students: 12,
      room: "Room 1",
      schedule: "Sat, Mon, Wed - 10:00 AM",
      progress: 65
    },
    {
      id: 2,
      name: "Group B2",
      level: "Intermediate",
      students: 10,
      room: "Room 2",
      schedule: "Sun, Tue, Thu - 11:30 AM",
      progress: 72
    },
    {
      id: 3,
      name: "Group C1",
      level: "Advanced",
      students: 8,
      room: "Room 1",
      schedule: "Sat, Mon, Wed - 02:00 PM",
      progress: 85
    },
    {
      id: 4,
      name: "Adult Literacy",
      level: "Adult",
      students: 15,
      room: "Room 3",
      schedule: "Mon, Wed, Fri - 06:00 PM",
      progress: 58
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Manage Groups"
        description="View and manage all your teaching groups"
      >
        <Button>Add Group</Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{group.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{group.room}</p>
                </div>
                <Badge variant="secondary" className="ml-2">
                  {group.level}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{group.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${group.progress}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{group.students} students</span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {group.schedule}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" className="flex-1">
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </Button>
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
