import { useState, type ReactNode } from 'react'
import { Notice, PrimaryButton, SecondaryButton } from '../../components/ui.tsx'
import { validateDrawConfig } from '../../lib/draw/plan.ts'
import {
  addEntry,
  computeDraw,
  deleteTournament,
  drawConfigOf,
  launchTournament,
  removeEntry,
  replacePlayer,
  resetTournament,
  setTournamentStatus,
  updateRoundFormat,
  updateTournament,
} from './api.ts'
import { sortRounds } from './display.ts'
import { PeoplePicker } from './PeoplePicker.tsx'
import { TournamentForm } from './TournamentForm.tsx'
import type { TournamentBundle, TournamentStatus } from './types.ts'

type Props = {
  bundle: TournamentBundle
  reload: () => Promise<void>
  onDeleted: () => void
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-court">{title}</h2>
      {children}
    </section>
  )
}

/** Gestion d'un tournoi par l'admin : configuration, inscriptions, tirage, formats par tour, statut. */
export function TournamentAdmin({ bundle, reload, onDeleted }: Props) {
  const { tournament, entries, players, rounds, matches } = bundle
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState<string>('')

  const isDraft = tournament.status === 'draft'
  const isRunning = tournament.status === 'in_progress'
  const hasResults = matches.some((m) => ['played', 'walkover', 'cancelled'].includes(m.status))
  const enteredIds = new Set(entries.map((e) => e.player_id))
  const name = (id: string) => players.get(id)?.full_name ?? 'Joueur inconnu'
  const sortedEntries = [...entries].sort((a, b) => name(a.player_id).localeCompare(name(b.player_id), 'fr'))
  const configError = validateDrawConfig(drawConfigOf(tournament), entries.length)

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      if (success) setMessage(success)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function draw(again: boolean) {
    let result: ReturnType<typeof computeDraw>
    try {
      result = computeDraw(bundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    const intro = again
      ? 'Refaire le tirage ? Tout le tableau actuel sera remplacé par un nouveau tirage au sort.'
      : `Lancer « ${tournament.name} » avec ${entries.length} joueurs ? Le tirage au sort va être effectué et le tournoi deviendra visible de tous.`
    const notes = result.notes.length ? `\n\nÀ noter :\n• ${result.notes.join('\n• ')}` : ''
    if (!window.confirm(intro + notes)) return
    void run(
      () => launchTournament(tournament.id, result),
      again ? 'Nouveau tirage effectué.' : 'Tournoi lancé ! Le tirage est visible dans les onglets.',
    )
  }

  function changeStatus(status: TournamentStatus, confirmText: string, success: string) {
    if (!window.confirm(confirmText)) return
    void run(() => setTournamentStatus(tournament.id, status), success)
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      {isDraft && (
        <Card title={`Joueurs inscrits (${entries.length})`}>
          {sortedEntries.length === 0 ? (
            <p className="text-sm text-ink/60">Aucun joueur pour le moment.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {sortedEntries.map((e) => (
                <li key={e.player_id} className="flex items-center gap-2 rounded-full bg-court/10 py-1 pr-1 pl-3 text-sm">
                  {name(e.player_id)}
                  {!players.get(e.player_id)?.profile_id && <span className="text-xs text-ink/50">(nom seul)</span>}
                  <SecondaryButton
                    danger
                    ariaLabel={`Désinscrire ${name(e.player_id)}`}
                    disabled={busy}
                    onClick={() => run(() => removeEntry(tournament.id, e.player_id))}
                  >
                    ✕
                  </SecondaryButton>
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-sm font-semibold">Ajouter un joueur</h3>
          <PeoplePicker
            excludedPlayerIds={enteredIds}
            actionLabel="Inscrire"
            onPick={async (playerId) => {
              await addEntry(tournament.id, playerId)
              await reload()
            }}
          />
        </Card>
      )}

      {isDraft && (
        <Card title="Lancement">
          <p className="text-sm text-ink/70">
            Le tirage au sort place les joueurs (exempts, poules, domicile/extérieur). Tant qu'aucun match n'est joué, tu
            pourras refaire le tirage ou revenir en brouillon.
          </p>
          {configError ? (
            <Notice>{configError}</Notice>
          ) : (
            <PrimaryButton type="button" busy={busy} onClick={() => draw(false)}>
              🎲 Lancer le tournoi ({entries.length} joueurs)
            </PrimaryButton>
          )}
        </Card>
      )}

      {!isDraft && rounds.length > 0 && (
        <Card title="Format de jeu par tour">
          <ul className="divide-y divide-ink/10">
            {sortRounds(rounds).map((round) => (
              <li key={round.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{round.name}</span>
                {tournament.discipline === 'mini_pong' ? (
                  <select
                    aria-label={`Format — ${round.name}`}
                    className="rounded-lg border border-ink/20 px-2 py-1.5 text-sm"
                    value={round.sets_to_win}
                    disabled={busy}
                    onChange={(e) =>
                      run(() => updateRoundFormat(round.id, { sets_to_win: Number(e.target.value), dart_start: round.dart_start }))
                    }
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 set gagnant' : `${n} sets gagnants`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    aria-label={`Format — ${round.name}`}
                    className="rounded-lg border border-ink/20 px-2 py-1.5 text-sm"
                    value={round.dart_start}
                    disabled={busy}
                    onChange={(e) =>
                      run(() => updateRoundFormat(round.id, { sets_to_win: round.sets_to_win, dart_start: Number(e.target.value) }))
                    }
                  >
                    {[301, 501].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
          {tournament.format === 'pools_knockout' && (
            <p className="text-xs text-ink/60">Les tours de la phase finale apparaîtront ici une fois celle-ci générée.</p>
          )}
        </Card>
      )}

      {isRunning && (
        <Card title="Remplacer un joueur">
          <p className="text-sm text-ink/70">
            Le remplaçant reprend la place du joueur dans tous ses matchs non joués. Les matchs déjà joués restent au nom
            de l'ancien joueur.
          </p>
          <select
            aria-label="Joueur à remplacer"
            className="w-full rounded-xl border border-ink/20 px-3 py-2.5 text-base"
            value={replacing}
            onChange={(e) => setReplacing(e.target.value)}
          >
            <option value="">— Choisis le joueur à remplacer —</option>
            {sortedEntries.map((e) => (
              <option key={e.player_id} value={e.player_id}>
                {name(e.player_id)}
              </option>
            ))}
          </select>
          {replacing && (
            <PeoplePicker
              excludedPlayerIds={enteredIds}
              actionLabel="Remplacer"
              confirmPick={(label) =>
                window.confirm(`Remplacer ${name(replacing)} par ${label} dans ses matchs non joués ?`)
              }
              onPick={async (playerId, newName) => {
                const old = name(replacing)
                await replacePlayer(tournament.id, replacing, playerId)
                setReplacing('')
                setMessage(`${old} remplacé par ${newName}.`)
                await reload()
              }}
            />
          )}
        </Card>
      )}

      {isRunning && (
        <Card title="Tirage">
          {hasResults ? (
            <p className="text-sm text-ink/70">Des matchs ont été joués : le tirage ne peut plus être refait.</p>
          ) : (
            <>
              <p className="text-sm text-ink/70">
                Aucun match n'est encore joué. Pour ajouter ou retirer des joueurs, reviens en brouillon puis relance.
              </p>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton disabled={busy} onClick={() => draw(true)}>
                  🎲 Refaire le tirage
                </SecondaryButton>
                <SecondaryButton
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Revenir en brouillon ? Le tirage sera effacé et le tournoi masqué aux joueurs.'))
                      void run(() => resetTournament(tournament.id), 'Tournoi revenu en brouillon.')
                  }}
                >
                  Revenir en brouillon
                </SecondaryButton>
              </div>
            </>
          )}
        </Card>
      )}

      <Card title={isDraft ? 'Configuration' : 'Nom et description'}>
        <TournamentForm
          key={tournament.id + tournament.status}
          initial={tournament}
          structureLocked={!isDraft}
          submitLabel="Enregistrer"
          onSubmit={async (input) => {
            await updateTournament(tournament.id, input, !isDraft)
            setMessage('Modifications enregistrées.')
            await reload()
          }}
        />
      </Card>

      <Card title="Statut et suppression">
        <div className="flex flex-wrap gap-2">
          {tournament.status === 'in_progress' && (
            <SecondaryButton
              disabled={busy}
              onClick={() => changeStatus('finished', 'Clôturer le tournoi ?', 'Tournoi terminé.')}
            >
              🏁 Clôturer
            </SecondaryButton>
          )}
          {tournament.status === 'finished' && (
            <>
              <SecondaryButton disabled={busy} onClick={() => changeStatus('in_progress', 'Rouvrir le tournoi ?', 'Tournoi rouvert.')}>
                Rouvrir
              </SecondaryButton>
              <SecondaryButton
                disabled={busy}
                onClick={() => changeStatus('archived', 'Archiver le tournoi ? Il restera consultable.', 'Tournoi archivé.')}
              >
                🗄️ Archiver
              </SecondaryButton>
            </>
          )}
          {tournament.status === 'archived' && (
            <SecondaryButton disabled={busy} onClick={() => changeStatus('finished', 'Désarchiver le tournoi ?', 'Tournoi désarchivé.')}>
              Désarchiver
            </SecondaryButton>
          )}
          <SecondaryButton
            danger
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Supprimer définitivement « ${tournament.name} » et tous ses matchs ? C'est irréversible.`)) return
              setBusy(true)
              deleteTournament(tournament.id)
                .then(onDeleted)
                .catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : String(e))
                  setBusy(false)
                })
            }}
          >
            Supprimer le tournoi
          </SecondaryButton>
        </div>
      </Card>
    </div>
  )
}
