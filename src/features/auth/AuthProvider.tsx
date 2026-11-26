import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'
import { saveGame, setGameOwner } from '../darts/storage.ts'
import { AuthContext, type Access, type AuthState, type Profile } from './AuthContext.ts'

/** Suit la session Supabase et calcule le niveau d'accès (joueur, admin, spectateur…). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(!supabase)
  const [access, setAccess] = useState<Access>('none')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [accessLoadedFor, setAccessLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    // Ne pas appeler Supabase directement dans ce rappel (recommandation Supabase) : on mémorise seulement la session.
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setSessionLoaded(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  // Partie de fléchettes sauvegardée sur l'appareil : rattachée au compte connecté (valeur de module, sans effet sur le rendu).
  setGameOwner(userId)

  // Lit la session courante (et non celle du dernier rendu) : `refresh` reste juste
  // même appelé juste après une connexion ou la saisie du code spectateur.
  // Seule la dernière demande lancée est prise en compte (évite qu'une réponse ancienne écrase une récente).
  const requestSeq = useRef(0)
  const loadAccess = useCallback(async () => {
    if (!supabase) return
    const seq = ++requestSeq.current
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    // Sans utilisateur, l'accès vaut 'none' (calculé dans `value`).
    if (!user) return
    const [accessResult, profileResult] = await Promise.all([
      supabase.rpc('my_access'),
      user.is_anonymous
        ? Promise.resolve({ data: null })
        : supabase
            .from('profiles')
            .select('id, full_name, role, status, must_change_password')
            .eq('id', user.id)
            .maybeSingle(),
    ])
    if (seq !== requestSeq.current) return
    setAccess((accessResult.data as Access | null) ?? 'none')
    setProfile((profileResult.data as Profile | null) ?? null)
    setAccessLoadedFor(user.id)
  }, [])

  useEffect(() => {
    // Chargement asynchrone de l'accès à chaque changement d'utilisateur.
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void loadAccess()
  }, [loadAccess, userId])

  const signOut = useCallback(async () => {
    // Partie de fléchettes en cours sur l'appareil : propre au compte qui se déconnecte.
    saveGame(null)
    if (supabase) await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      loading: !sessionLoaded || (userId !== null && accessLoadedFor !== userId),
      demoMode: !supabase,
      session,
      access: userId ? access : 'none',
      profile: userId ? profile : null,
      refresh: loadAccess,
      signOut,
    }),
    [sessionLoaded, userId, accessLoadedFor, session, access, profile, loadAccess, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
