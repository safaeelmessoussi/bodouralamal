import { useState, useEffect } from "react"
import { toast } from "sonner"
import { UserPlus, MoreHorizontal, Edit2, Trash2, RefreshCw, Mail, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import PageHeader from "@/components/page-header"
import { apiClient, User } from "@/services/api"

const roleLabels: Record<string, string> = {
  admin: "مدير النظام",
  branch_manager: "مدير الفرع",
  teacher: "معلمة",
  parent: "أم / ولية",
  student: "طالبة",
}

const roleColors: Record<string, string> = {
  admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  branch_manager: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  teacher: "bg-primary/10 text-primary",
  parent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  student: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const loadUsers = async () => {
    try {
      setIsRefreshing(true)
      const response = await apiClient.getUsers(1, 100)
      setUsers(response.data)
    } catch (error) {
      toast.error("Failed to load users")
      console.error("[v0] Failed to load users:", error)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.getUsers(1, 100)
        setUsers(response.data)
      } catch (error) {
        toast.error("Failed to load users")
        console.error("[v0] Failed to load users:", error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const handleDeleteUser = async (userId: string) => {
    try {
      await apiClient.deleteUser(userId)
      setUsers(users.filter(u => u.id !== userId))
      setShowDeleteDialog(false)
      setSelectedUser(null)
      toast.success("User deleted successfully")
    } catch (error) {
      toast.error("Failed to delete user")
      console.error("[v0] Failed to delete user:", error)
    }
  }

  const filteredUsers = users.filter(user =>
    user.name.includes(searchQuery) ||
    user.email.includes(searchQuery)
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="User Management" description="Manage institute users and permissions" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader 
        title="User Management" 
        description="Manage institute users and permissions"
        action={
          <Button variant="outline" size="sm" onClick={loadUsers} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      {/* Search Bar */}
      <div className="relative">
        <Input
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          🔍
        </div>
      </div>

      {/* Users Table / Cards */}
      <div className="space-y-2">
        {filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No users found
            </CardContent>
          </Card>
        ) : (
          filteredUsers.map((user) => (
            <Card key={user.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarFallback className="bg-primary/20">
                        {user.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{user.name}</h3>
                        <Badge className={roleColors[user.role]} variant="secondary">
                          {roleLabels[user.role]}
                        </Badge>
                        <Badge className={statusColors[user.status]} variant="secondary">
                          {user.status}
                        </Badge>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {user.email}
                        </div>
                        {user.last_login && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Last login: {new Date(user.last_login).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="flex-shrink-0">
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
                          setSelectedUser(user)
                          setShowDeleteDialog(true)
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedUser?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedUser && handleDeleteUser(selectedUser.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
