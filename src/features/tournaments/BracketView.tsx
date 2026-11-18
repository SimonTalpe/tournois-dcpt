import { useMemo } from 'react'
import { numberMatches, slotSources, sortRounds } from './display.ts'
import { MatchCard } from './MatchCard.tsx'
import { gameFormatLabel, type Round, type TournamentBundle } from './types.ts'

type Props = {
  bundle: TournamentBundle
  bracket: 'main' | 'consolation'
  highlightPlayerId?: string | null
  onOpenMatch?: (matchId: string) => void
}

/**
 * Tableau à élimination directe : une colonne par tour, défilement horizontal sur mobile.
 * Les matchs d'une colonne sont espacés pour s'aligner sur ceux du tour précédent.
 * Le match pour la 3e place est affiché sous la finale du tableau principal.
 */
export function BracketView({ bundle, bracket, highlightPlayerId, onOpenMatch }: Props) {
  const { rounds, matches, players, tournament } = bundle
  const numbers = useMemo(() => numberMatches(rounds, matches), [rounds, matches])
  const sources = useMemo(() => slotSources(matches), [matches])
  const bracketRounds = sortRounds(rounds).filter((r) => r.bracket === bracket)
  const thirdPlace = bracket === 'main' ? rounds.find((r) => r.bracket === 'third_place') : undefined

  if (bracketRounds.length === 0) return null
  const firstRoundSize = matches.filter((m) => m.round_id === bracketRounds[0].id).length

  // Dans l'onglet Consolante, le préfixe « Consolante — » est superflu.
  const title = (round: Round) => {
    const short = round.name.replace(/^Consolante — /, '')
    return short.charAt(0).toUpperCase() + short.slice(1)
  }

  // Hauteur fixe : les colonnes restent alignées même si un titre est long.
  const header = (round: Round) => (
    <div className="mb-2 h-11 px-1">
      <h3 className="truncate text-sm font-bold text-court" title={round.name}>
        {title(round)}
      </h3>
      <p className="text-xs text-ink/50">{gameFormatLabel(tournament.discipline, round)}</p>
    </div>
  )

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-max gap-3">
        {bracketRounds.map((round, index) => {
          const roundMatches = matches.filter((m) => m.round_id === round.id).sort((a, b) => a.position - b.position)
          const isLast = index === bracketRounds.length - 1
          return (
            <section key={round.id} className="flex w-52 flex-col sm:w-56" aria-label={round.name}>
              {header(round)}
              {/* Hauteur commune à toutes les colonnes : chaque match occupe une part égale. */}
              <div className="flex flex-1 flex-col" style={{ minHeight: `${firstRoundSize * 6}rem` }}>
                {roundMatches.map((match) => (
                  <div key={match.id} className="flex flex-1 items-center py-1.5">
                    <MatchCard
                      match={match}
                      players={players}
                      numbers={numbers}
                      sources={sources}
                      highlightPlayerId={highlightPlayerId}
                      discipline={tournament.discipline}
                      sets={bundle.sets.get(match.id)}
                      onOpen={onOpenMatch}
                    />
                  </div>
                ))}
              </div>
              {isLast && thirdPlace && (
                <div className="mt-4 border-t border-dashed border-ink/20 pt-3">
                  {header(thirdPlace)}
                  {matches
                    .filter((m) => m.round_id === thirdPlace.id)
                    .map((match) => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        players={players}
                        numbers={numbers}
                        sources={sources}
                        highlightPlayerId={highlightPlayerId}
                        discipline={tournament.discipline}
                        sets={bundle.sets.get(match.id)}
                        onOpen={onOpenMatch}
                      />
                    ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
