import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { prepareTournamentGame } from '../darts/launch.ts'
import { tiebreakRights } from '../../lib/scores.ts'
import { submitTiebreak } from './api.ts'
import type { Viewer } from './MatchDialog.tsx'
import type { Pool, PoolTiebreak, TournamentBundle } from './types.ts'

type Props = {
  bundle: TournamentBundle
  pool: Pool
  /** Joueurs à égalité. */
  group: string[]
  existing: PoolTiebreak | null
  viewer: Viewer
  onClose: () => void
  onSaved: () => Promise<void>
}

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Saisie du classement d'un départage : partie de fléchettes à plusieurs, ou décision de l'admin. */
export function TiebreakDialog({ bundle, pool, group, existing, viewer, onClose, onSaved }: Props) {
  const { tournament, players } = bundle
  const name = (id: string) => players.get(id)?.full_name ?? 'Joueur inconnu'
  const [order, setOrder] = useState<string[]>(() =>
    existing ? [...existing.ranking] : [...group].sort((a, b) => name(a).localeCompare(name(b), 'fr')),
  )
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const rights = tiebreakRights(
    tournament.discipline,
    group,
    existing
      ? { resultBy: existing.result_by, resultByAdmin: existing.result_by_admin, resultFirstAt: existing.result_first_at }
      : null,
    viewer,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const move = (index: number, delta: number) =>
    setOrder((current) => {
      const next = [...current]
      ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
      return next
    })

  /** Partie à plusieurs au compteur, ordre de jeu tiré au sort, format des poules. */
  function playWithCounter() {
    const poolRound = bundle.rounds.find((r) => r.bracket === 'pool')
    if (!poolRound) return
    const ready = prepareTournamentGame({
      kind: 'tiebreak',
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      label: `Départage poule ${pool.label}`,
      poolId: pool.id,
      start: poolRound.dart_start === 501 ? 501 : 301,
      doubleOut: poolRound.dart_double_out,
      players: group.map((id) => ({ playerId: id, name: name(id) })),
    })
    if (ready) navigate('/compteur')
  }

  async function save() {
    const summary = order.map((id, i) => `${i + 1}. ${name(id)}`).join('\n')
    if (!window.confirm(`Enregistrer ce classement ?\n\n${summary}`)) return
    setBusy(true)
    setError(null)
    try {
      await submitTiebreak(pool.id, order)
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const isDarts = tournament.discipline === 'darts'
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tiebreak-title"
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 border-t-4 border-black sm:border-2 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="tiebreak-title" className="text-lg font-bold text-court">
              Départage — Poule {pool.label}
            </h2>
            <p className="text-sm text-muted">
              {isDarts
                ? 'Partie de fléchettes à plusieurs entre les joueurs à égalité : saisis le classement complet.'
                : "Égalité parfaite (victoires, confrontations, sets et points) : l'admin fixe le classement."}
            </p>
          </div>
          <SecondaryButton onClick={onClose} ariaLabel="Fermer">
            ✕
          </SecondaryButton>
        </header>

        <ol className="space-y-2">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-xl bg-chalk px-3 py-2">
              <span className="w-6 text-center font-bold text-court">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{name(id)}</span>
              {rights.canEdit && (
                <span className="flex gap-1">
                  <SecondaryButton ariaLabel={`Monter ${name(id)}`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </SecondaryButton>
                  <SecondaryButton
                    ariaLabel={`Descendre ${name(id)}`}
                    disabled={busy || i === order.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </SecondaryButton>
                </span>
              )}
            </li>
          ))}
        </ol>

        {existing && (
          <p className="text-xs text-muted">
            Saisi {existing.result_by && bundle.authors.get(existing.result_by) ? `par ${bundle.authors.get(existing.result_by)}` : ''}
            {existing.result_by_admin ? ' (admin)' : ''} à {timeFormat.format(new Date(existing.result_at))}
          </p>
        )}
        {!rights.canEdit && rights.reason && <Notice>{rights.reason}</Notice>}
        {rights.canEdit && rights.deadline && (
          <p className="text-xs text-muted">Correction possible jusqu'à {timeFormat.format(rights.deadline)}.</p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {isDarts && rights.canEdit && !existing && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={playWithCounter}
              disabled={busy}
              className="w-full rounded-xl bg-ochre px-4 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              Jouer le départage au compteur
            </button>
            <p className="text-center text-xs text-muted">
              Ordre de jeu tiré au sort, partie jouée jusqu'au bout. Ou enregistre le classement ci-dessus à la main.
            </p>
          </div>
        )}
        {rights.canEdit && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="w-full rounded-xl bg-court px-4 py-3 font-semibold text-chalk transition hover:bg-court-light disabled:opacity-60"
          >
            {busy ? 'Patiente…' : 'Enregistrer le classement'}
          </button>
        )}
      </div>
    </div>
  )
}
