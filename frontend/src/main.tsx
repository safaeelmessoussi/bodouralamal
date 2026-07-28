import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "./components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ErrorBoundary } from "./components/error-boundary"
import { Toaster } from "sonner"
import App from "./App"
import "./globals.css"

const rootElement = document.getElementById("root")
if (rootElement) {
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
}
