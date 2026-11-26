import { useEffect, useState, type ReactNode } from 'react'
import { Notice, PrimaryButton, SecondaryButton } from '../../components/ui.tsx'
import { validateDrawConfig } from '../../lib/draw/plan.ts'
import {
  addEntry,
  computeDraw,
  createNextQualificationRound,
  deleteTournament,
  drawConfigOf,
  forfeitPlayer,
  generateFinalPhase,
  generateQualificationFinal,
  launchTournament,
  listDisabledPlayersWithPendingMatches,
  removeEntry,
  replacePlayer,
  resetFinalPhase,
  resetTournament,
  setTournamentStatus,
  swapQualificationBye,
  updateRoundFormat,
  updateTournament,
} from './api.ts'
import { sortRounds } from './display.ts'
import { PeoplePicker } from './PeoplePicker.tsx'
import { computeQualificationFinal, qualificationMatches, qualificationRounds, qualificationStandings } from './qualification.ts'
import { computeFinalPhase } from './standings.ts'
import { TournamentForm } from './TournamentForm.tsx'
import { NEXT_STAGE_LABELS, PAIRING_LABELS, type Round, type TournamentBundle, type TournamentStatus } from './types.ts'

type Props = {
  bundle: TournamentBundle
  reload: () => Promise<void>
  onDeleted: () => void
}

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">{title}</h2>
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
  const [disabled, setDisabled] = useState<{ player_id: string; full_name: string; pending_matches: number }[]>([])

  const isDraft = tournament.status === 'draft'
  const isRunning = tournament.status === 'in_progress'

  // Comptes désactivés qui ont encore des matchs à jouer ici (relu à chaque rechargement du tournoi).
  useEffect(() => {
    if (!isRunning) return
    let cancelled = false
    listDisabledPlayersWithPendingMatches()
      .then((rows) => {
        if (!cancelled) setDisabled(rows.filter((r) => r.tournament_id === tournament.id))
      })
      .catch(() => {
        if (!cancelled) setDisabled([])
      })
    return () => {
      cancelled = true
    }
  }, [bundle, isRunning, tournament.id])
  const hasResults = matches.some((m) => ['played', 'walkover', 'cancelled'].includes(m.status))
  const enteredIds = new Set(entries.map((e) => e.player_id))
  const name = (id: string) => players.get(id)?.full_name ?? 'Joueur inconnu'
  const sortedEntries = [...entries].sort((a, b) => name(a.player_id).localeCompare(name(b.player_id), 'fr'))
  const configError = validateDrawConfig(drawConfigOf(tournament), entries.length)
  const hasPools = tournament.format === 'pools_knockout'
  const hasQualification = tournament.format === 'qualification_knockout'
  const finalRounds = rounds.filter((r) => r.bracket === 'main' || r.bracket === 'third_place' || r.bracket === 'consolation')
  const finalPhaseExists = finalRounds.length > 0
  const finalPhaseHasResults = matches.some(
    (m) => finalRounds.some((r) => r.id === m.round_id) && ['played', 'walkover', 'cancelled'].includes(m.status),
  )
  const finalPhase =
    isRunning && !finalPhaseExists
      ? hasPools
        ? computeFinalPhase(bundle)
        : hasQualification
          ? computeQualificationFinal(bundle)
          : null
      : null
  const firstPhase = hasQualification ? 'qualification' : 'poule'

  function generate() {
    if (!finalPhase?.ok) return
    const notes = finalPhase.draw.notes.length ? `\n\nÀ noter :\n• ${finalPhase.draw.notes.join('\n• ')}` : ''
    const placement = hasQualification
      ? NEXT_STAGE_LABELS[tournament.qualification_next_stage ?? 'preliminary'].toLowerCase()
      : tournament.qualifier_placement === 'classic'
        ? 'croisement classique'
        : 'tirage au sort'
    if (
      !window.confirm(
        `Générer la phase finale (${placement}) ? Les résultats de ${firstPhase} seront figés tant qu'elle existe.${notes}`,
      )
    )
      return
    void run(
      () => (hasQualification ? generateQualificationFinal : generateFinalPhase)(tournament.id, finalPhase.draw),
      `Phase finale générée : voir l’onglet « ${hasQualification ? 'Tableau' : 'Phase finale'} ».`,
    )
  }

  // Qualification : exempts encore modifiables (l'exempté n'a pas joué depuis) et joueurs éligibles.
  const standings = hasQualification ? qualificationStandings(bundle) : null
  const recordOf = new Map((standings?.rows ?? []).map((r) => [r.playerId, r]))
  const qRounds = qualificationRounds(bundle)
  const qMatches = qualificationMatches(bundle)
  const roundNumberOf = new Map(qRounds.map((r) => [r.id, r.round_number]))
  const swappableByes = qMatches
    .filter((m) => m.status === 'bye' && m.home_player_id)
    .filter((bye) => {
      const n = roundNumberOf.get(bye.round_id) ?? 0
      return !qMatches.some(
        (m) => (roundNumberOf.get(m.round_id) ?? 0) > n && [m.home_player_id, m.away_player_id].includes(bye.home_player_id),
      )
    })
    .map((bye) => {
      const holder = recordOf.get(bye.home_player_id as string)
      const candidates = qMatches
        .filter((m) => m.round_id === bye.round_id && m.status === 'pending')
        .flatMap((m) => [m.home_player_id, m.away_player_id])
        .filter((id): id is string => {
          const r = id ? recordOf.get(id) : undefined
          return Boolean(r && holder && r.wins === holder.wins - 1 && r.losses === holder.losses)
        })
      return { bye, candidates, roundName: qRounds.find((r) => r.id === bye.round_id)?.name ?? '' }
    })
    .filter((b) => b.candidates.length > 0)
  const [byeChoice, setByeChoice] = useState<Record<string, string>>({})

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
            <p className="text-sm text-muted">Aucun joueur pour le moment.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {sortedEntries.map((e) => (
                <li key={e.player_id} className="flex items-center gap-2 rounded-full bg-mist py-1 pr-1 pl-3 text-sm">
                  {name(e.player_id)}
                  {!players.get(e.player_id)?.profile_id && <span className="text-xs text-muted">(nom seul)</span>}
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
          <p className="text-sm text-muted">
            Le tirage au sort place les joueurs (exempts, poules, domicile/extérieur). Tant qu'aucun match n'est joué, tu
            pourras refaire le tirage ou revenir en brouillon.
          </p>
          {configError ? (
            <Notice>{configError}</Notice>
          ) : (
            <PrimaryButton type="button" busy={busy} onClick={() => draw(false)}>
              Lancer le tournoi ({entries.length} joueurs)
            </PrimaryButton>
          )}
        </Card>
      )}

      {!isDraft && rounds.length > 0 && (
        <Card title="Format de jeu par tour">
          <ul className="divide-y divide-black">
            {sortRounds(rounds).map((round) => {
              const update = (change: Partial<Pick<Round, 'sets_to_win' | 'dart_start' | 'dart_double_out'>>) =>
                run(() =>
                  updateRoundFormat(round.id, {
                    sets_to_win: round.sets_to_win,
                    dart_start: round.dart_start,
                    dart_double_out: round.dart_double_out,
                    ...change,
                  }),
                )
              const legsLabel = (n: number) =>
                tournament.discipline === 'darts'
                  ? n === 1
                    ? '1 manche gagnante'
                    : `${n} manches gagnantes`
                  : n === 1
                    ? '1 set gagnant'
                    : `${n} sets gagnants`
              // Verrouillé dès qu'un match du tour est joué (score ou forfait) : règle appliquée aussi par la base.
              const locked = matches.some((m) => m.round_id === round.id && ['played', 'walkover'].includes(m.status))
              return (
                <li key={round.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
                  <span className="text-sm">
                    {round.name}
                    {locked && <span className="block text-xs text-muted">Figé : un match de ce tour est joué.</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {tournament.discipline === 'darts' && (
                      <select
                        aria-label={`Départ — ${round.name}`}
                        className="rounded-lg border border-black px-2 py-1.5 text-sm"
                        value={round.dart_start}
                        disabled={busy || locked}
                        onChange={(e) => update({ dart_start: Number(e.target.value) })}
                      >
                        {[301, 501].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      aria-label={`${tournament.discipline === 'darts' ? 'Manches' : 'Sets'} — ${round.name}`}
                      className="rounded-lg border border-black px-2 py-1.5 text-sm"
                      value={round.sets_to_win}
                      disabled={busy || locked}
                      onChange={(e) => update({ sets_to_win: Number(e.target.value) })}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {legsLabel(n)}
                        </option>
                      ))}
                    </select>
                    {tournament.discipline === 'darts' && (
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-court"
                          checked={round.dart_double_out}
                          disabled={busy || locked}
                          onChange={(e) => update({ dart_double_out: e.target.checked })}
                        />
                        Sortie double
                      </label>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          {(hasPools || hasQualification) && !finalPhaseExists && (
            <p className="text-xs text-muted">Les tours de la phase finale apparaîtront ici une fois celle-ci générée.</p>
          )}
        </Card>
      )}

      {hasQualification && isRunning && !finalPhaseExists && (
        <Card title="Qualification">
          <p className="text-sm text-muted">
            {tournament.qualification_wins} victoire{(tournament.qualification_wins ?? 1) > 1 ? 's' : ''} pour se
            qualifier, {tournament.qualification_losses} défaite{(tournament.qualification_losses ?? 1) > 1 ? 's' : ''}{' '}
            pour être éliminé. Création des matchs : {PAIRING_LABELS[tournament.qualification_pairing ?? 'continuous'].toLowerCase()}.
          </p>
          {tournament.qualification_pairing === 'manual' && (
            <PrimaryButton
              type="button"
              busy={busy}
              onClick={() =>
                void run(async () => {
                  const count = await createNextQualificationRound(tournament.id)
                  setMessage(`Round suivant créé : ${count} match${count > 1 ? 's' : ''} (exempts compris).`)
                })
              }
            >
              Créer le round suivant
            </PrimaryButton>
          )}
          {swappableByes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[15px] font-semibold">Changer l’exempté</h3>
              <p className="text-sm text-muted">
                L’exempt est tiré au sort. Tu peux le donner à un autre joueur de même bilan dont le match du round n’est
                pas encore joué (par exemple un volontaire) : l’ancien exempté prend sa place dans ce match.
              </p>
              {swappableByes.map(({ bye, candidates, roundName }) => (
                <div key={bye.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="text-sm">
                    {roundName} : <span className="font-semibold">{name(bye.home_player_id as string)}</span>
                  </span>
                  <select
                    aria-label={`Nouvel exempté — ${roundName}`}
                    className="min-h-11 border-2 border-black bg-white px-2 text-[15px]"
                    value={byeChoice[bye.id] ?? ''}
                    onChange={(e) => setByeChoice((c) => ({ ...c, [bye.id]: e.target.value }))}
                  >
                    <option value="">Choisis le nouvel exempté</option>
                    {candidates.map((id) => (
                      <option key={id} value={id}>
                        {name(id)}
                      </option>
                    ))}
                  </select>
                  <SecondaryButton
                    disabled={busy || !byeChoice[bye.id]}
                    onClick={() => {
                      const target = byeChoice[bye.id]
                      if (!target) return
                      if (!window.confirm(`Donner l’exemption à ${name(target)} ? ${name(bye.home_player_id as string)} jouera son match à sa place.`))
                        return
                      void run(() => swapQualificationBye(bye.id, target), `Exemption donnée à ${name(target)}.`)
                    }}
                  >
                    Donner l’exemption
                  </SecondaryButton>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {(hasPools || hasQualification) && isRunning && (
        <Card title="Phase finale">
          {finalPhaseExists ? (
            <>
              <p className="text-sm text-muted">
                Phase finale générée. Les résultats {hasQualification ? 'de qualification' : 'et départages de poule'} sont
                figés.
              </p>
              {finalPhaseHasResults ? (
                <p className="text-sm text-muted">Un match de la phase finale est joué : elle ne peut plus être annulée.</p>
              ) : (
                <SecondaryButton
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Annuler la phase finale ? Le tableau sera effacé et ${hasQualification ? 'la qualification redeviendra modifiable' : 'les poules redeviendront modifiables'}. Tu pourras la générer à nouveau.`,
                      )
                    )
                      void run(() => resetFinalPhase(tournament.id), 'Phase finale annulée.')
                  }}
                >
                  Annuler la phase finale
                </SecondaryButton>
              )}
            </>
          ) : finalPhase?.ok ? (
            <>
              {hasQualification ? (
                <p className="text-sm text-muted">
                  Qualification terminée : {qualificationStandings(bundle)?.qualified.length ?? 0} qualifiés. Étape
                  avant le tableau : {NEXT_STAGE_LABELS[tournament.qualification_next_stage ?? 'preliminary'].toLowerCase()}.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Toutes les poules sont terminées et départagées. Placement des qualifiés :{' '}
                  {tournament.qualifier_placement === 'classic' ? 'croisement classique' : 'tirage au sort'} (modifiable
                  dans « Nom et description » avant de générer).
                </p>
              )}
              <PrimaryButton type="button" busy={busy} onClick={generate}>
                Générer la phase finale
              </PrimaryButton>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Avant de pouvoir générer la phase finale :</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {(finalPhase && !finalPhase.ok ? finalPhase.problems : []).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {isRunning && disabled.length > 0 && (
        <Card title="Comptes désactivés ou supprimés">
          <p className="text-sm text-muted">
            Ces joueurs ont un compte désactivé ou supprimé mais encore des matchs à jouer. Remplace-les, ou déclare-les forfait sur
            tous leurs matchs non joués.
          </p>
          <ul className="divide-y divide-black">
            {disabled.map((d) => (
              <li key={d.player_id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm">
                  <span className="font-semibold">{d.full_name}</span> · {d.pending_matches} match
                  {d.pending_matches > 1 ? 's' : ''} à jouer
                </span>
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => {
                      setReplacing(d.player_id)
                      document.getElementById('remplacer-un-joueur')?.scrollIntoView({ behavior: 'smooth' })
                    }}
                  >
                    Remplacer
                  </SecondaryButton>
                  <SecondaryButton
                    danger
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Déclarer ${d.full_name} forfait sur tous ses matchs non joués ? Ses adversaires seront qualifiés.`,
                        )
                      )
                        void run(async () => {
                          const count = await forfeitPlayer(tournament.id, d.player_id)
                          setMessage(`${d.full_name} : forfait sur ${count} match${count > 1 ? 's' : ''}.`)
                        })
                    }}
                  >
                    Déclarer forfait
                  </SecondaryButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isRunning && (
        <Card title="Remplacer un joueur" id="remplacer-un-joueur">
          <p className="text-sm text-muted">
            Le remplaçant reprend la place du joueur dans tous ses matchs non joués. Les matchs déjà joués restent au nom
            de l'ancien joueur.
            {hasQualification && !finalPhaseExists
              ? ' Pendant la qualification, seulement pour un joueur sans résultat (sinon, déclare-le forfait).'
              : ''}
          </p>
          <select
            aria-label="Joueur à remplacer"
            className="w-full rounded-xl border border-black px-3 py-2.5 text-base"
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
            <p className="text-sm text-muted">Des matchs ont été joués : le tirage ne peut plus être refait.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                Aucun match n'est encore joué. Pour ajouter ou retirer des joueurs, reviens en brouillon puis relance.
              </p>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton disabled={busy} onClick={() => draw(true)}>
                  Refaire le tirage
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
              Clôturer
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
                Archiver
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
