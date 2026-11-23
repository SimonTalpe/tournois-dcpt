import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthScreen, DemoModeNotice, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import {
  PASSWORD_MIN_LENGTH,
  normalizeEmail,
  normalizeFullName,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePasswordConfirmation,
} from '../features/auth/validation.ts'
import { supabase } from '../lib/supabase.ts'

type Errors = Partial<Record<'fullName' | 'email' | 'password' | 'confirmation' | 'form', string | null>>

/** Inscription : nom complet, email autorisé, mot de passe → code envoyé par email. */
export function SignupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const nextErrors: Errors = {
      fullName: validateFullName(fullName),
      email: validateEmail(email),
      password: validatePassword(password),
      confirmation: validatePasswordConfirmation(password, confirmation),
    }
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return

    setBusy(true)
    const cleanEmail = normalizeEmail(email)
    const { data: allowed } = await supabase.rpc('is_email_allowed', { p_email: cleanEmail })
    if (allowed === false) {
      setBusy(false)
      setErrors({ email: "Cette adresse n'est pas autorisée. Utilise ton adresse @fft.fr." })
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: normalizeFullName(fullName) } },
    })
    setBusy(false)
    if (error) return setErrors({ form: translateError(error) })
    // Adresse déjà inscrite et confirmée : Supabase ne renvoie pas d'erreur mais aucune identité.
    if (data.user && data.user.identities?.length === 0) {
      return setErrors({ form: translateError({ code: 'user_already_exists' }) })
    }
    navigate(`/verification?email=${encodeURIComponent(cleanEmail)}`)
  }

  return (
    <AuthScreen title="Créer un compte" backTo="/jouer">
      {auth.demoMode && <DemoModeNotice />}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Prénom et nom"
          name="fullName"
          autoComplete="name"
          placeholder="Camille Dupont"
          hint="Affiché dans les tableaux et les résultats."
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <TextField
          label="Email professionnel"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom.nom@fft.fr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`${PASSWORD_MIN_LENGTH} caractères minimum.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <TextField
          label="Confirme le mot de passe"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          error={errors.confirmation}
        />
        {errors.form && <Notice tone="error">{errors.form}</Notice>}
        <PrimaryButton busy={busy} disabled={auth.demoMode}>
          Recevoir mon code par email
        </PrimaryButton>
      </form>
      <p className="text-center text-sm">
        Déjà un compte ?{' '}
        <Link to="/jouer" className="font-semibold text-ochre-text underline">
          Se connecter
        </Link>
      </p>
    </AuthScreen>
  )
}
