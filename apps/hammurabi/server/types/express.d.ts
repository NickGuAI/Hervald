import type { AuthUser } from '@gehirn/auth-providers'

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      authMode?: 'auth0' | 'api-key'
    }
  }
}

export {}
