import { describe, expect, it } from 'vitest'
import { pickTournamentInput } from './api.ts'
import { EMPTY_TOURNAMENT } from './types.ts'

describe('champs envoyés à la base', () => {
  // Le formulaire de gestion est prérempli avec la ligne complète du tournoi.
  const row = { ...EMPTY_TOURNAMENT, id: 't1', status: 'draft', launched_at: null, created_at: '2026-11-18' }

  it('ignore les colonnes non modifiables (id, statut, dates)', () => {
    const input = pickTournamentInput(row)
    expect(input).toEqual(EMPTY_TOURNAMENT)
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('status')
    expect(input).not.toHaveProperty('created_at')
  })

  it('tournoi lancé : seuls nom, description, formats par défaut et placement', () => {
    expect(Object.keys(pickTournamentInput(row, true)).sort()).toEqual(
      ['default_dart_double_out', 'default_dart_start', 'default_sets_to_win', 'description', 'name', 'qualifier_placement'].sort(),
    )
  })
})
