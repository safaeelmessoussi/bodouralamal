import { Outlet } from "react-router-dom"
import { ApplicationHeader } from "@/components/header"

export default function AppShell() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <ApplicationHeader sticky />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
