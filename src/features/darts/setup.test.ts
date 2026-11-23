import { describe, expect, it } from 'vitest'
import type { DartPerson, Participant } from './api.ts'
import { moveItem, newNameProblem, normalizeName, rankedEligible, searchPeople, shuffled } from './setup.ts'

const people: DartPerson[] = [
  { kind: 'account', id: 'a1', full_name: 'Alice Martin' },
  { kind: 'account', id: 'a2', full_name: 'Bob Durand' },
  { kind: 'name_only', id: 'n1', full_name: 'Julien M.' },
]
const alice: Participant = { key: 'k1', name: 'Alice Martin', ref: { kind: 'account', profileId: 'a1' } }

describe('configuration de la partie', () => {
  it('compare les noms sans accents ni majuscules', () => {
    expect(normalizeName('  Élodie   DUPRÉ ')).toBe('elodie dupre')
  })

  it('recherche sans proposer les joueurs déjà ajoutés', () => {
    expect(searchPeople(people, [alice], '').map((p) => p.id)).toEqual(['a2', 'n1'])
    expect(searchPeople(people, [], 'jul').map((p) => p.id)).toEqual(['n1'])
  })

  it('nouveau nom : refusé s’il existe déjà ou est déjà dans la partie', () => {
    expect(newNameProblem('julien m.', people, [])).toMatch(/existe déjà/)
    expect(newNameProblem('Paul', people, [{ key: 'x', name: 'paul', ref: { kind: 'new' } }])).toMatch(/déjà dans la partie/)
    expect(newNameProblem('P', people, [])).toMatch(/entre 2 et 80/)
    expect(newNameProblem('Paul', people, [])).toBeNull()
    const ten = Array.from({ length: 10 }, (_, i): Participant => ({ key: `${i}`, name: `J${i}`, ref: { kind: 'guest' } }))
    expect(newNameProblem('Paul', people, ten)).toMatch(/10 joueurs/)
  })

  it('mélange et déplacement', () => {
    const items = [1, 2, 3, 4, 5]
    expect([...shuffled(items)].sort()).toEqual(items)
    expect(moveItem(items, 0, 2)).toEqual([2, 3, 1, 4, 5])
    expect(moveItem(items, 0, -1)).toBe(items)
  })
})

describe('match classé au compteur', () => {
  const account = (id: string): Participant => ({ key: id, name: id, ref: { kind: 'account', profileId: id } })
  const me = { profileId: 'me', isAdmin: false }
  it('2 comptes, 301, sortie simple, dont moi', () => {
    expect(rankedEligible([account('me'), account('bob')], 301, false, me)).toBe(true)
    expect(rankedEligible([account('me'), account('bob')], 501, false, me)).toBe(false)
    expect(rankedEligible([account('me'), account('bob')], 301, true, me)).toBe(false)
    expect(rankedEligible([account('me'), account('bob'), account('cid')], 301, false, me)).toBe(false)
    expect(rankedEligible([account('me'), { key: 'x', name: 'X', ref: { kind: 'new' } }], 301, false, me)).toBe(false)
  })
  it('sans moi : seulement pour l’admin', () => {
    expect(rankedEligible([account('ana'), account('bob')], 301, false, me)).toBe(false)
    expect(rankedEligible([account('ana'), account('bob')], 301, false, { profileId: 'me', isAdmin: true })).toBe(true)
  })
})
