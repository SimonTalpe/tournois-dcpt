import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { AuthScreen, DemoModeNotice, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { canViewSite, useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import { supabase } from '../lib/supabase.ts'

/** Accès spectateur par code commun (session anonyme Supabase + vérification du code en base). */
export function SpectatorPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!auth.demoMode && !auth.loading && canViewSite(auth)) return <Navigate to="/accueil" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (!code.trim()) return setError('Saisis le code spectateur.')
    setBusy(true)
    setError(null)

    // Session anonyme : réutilisée si elle existe déjà sur cet appareil.
    if (!auth.session) {
      const { error: anonError } = await supabase.auth.signInAnonymously()
      if (anonError) {
        setBusy(false)
        return setError(translateError(anonError))
      }
    }
    const { data: ok, error: codeError } = await supabase.rpc('redeem_spectator_code', { p_code: code.trim() })
    if (codeError) {
      setBusy(false)
      return setError(translateError(codeError))
    }
    if (!ok) {
      setBusy(false)
      return setError('Code incorrect. Demande le code à un joueur ou à l’organisateur.')
    }
    await auth.refresh()
    setBusy(false)
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthScreen title="👀 Regarder">
      {auth.demoMode && <DemoModeNotice />}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Code spectateur"
          name="spectatorCode"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          hint="Le code commun partagé par l’organisateur."
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <PrimaryButton busy={busy} disabled={auth.demoMode}>
          Entrer
        </PrimaryButton>
      </form>
    </AuthScreen>
  )
}
