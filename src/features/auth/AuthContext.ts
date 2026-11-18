import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

/** Niveau d'accès calculé par la base (fonction my_access). */
export type Access = 'admin' | 'player' | 'spectator' | 'disabled' | 'none'

export type Profile = {
  id: string
  full_name: string
  role: 'player' | 'admin'
  status: 'active' | 'disabled' | 'deleted'
  must_change_password: boolean
}

export type AuthState = {
  /** Vrai pendant le chargement initial de la session. */
  loading: boolean
  /** Mode maquette : Supabase non configuré, toutes les pages sont ouvertes. */
  demoMode: boolean
  session: Session | null
  access: Access
  profile: Profile | null
  /** Relit l'accès et le profil (après une action qui les modifie). */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return value
}

export function canViewSite(state: Pick<AuthState, 'demoMode' | 'access'>): boolean {
  return state.demoMode || state.access === 'admin' || state.access === 'player' || state.access === 'spectator'
}

export function isPlayer(state: Pick<AuthState, 'demoMode' | 'access'>): boolean {
  return state.demoMode || state.access === 'admin' || state.access === 'player'
}

export function isAdmin(state: Pick<AuthState, 'demoMode' | 'access'>): boolean {
  return state.demoMode || state.access === 'admin'
}
