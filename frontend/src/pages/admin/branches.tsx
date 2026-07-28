import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Building2, Plus, Users, MapPin, DoorOpen, MoreHorizontal, Edit2, Trash2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import PageHeader from "@/components/page-header"
import { apiClient, Branch } from "@/services/api"

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [showAddDialog, setShowAddDialog] = useState(false)

  const loadBranches = async () => {
    try {
      setIsRefreshing(true)
      const response = await apiClient.getBranches(1, 50)
      setBranches(response.data)
    } catch (error) {
      toast.error("Failed to load branches")
      console.error("[v0] Failed to load branches:", error)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.getBranches(1, 50)
        setBranches(response.data)
      } catch (error) {
        toast.error("Failed to load branches")
        console.error("[v0] Failed to load branches:", error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const handleAddBranch = async () => {
    if (!newBranchName.trim()) {
      toast.error("Please enter a branch name")
      return
    }
    try {
      const newBranch = await apiClient.createBranch({
        name: newBranchName,
        location: "To be determined",
      })
      setBranches([...branches, newBranch])
      setNewBranchName("")
      setShowAddDialog(false)
      toast.success("Branch created successfully")
    } catch (error) {
      toast.error("Failed to create branch")
      console.error("[v0] Failed to create branch:", error)
    }
  }

  const handleDeleteBranch = async (branchId: string) => {
    try {
      await apiClient.deleteBranch(branchId)
      setBranches(branches.filter(b => b.id !== branchId))
      setShowDeleteDialog(false)
      setSelectedBranch(null)
      toast.success("Branch deleted successfully")
    } catch (error) {
      toast.error("Failed to delete branch")
      console.error("[v0] Failed to delete branch:", error)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branches & Rooms" description="Manage institute branches and facilities" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
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
        title="Branches & Rooms" 
        description="Manage institute branches and facilities"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadBranches} disabled={isRefreshing}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Branch
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        {branches.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <Building2 className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No branches found. Create one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          branches.map((branch) => (
            <Card key={branch.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    <CardTitle>{branch.name}</CardTitle>
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {branch.location}
                  </CardDescription>
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
                        setSelectedBranch(branch)
                        setShowDeleteDialog(true)
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-bold text-primary">{branch.rooms_count || 0}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                      <DoorOpen className="h-3 w-3" />
                      Rooms
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-bold text-primary">0</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                      <Users className="h-3 w-3" />
                      Teachers
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-2xl font-bold text-primary">0</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                      <Users className="h-3 w-3" />
                      Students
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">
                  Created {new Date(branch.created_at).toLocaleDateString()}
                </Badge>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Branch Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Branch</DialogTitle>
            <DialogDescription>Create a new branch for the institute</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Branch Name</label>
              <Input
                placeholder="Enter branch name (e.g., Downtown Branch)"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddBranch}>
              Create Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Branch</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedBranch?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedBranch && handleDeleteBranch(selectedBranch.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
