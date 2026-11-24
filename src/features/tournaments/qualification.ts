import { buildQualificationFinal, type DrawResult } from '../../lib/draw/plan.ts'
import {
  computeQualification,
  expectedQualifierCount,
  preliminaryByeCount,
  type QualificationStandings,
} from '../../lib/qualification.ts'
import type { Match, Round, TournamentBundle } from './types.ts'

/** Tours de qualification, dans l'ordre. */
export function qualificationRounds(bundle: TournamentBundle): Round[] {
  return bundle.rounds.filter((r) => r.bracket === 'qualification').sort((a, b) => a.round_number - b.round_number)
}

/** Matchs (et exempts) de qualification, round par round. */
export function qualificationMatches(bundle: TournamentBundle): Match[] {
  const order = new Map(qualificationRounds(bundle).map((r) => [r.id, r.round_number]))
  return bundle.matches
    .filter((m) => order.has(m.round_id))
    .sort((a, b) => (order.get(a.round_id) as number) - (order.get(b.round_id) as number) || a.position - b.position)
}

/** Classement de la qualification (null hors de ce format). */
export function qualificationStandings(bundle: TournamentBundle): QualificationStandings | null {
  const { tournament } = bundle
  if (tournament.format !== 'qualification_knockout' || !tournament.qualification_wins || !tournament.qualification_losses) {
    return null
  }
  return computeQualification({
    tournamentId: tournament.id,
    playerIds: bundle.entries.map((e) => e.player_id),
    wins: tournament.qualification_wins,
    losses: tournament.qualification_losses,
    matches: qualificationMatches(bundle).map((m) => ({
      home: m.home_player_id,
      away: m.away_player_id,
      status: m.status,
      winner: m.winner_player_id,
      sets: bundle.sets.get(m.id) ?? [],
      legs: m.home_legs !== null && m.away_legs !== null ? { home: m.home_legs, away: m.away_legs } : null,
    })),
  })
}

/** Qualifiés attendus et exemptés du tour préliminaire (connus dès le lancement). */
export function qualificationOutlook(bundle: TournamentBundle): { qualifiers: number; byes: number } | null {
  const { tournament } = bundle
  if (!tournament.qualification_wins || !tournament.qualification_losses) return null
  const qualifiers = expectedQualifierCount(bundle.entries.length, tournament.qualification_wins, tournament.qualification_losses)
  return {
    qualifiers,
    byes: tournament.qualification_next_stage === 'preliminary' ? preliminaryByeCount(qualifiers) : 0,
  }
}

/** Phase finale calculée à partir du classement, ou ce qui manque. */
export function computeQualificationFinal(
  bundle: TournamentBundle,
): { ok: true; draw: DrawResult } | { ok: false; problems: string[] } {
  const standings = qualificationStandings(bundle)
  if (!standings) return { ok: false, problems: ['Ce tournoi n’a pas de phase de qualification.'] }
  if (!standings.complete) {
    const remaining = standings.rows.filter((r) => r.status === 'playing' || r.status === 'waiting').length
    return { ok: false, problems: [`Qualification en cours : ${remaining} joueur(s) encore en lice.`] }
  }
  const stage = bundle.tournament.qualification_next_stage ?? 'preliminary'
  if (stage === 'groups') {
    return { ok: false, problems: ['Les parties à plusieurs arrivent bientôt : choisis une autre étape en attendant.'] }
  }
  if (standings.qualified.length < 2) return { ok: false, problems: ['Il faut au moins 2 qualifiés.'] }
  return {
    ok: true,
    draw: buildQualificationFinal(standings.qualified, { nextStage: stage, thirdPlace: bundle.tournament.third_place }),
  }
}
