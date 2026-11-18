import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { AuthScreen, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import {
  PASSWORD_MIN_LENGTH,
  validatePassword,
  validatePasswordConfirmation,
} from '../features/auth/validation.ts'
import { LoadingScreen } from '../features/auth/guards.tsx'
import { supabase } from '../lib/supabase.ts'

/** Changement de mot de passe d'un joueur connecté (obligatoire après un mot de passe provisoire). */
export function ChangePasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (auth.loading) return <LoadingScreen />
  if (!isPlayer(auth)) return <Navigate to="/jouer" replace />
  const forced = auth.profile?.must_change_password ?? false

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const formError = validatePassword(password) ?? validatePasswordConfirmation(password, confirmation)
    if (formError) return setError(formError)
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setBusy(false)
      return setError(translateError(updateError))
    }
    await supabase.rpc('clear_must_change_password')
    await auth.refresh()
    setBusy(false)
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthScreen title="Nouveau mot de passe" backTo={forced ? '/jouer' : '/profil'}>
      {forced && (
        <Notice>Tu t'es connecté avec un mot de passe provisoire : choisis maintenant ton propre mot de passe.</Notice>
      )}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Nouveau mot de passe"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`${PASSWORD_MIN_LENGTH} caractères minimum.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label="Confirme le nouveau mot de passe"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <PrimaryButton busy={busy} disabled={auth.demoMode}>
          Enregistrer
        </PrimaryButton>
      </form>
    </AuthScreen>
  )
}
