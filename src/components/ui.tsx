import type { InputHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'

/** Écran centré des pages d'accès (connexion, inscription, code…). */
export function AuthScreen({
  title,
  children,
  backTo = '/',
}: {
  title: string
  children: ReactNode
  backTo?: string
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-chalk px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-court">{title}</h1>
        {children}
        <Link to={backTo} className="block text-center text-sm text-ink/60 underline">
          ← Retour
        </Link>
      </div>
    </main>
  )
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
  hint?: string
}

export function TextField({ label, error, hint, id, name, className, ...inputProps }: TextFieldProps) {
  const inputId = id ?? name
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-xl border px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-court/40 ${
          error ? 'border-clay' : 'border-ink/20'
        } ${className ?? ''}`}
        {...inputProps}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-clay">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-ink/60">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'bg-ball/30',
    error: 'bg-clay/15 text-clay',
    success: 'bg-court/10 text-court',
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

export function PrimaryButton({
  children,
  busy = false,
  type = 'submit',
  onClick,
  disabled,
}: {
  children: ReactNode
  busy?: boolean
  type?: 'submit' | 'button'
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full rounded-xl bg-court px-4 py-3 font-semibold text-chalk transition hover:bg-court-light active:scale-[0.98] disabled:opacity-60"
    >
      {busy ? 'Patiente…' : children}
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  danger = false,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'submit' | 'button'
  danger?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
        danger ? 'border-clay/50 text-clay hover:bg-clay/10' : 'border-court/30 text-court hover:bg-court/10'
      }`}
    >
      {children}
    </button>
  )
}

/** Bandeau du mode maquette (Supabase pas encore branché). */
export function DemoModeNotice() {
  return (
    <Notice>
      🚧 Le site n'est pas encore relié à la base de données : cet écran ne fonctionne pas encore. Tu peux{' '}
      <Link to="/accueil" className="font-semibold underline">
        visiter la maquette
      </Link>
      .
    </Notice>
  )
}
