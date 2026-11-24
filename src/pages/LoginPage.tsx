import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthScreen, DemoModeNotice, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import { normalizeEmail, validateEmail } from '../features/auth/validation.ts'
import { supabase } from '../lib/supabase.ts'

/** Connexion joueur / admin. */
export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const disabledAccount = params.get('desactive') === '1'

  // Un compte désactivé est déconnecté aussitôt, avec un message.
  const { access, signOut } = auth
  useEffect(() => {
    if (access === 'disabled') {
      navigate('/jouer?desactive=1', { replace: true })
      void signOut()
    }
  }, [access, signOut, navigate])

  if (!auth.demoMode && !auth.loading && isPlayer(auth)) return <Navigate to="/accueil" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const emailError = validateEmail(email)
    if (emailError) return setError(emailError)
    if (!password) return setError('Saisis ton mot de passe.')

    setBusy(true)
    setError(null)
    const cleanEmail = normalizeEmail(email)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
    setBusy(false)

    if (signInError?.code === 'email_not_confirmed') {
      // Code non saisi à l'inscription : on renvoie un code et on passe à l'écran de vérification.
      await supabase.auth.resend({ type: 'signup', email: cleanEmail })
      navigate(`/verification?email=${encodeURIComponent(cleanEmail)}&renvoye=1`)
      return
    }
    if (signInError) return setError(translateError(signInError))
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthScreen title="Jouer">
      {auth.demoMode && <DemoModeNotice />}
      {disabledAccount && (
        <Notice tone="error">Ce compte est désactivé. Contacte l'administrateur du site.</Notice>
      )}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Email professionnel"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="prenom.nom@fft.fr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <PrimaryButton busy={busy} disabled={auth.demoMode}>
          Se connecter
        </PrimaryButton>
      </form>
      <div className="flex flex-col gap-2 text-center text-sm">
        <Link to="/mot-de-passe-oublie" className="text-ochre-text underline">
          Mot de passe oublié ?
        </Link>
        <p>
          Pas encore de compte ?{' '}
          <Link to="/inscription" className="font-semibold text-ochre-text underline">
            Créer un compte
          </Link>
        </p>
      </div>
    </AuthScreen>
  )
}
