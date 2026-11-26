import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DemoModeNotice, Notice, PageTitle, PrimaryButton, SectionTitle } from '../components/ui.tsx'
import { isAdmin, useAuth } from '../features/auth/AuthContext.ts'
import { createTournament, listTournaments } from '../features/tournaments/api.ts'
import { TournamentForm } from '../features/tournaments/TournamentForm.tsx'
import {
  DISCIPLINE_LABELS,
  EMPTY_TOURNAMENT,
  FORMAT_LABELS,
  STATUS_LABELS,
  type Tournament,
  type TournamentStatus,
} from '../features/tournaments/types.ts'

const SECTIONS: { status: TournamentStatus; title: string }[] = [
  { status: 'in_progress', title: 'En cours' },
  { status: 'draft', title: 'Brouillons, visibles par toi seul' },
  { status: 'finished', title: 'Terminés' },
  { status: 'archived', title: 'Archivés' },
]

export function TournamentsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const admin = isAdmin(auth)
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(admin && params.get('nouveau') === '1')

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
        <PageTitle>Tournois</PageTitle>
        <DemoModeNotice />
      </section>
    )
  }

  const list = (status: TournamentStatus) => (tournaments ?? []).filter((t) => t.status === status)

  return (
    <section className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle className="lg:text-[120px]">Tournois</PageTitle>
        {admin && !creating && (
          <div className="w-full sm:w-auto">
            <PrimaryButton type="button" onClick={() => setCreating(true)}>
              Créer un tournoi
            </PrimaryButton>
          </div>
        )}
      </div>

      {creating && (
        <section className="space-y-4 border-2 border-black bg-mist p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>Nouveau tournoi</SectionTitle>
            <button type="button" className="min-h-11 text-[15px] font-semibold underline" onClick={() => setCreating(false)}>
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
        <p>Chargement…</p>
      ) : tournaments.length === 0 ? (
        <p className="border-2 border-dashed border-black p-6 text-[17px]">
          Aucun tournoi pour le moment. {admin ? 'Crée le premier avec « Créer un tournoi ».' : 'Reviens bientôt.'}
        </p>
      ) : (
        <>
          {list('in_progress').length > 0 && (
            <ul aria-label="Tournois en cours" className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {list('in_progress').map((t) => (
                <li key={t.id}>
                  <Poster tournament={t} />
                </li>
              ))}
            </ul>
          )}
          {SECTIONS.filter((s) => s.status !== 'in_progress').map(({ status, title }) =>
            list(status).length === 0 ? null : (
              <section key={status} className="space-y-3.5">
                <SectionTitle>{title}</SectionTitle>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list(status).map((t) => (
                    <li key={t.id}>
                      <Link
                        to={`/tournois/${t.id}`}
                        className={`flex flex-col gap-1.5 border-2 border-black p-5 text-black hover:bg-mist ${
                          status === 'archived' ? 'border-dashed text-muted' : ''
                        } ${status === 'draft' ? 'bg-mist' : ''}`}
                      >
                        <span className="text-sm font-semibold">
                          {DISCIPLINE_LABELS[t.discipline]}, {STATUS_LABELS[t.status].toLowerCase()}
                        </span>
                        <span className="font-display text-[32px] leading-none font-extrabold">{t.name}</span>
                        <span className="text-[15px]">{FORMAT_LABELS[t.format]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </>
      )}
    </section>
  )
}

/** Affiche d'un tournoi en cours : mini-pong en noir, fléchettes en ocre. */
function Poster({ tournament: t }: { tournament: Tournament }) {
  return (
    <Link
      to={`/tournois/${t.id}`}
      className={`group flex min-h-[260px] flex-col gap-4 p-6 text-white sm:min-h-[340px] sm:p-10 ${
        t.discipline === 'mini_pong' ? 'bg-black' : 'bg-ochre'
      }`}
    >
      <span className="flex justify-between gap-3 text-base font-semibold">
        <span>{DISCIPLINE_LABELS[t.discipline]}</span>
        <span className={t.discipline === 'mini_pong' ? 'text-ochre-light' : ''}>En cours</span>
      </span>
      <span className="mt-auto font-display text-[52px] leading-[0.86] font-black group-hover:underline group-hover:decoration-[3px] group-hover:underline-offset-[6px] sm:text-[80px]">
        {t.name}
      </span>
      <span className="text-[17px]">{FORMAT_LABELS[t.format]}</span>
    </Link>
  )
}
