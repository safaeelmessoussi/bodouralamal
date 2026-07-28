import PageHeader from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Upload, FileText, Video, Music, Trash2, Plus } from "lucide-react"

export default function TeacherContent() {
  const content = [
    {
      id: 1,
      title: "Surah Al-Fatiha Explanation",
      type: "video",
      group: "All",
      size: "245 MB",
      uploaded: "2026-01-20",
      views: 342
    },
    {
      id: 2,
      title: "Islamic Principles Lecture",
      type: "audio",
      group: "Adult Literacy",
      size: "42 MB",
      uploaded: "2026-01-18",
      views: 156
    },
    {
      id: 3,
      title: "Quran Memorization Tips",
      type: "document",
      group: "Group A1",
      size: "2.3 MB",
      uploaded: "2026-01-15",
      views: 89
    },
    {
      id: 4,
      title: "Tajweed Rules Summary",
      type: "document",
      group: "Group B2",
      size: "5.1 MB",
      uploaded: "2026-01-12",
      views: 124
    },
  ]

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4" />
      case "audio":
        return <Music className="h-4 w-4" />
      default:
        return <FileText className="h-4 w-4" />
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case "video":
        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
      case "audio":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300"
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Library"
        description="Manage your teaching materials and resources"
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Upload Content
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Files</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">4</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Storage Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">294</div>
            <p className="text-xs text-muted-foreground mt-1">MB of 1000 MB</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Views</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">711</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">4.6</div>
            <p className="text-xs text-muted-foreground mt-1">/5.0</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Content</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="text-center">Type</TableHead>
                <TableHead className="text-center">Group</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-center">Uploaded</TableHead>
                <TableHead className="text-center">Views</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={getTypeColor(item.type)}>
                      {getTypeIcon(item.type)}
                      <span className="ml-1 capitalize">{item.type}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">{item.group}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{item.size}</TableCell>
                  <TableCell className="text-center text-muted-foreground text-sm">{item.uploaded}</TableCell>
                  <TableCell className="text-center font-medium">{item.views}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Upload className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Upload New Content</h3>
          <p className="text-sm text-muted-foreground mb-6 text-center">
            Drag and drop your files here, or click to browse
          </p>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Browse Files
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Supported: MP4, MP3, PDF (Max 100 MB each)
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
