import type { DartPerson, Participant } from './api.ts'
import { MAX_PLAYERS } from './engine.ts'

/** Comparaison de noms sans majuscules, accents ni espaces superflus. */
export function normalizeName(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Personnes proposées pour la recherche (hors joueurs déjà ajoutés). */
export function searchPeople(people: DartPerson[], participants: Participant[], query: string, limit = 6): DartPerson[] {
  const taken = new Set(
    participants.flatMap((p) =>
      p.ref.kind === 'account'
        ? [`account:${p.ref.profileId}`]
        : p.ref.kind === 'name_only' || p.ref.kind === 'player'
          ? [`name_only:${p.ref.playerId}`]
          : [],
    ),
  )
  const q = normalizeName(query)
  return people
    .filter((p) => !taken.has(`${p.kind}:${p.id}`))
    .filter((p) => !q || normalizeName(p.full_name).includes(q))
    .slice(0, limit)
}

/**
 * Peut-on ajouter un nouveau nom ? Renvoie le message d'erreur, ou null.
 * Un nom déjà connu doit être choisi dans la liste (pas deux « noms seuls » identiques).
 */
export function newNameProblem(name: string, people: DartPerson[], participants: Participant[]): string | null {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (participants.length >= MAX_PLAYERS) return `${MAX_PLAYERS} joueurs maximum.`
  if (clean.length < 2 || clean.length > 80) return 'Le nom doit contenir entre 2 et 80 caractères.'
  const n = normalizeName(clean)
  if (participants.some((p) => normalizeName(p.name) === n)) return 'Ce joueur est déjà dans la partie.'
  if (people.some((p) => normalizeName(p.full_name) === n)) return 'Ce joueur existe déjà : choisis-le dans la liste.'
  return null
}

/** Mélange de Fisher-Yates (ordre de jeu tiré au sort). */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

/**
 * Match classé possible ? 2 comptes, 301, sortie simple (1 manche : format unique des matchs classés),
 * et le joueur qui tient le compteur est l'un des deux (sauf l'admin).
 */
export function rankedEligible(
  participants: Participant[],
  start: number,
  doubleOut: boolean,
  viewer: { profileId: string | null; isAdmin: boolean },
): boolean {
  if (participants.length !== 2 || start !== 301 || doubleOut) return false
  const ids = participants.map((p) => (p.ref.kind === 'account' ? p.ref.profileId : null))
  if (ids.some((id) => id === null) || ids[0] === ids[1]) return false
  return viewer.isAdmin || ids.includes(viewer.profileId)
}
