import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { UpdateBanner } from './components/UpdateBanner.tsx'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import './index.css'
import { router } from './router.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      <UpdateBanner />
    </AuthProvider>
  </StrictMode>,
)
