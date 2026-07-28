console.log("[v0] Starting app initialization...")

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "./components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ErrorBoundary } from "./components/error-boundary"
import { Toaster } from "sonner"
import App from "./App"
import "./globals.css"

console.log("[v0] All imports successful")

const rootElement = document.getElementById("root")
console.log("[v0] Root element:", rootElement)
if (rootElement) {
  console.log("[v0] Creating React root...")
  try {
    createRoot(rootElement).render(
      <ErrorBoundary>
        <StrictMode>
          <BrowserRouter>
            <ThemeProvider defaultTheme="light" storageKey="bodour-theme">
              <TooltipProvider>
                <App />
                <Toaster richColors position="top-center" />
              </TooltipProvider>
            </ThemeProvider>
          </BrowserRouter>
        </StrictMode>
      </ErrorBoundary>
    )
    console.log("[v0] Render successful")
  } catch (err) {
    console.error("[v0] Render failed:", err)
    document.body.innerHTML = `<div style="color: red; padding: 20px;">Error: ${err}</div>`
  }
} else {
  console.error("[v0] Root element not found!")
}
