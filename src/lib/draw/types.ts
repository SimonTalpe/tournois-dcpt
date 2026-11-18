/**
 * Plan de tirage : structure complète d'un tournoi (poules, tours, matchs, liens d'avancement),
 * calculée dans le site puis enregistrée d'un bloc par la fonction SQL admin_launch_tournament.
 * Les clés (key) sont des identifiants lisibles, uniques dans le tournoi.
 */

export type BracketKind = 'pool' | 'main' | 'third_place' | 'consolation'
export type Slot = 'home' | 'away'

/** Générateur aléatoire : renvoie un nombre dans [0, 1[. Injectable pour les tests. */
export type Rng = () => number

export type PlanLink = { matchKey: string; slot: Slot }

export type PlanRound = {
  key: string
  bracket: BracketKind
  roundNumber: number
  name: string
}

export type PlanMatch = {
  key: string
  roundKey: string
  poolLabel: string | null
  /** Ordre d'affichage dans le tour, à partir de 1. */
  position: number
  home: string | null
  away: string | null
  /** pending : à jouer · bye : exempt (un seul joueur, qualifié d'office). */
  status: 'pending' | 'bye'
  winner: string | null
  next: PlanLink | null
  loserNext: PlanLink | null
}

export type PlanPool = { label: string; playerIds: string[] }

export type DrawPlan = {
  pools: PlanPool[]
  rounds: PlanRound[]
  matches: PlanMatch[]
}
