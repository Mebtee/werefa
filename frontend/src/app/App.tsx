import { useMemo } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { createAppRouter } from '@/routes'

export function App() {
  const router = useMemo(() => createAppRouter(), [])

  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}