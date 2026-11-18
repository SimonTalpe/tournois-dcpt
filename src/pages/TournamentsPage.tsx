import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { DemoModeNotice, Notice, PrimaryButton } from '../components/ui.tsx'
import { isAdmin, useAuth } from '../features/auth/AuthContext.ts'
import { createTournament, listTournaments } from '../features/tournaments/api.ts'
import { TournamentForm } from '../features/tournaments/TournamentForm.tsx'
import {
  DISCIPLINE_ICONS,
  DISCIPLINE_LABELS,
  EMPTY_TOURNAMENT,
  FORMAT_LABELS,
  STATUS_LABELS,
  type Tournament,
  type TournamentStatus,
} from '../features/tournaments/types.ts'

const SECTIONS: { status: TournamentStatus; title: string }[] = [
  { status: 'in_progress', title: 'En cours' },
  { status: 'draft', title: 'Brouillons (visibles par toi seul)' },
  { status: 'finished', title: 'Terminés' },
  { status: 'archived', title: 'Archivés' },
]

export function TournamentsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const admin = isAdmin(auth)
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setTournaments(await listTournaments())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (auth.demoMode) return
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load, auth.demoMode])

  if (auth.demoMode) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-court">Tournois</h1>
        <DemoModeNotice />
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-court">Tournois</h1>
        {admin && !creating && (
          <div className="w-auto">
            <PrimaryButton type="button" onClick={() => setCreating(true)}>
              + Nouveau
            </PrimaryButton>
          </div>
        )}
      </div>

      {creating && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-court">Nouveau tournoi</h2>
            <button type="button" className="text-sm text-ink/60 underline" onClick={() => setCreating(false)}>
              Annuler
            </button>
          </div>
          <TournamentForm
            initial={EMPTY_TOURNAMENT}
            submitLabel="Créer le tournoi (brouillon)"
            onSubmit={async (input) => {
              const id = await createTournament(input)
              navigate(`/tournois/${id}?onglet=gestion`)
            }}
          />
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!tournaments ? (
        <p className="text-ink/60">Chargement…</p>
      ) : tournaments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-court/30 bg-white p-6 text-ink/70">
          Aucun tournoi pour le moment. {admin ? 'Crée le premier avec « + Nouveau ».' : 'Reviens bientôt !'}
        </div>
      ) : (
        SECTIONS.map(({ status, title }) => {
          const list = tournaments.filter((t) => t.status === status)
          if (list.length === 0) return null
          return (
            <section key={status} className="space-y-2">
              <h2 className="text-sm font-semibold tracking-wide text-ink/60 uppercase">{title}</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {list.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={`/tournois/${t.id}`}
                      className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-md"
                    >
                      <span className="text-3xl" aria-hidden="true">
                        {DISCIPLINE_ICONS[t.discipline]}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-court">{t.name}</span>
                        <span className="block text-sm text-ink/60">
                          {DISCIPLINE_LABELS[t.discipline]} · {FORMAT_LABELS[t.format]}
                        </span>
                        {status !== 'in_progress' && (
                          <span className="text-xs text-ink/50">{STATUS_LABELS[t.status]}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </section>
  )
}
