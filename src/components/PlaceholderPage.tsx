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
      <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">{title}</h1>
      <div className="rounded-2xl border border-dashed border-black bg-white p-6 text-muted">
        <p>Page en construction — prévue à l'{plannedStep}.</p>
        {children}
      </div>
    </section>
  )
}
