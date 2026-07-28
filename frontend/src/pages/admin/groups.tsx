import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Plus, Users, BookOpen, MoreHorizontal, Edit2, Trash2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import PageHeader from "@/components/page-header"
import { apiClient, Group } from "@/services/api"

const typeLabels: Record<string, string> = {
  quran: "حفظ القرآن",
  islamic_studies: "دراسات إسلامية",
  literacy: "محو الأمية",
}

const typeColors: Record<string, string> = {
  quran: "bg-primary/10 text-primary",
  islamic_studies: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  literacy: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const loadGroups = async () => {
    try {
      setIsRefreshing(true)
      const response = await apiClient.getGroups(1, 100)
      setGroups(response.data)
    } catch (error) {
      toast.error("Failed to load groups")
      console.error("[v0] Failed to load groups:", error)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.getGroups(1, 100)
        setGroups(response.data)
      } catch (error) {
        console.warn("[v0] Groups endpoint not available, using mock data:", error)
        // Fallback to mock data while backend endpoint is under development
        const mockGroups: Group[] = [
          {
            id: "g1",
            name: "حفظ القرآن - المستوى الأول",
            branch_id: "b1",
            type: "quran",
            teacher_id: "t1",
            students_count: 18,
            max_capacity: 25,
            status: "active",
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: "g2",
            name: "الدراسات الإسلامية - المستوى الثاني",
            branch_id: "b1",
            type: "islamic_studies",
            teacher_id: "t2",
            students_count: 22,
            max_capacity: 25,
            status: "active",
            created_at: "2024-01-02T00:00:00Z",
          },
          {
            id: "g3",
            name: "محو الأمية النسائي",
            branch_id: "b2",
            type: "literacy",
            teacher_id: "t3",
            students_count: 12,
            max_capacity: 20,
            status: "active",
            created_at: "2024-01-03T00:00:00Z",
          },
        ]
        setGroups(mockGroups)
        toast.info("Showing demo data (groups endpoint pending)")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await apiClient.deleteGroup(groupId)
      setGroups(groups.filter(g => g.id !== groupId))
      setShowDeleteDialog(false)
      setSelectedGroup(null)
      toast.success("Group deleted successfully")
    } catch (error) {
      toast.error("Failed to delete group")
      console.error("[v0] Failed to delete group:", error)
    }
  }

  const filteredGroups = groups.filter(group =>
    group.name.includes(searchQuery) || group.type.includes(searchQuery)
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Study Groups" description="Manage study groups and classes" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Study Groups" 
        description="Manage study groups and classes"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadGroups} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Loading..." : "Refresh"}
            </Button>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New Group
            </Button>
          </div>
        }
      />

      {/* Search Bar */}
      <div className="relative">
        <Input
          placeholder="Search groups by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          🔍
        </div>
      </div>

      {/* Groups Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredGroups.length === 0 ? (
          <Card className="lg:col-span-2">
            <CardContent className="pt-6 text-center text-muted-foreground">
              <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No groups found</p>
            </CardContent>
          </Card>
        ) : (
          filteredGroups.map((group) => (
            <Card key={group.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{group.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{group.branch_id}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit2 className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            setSelectedGroup(group)
                            setShowDeleteDialog(true)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge className={typeColors[group.type]} variant="secondary">
                      {typeLabels[group.type] || group.type}
                    </Badge>
                    <Badge className={statusColors[group.status]} variant="secondary">
                      {group.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                    <div className="text-center">
                      <p className="text-sm font-semibold text-primary">{group.students_count}</p>
                      <p className="text-xs text-muted-foreground">Students</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-primary">{group.max_capacity}</p>
                      <p className="text-xs text-muted-foreground">Capacity</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-primary">
                        {Math.round((group.students_count / group.max_capacity) * 100)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Occupancy</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedGroup?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedGroup && handleDeleteGroup(selectedGroup.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
