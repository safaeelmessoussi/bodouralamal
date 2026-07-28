import { Routes, Route } from "react-router-dom"
import { AuthProvider } from "./contexts/auth-context"
import LandingPage from "./pages/landing"

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </AuthProvider>
  )
}
