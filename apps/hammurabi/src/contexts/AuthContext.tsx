import { createContext, useContext, type ReactNode } from 'react'

interface AuthContextValue {
  signOut: () => void
  user?: {
    name?: string | null
    email?: string | null
    picture?: string | null
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  signOut,
  user,
  children,
}: {
  signOut: () => void
  user?: AuthContextValue['user']
  children: ReactNode
}) {
  return (
    <AuthContext.Provider value={{ signOut, user }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  return ctx
}
