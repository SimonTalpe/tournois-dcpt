import type { ReactNode } from 'react'

type Props = {
  title: string
  /** Étape de la roadmap où la page sera construite. */
  plannedStep: string
  children?: ReactNode
}

/** Page provisoire affichée tant qu'une fonctionnalité n'est pas construite. */
export function PlaceholderPage({ title, plannedStep, children }: Props) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold text-court">{title}</h1>
      <div className="rounded-2xl border border-dashed border-court/30 bg-white p-6 text-ink/70">
        <p>🚧 Page en construction — prévue à l'{plannedStep}.</p>
        {children}
      </div>
    </section>
  )
}
