import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthScreen, Notice, PrimaryButton, TextField } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { translateError } from '../features/auth/errors.ts'
import { OTP_LENGTH, normalizeOtp, validateOtp } from '../features/auth/validation.ts'
import { supabase } from '../lib/supabase.ts'

/** Saisie du code à 6 chiffres reçu après l'inscription. */
export function VerifyEmailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(
    params.get('renvoye') === '1' ? 'Ton adresse n’était pas encore confirmée : un nouveau code vient de t’être envoyé.' : null,
  )
  const [busy, setBusy] = useState(false)

  if (!email) return <Navigate to="/inscription" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const codeError = validateOtp(code)
    if (codeError) return setError(codeError)
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: normalizeOtp(code), type: 'signup' })
    if (verifyError) {
      setBusy(false)
      return setError(translateError(verifyError))
    }
    await auth.refresh()
    setBusy(false)
    navigate('/accueil', { replace: true })
  }

  async function handleResend() {
    if (!supabase) return
    setError(null)
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email })
    if (resendError) setError(translateError(resendError))
    else setInfo('Nouveau code envoyé. Seul le dernier code reçu est valable.')
  }

  return (
    <AuthScreen title="Vérifie ton email" backTo="/inscription">
      <p className="text-sm">
        Un code à {OTP_LENGTH} chiffres a été envoyé à <strong className="break-all">{email}</strong>. Pense à
        regarder dans les courriers indésirables.
      </p>
      {info && <Notice tone="success">{info}</Notice>}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Code reçu par email"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="text-center text-2xl tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(normalizeOtp(e.target.value))}
          error={error}
        />
        <PrimaryButton busy={busy}>Activer mon compte</PrimaryButton>
      </form>
      <button type="button" onClick={handleResend} className="w-full text-center text-sm text-ochre-text underline">
        Je n'ai rien reçu : renvoyer un code
      </button>
    </AuthScreen>
  )
}
