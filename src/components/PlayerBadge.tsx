import { getInitials } from '../lib/initials.ts'

type Props = { fullName: string }

/** Pastille avec les initiales du joueur ; le nom complet s'affiche au survol. */
export function PlayerBadge({ fullName }: Props) {
  return (
    <span
      title={fullName}
      aria-label={fullName}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-court text-sm font-semibold text-chalk"
    >
      {getInitials(fullName)}
    </span>
  )
}
