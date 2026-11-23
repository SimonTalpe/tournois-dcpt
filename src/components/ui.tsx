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
    <main className="min-h-screen border-t-8 border-ochre bg-white px-5 pt-2 pb-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <Link to={backTo} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-black">
          <Icon name="back" className="h-[18px] w-[18px]" />
          Retour
        </Link>
        <h1 className="font-display text-[56px] leading-[0.9] font-black">{title}</h1>
        {children}
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
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-[15px] font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-[52px] w-full border-2 bg-white px-3.5 text-[17px] ${
          error ? 'border-ochre-text' : 'border-black'
        } ${className ?? ''}`}
        {...inputProps}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-[15px] font-semibold text-ochre-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'border-black bg-mist',
    error: 'border-ochre-text bg-ochre-tint font-semibold text-ochre-text',
    success: 'border-black bg-white',
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`border-l-4 p-3 text-[15px] leading-snug ${styles}`}>
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
      className="flex min-h-[52px] w-full items-center justify-center border-2 border-black bg-black px-4 text-[17px] font-semibold text-white transition-colors hover:border-ochre-text hover:bg-ochre-text disabled:opacity-60"
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
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'submit' | 'button'
  danger?: boolean
  /** Texte lu par les lecteurs d'écran quand le bouton n'affiche qu'un symbole. */
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex min-h-11 items-center justify-center border-2 bg-white px-3.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
        danger
          ? 'border-ochre-text text-ochre-text hover:bg-ochre-text hover:text-white'
          : 'border-black text-black hover:bg-black hover:text-white'
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
      Le site n'est pas encore relié à la base de données : cet écran ne fonctionne pas encore. Tu peux{' '}
      <Link to="/accueil" className="font-semibold underline">
        visiter la maquette
      </Link>
      .
    </Notice>
  )
}

const ICON_PATHS = {
  home: <path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" />,
  tournaments: <path d="M3 5h5v4H3zM3 15h5v4H3zM8 7h4v10H8M12 12h4M16 10h5v4h-5z" />,
  darts: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  ranking: <path d="M9 20V8h6v12M3 20v-7h6M15 20v-9h6v9M2 20h20" />,
  announcements: <path d="M4 10v4h3l7 4V6L7 10zM17.5 9.5a4 4 0 0 1 0 5" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
    </>
  ),
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  flame: <path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z" />,
} as const

export type IconName = keyof typeof ICON_PATHS

/** Icônes du design (trait de 2 px, couleur du texte). Décoratives : le texte voisin porte le sens. */
export function Icon({ name, className = 'h-[22px] w-[22px]' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

/** Grand titre de page (Big Shoulders Display). */
export function PageTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h1 className={`font-display text-[56px] leading-[0.9] font-black sm:text-[72px] ${className}`}>{children}</h1>
}

/** Titre de section (Big Shoulders Display). */
export function SectionTitle({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`font-display text-[30px] leading-none font-extrabold sm:text-4xl ${className}`}>
      {children}
    </h2>
  )
}
