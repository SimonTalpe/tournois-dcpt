import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { AuthScreen, DemoModeNotice, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import {
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
  normalizeEmail,
  normalizeOtp,
  validateEmail,
  validateOtp,
  validatePassword,
  validatePasswordConfirmation,
} from '../features/auth/validation.ts'
import { supabase } from '../lib/supabase.ts'

/** Mot de passe oublié : email → code à 6 chiffres → nouveau mot de passe. */
export function ForgotPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    if (!supabase) return
    const emailError = validateEmail(email)
    if (emailError) return setError(emailError)
    setBusy(true)
    setError(null)
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email))
    setBusy(false)
    if (sendError) return setError(translateError(sendError))
    setStep('code')
    setInfo(`Si un compte existe pour cette adresse, un code à ${OTP_LENGTH} chiffres vient d'être envoyé.`)
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const formError =
      validateOtp(code) ?? validatePassword(password) ?? validatePasswordConfirmation(password, confirmation)
    if (formError) return setError(formError)

    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: normalizeOtp(code),
      type: 'recovery',
    })
    if (verifyError) {
      setBusy(false)
      return setError(translateError(verifyError))
    }
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
    <AuthScreen title="Mot de passe oublié" backTo="/jouer">
      {auth.demoMode && <DemoModeNotice />}
      {step === 'email' ? (
        <form className="space-y-4" onSubmit={sendCode} noValidate>
          <p className="text-sm">Saisis ton adresse : tu recevras un code pour choisir un nouveau mot de passe.</p>
          <TextField
            label="Email professionnel"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="prenom.nom@fft.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <PrimaryButton busy={busy} disabled={auth.demoMode}>
            Recevoir un code
          </PrimaryButton>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleReset} noValidate>
          {info && <Notice tone="success">{info}</Notice>}
          <TextField
            label="Code reçu par email"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="text-center text-2xl tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(normalizeOtp(e.target.value))}
          />
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
          <PrimaryButton busy={busy}>Changer mon mot de passe</PrimaryButton>
          <button type="button" onClick={() => sendCode()} className="w-full text-center text-sm text-court underline">
            Renvoyer un code
          </button>
        </form>
      )}
    </AuthScreen>
  )
}
