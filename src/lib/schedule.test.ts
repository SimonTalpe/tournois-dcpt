import { describe, expect, it } from 'vitest'
import { canSchedule, checkSchedule, isAllowedSlot, formatSchedule, isWeekday, parisToIso, timeSlots, toParisParts } from './schedule.ts'

describe('horaires des matchs', () => {
  it('propose des créneaux de 15 minutes sur 12:00–13:30 et 17:30–19:00', () => {
    expect(timeSlots()).toEqual([
      '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30',
      '17:30', '17:45', '18:00', '18:15', '18:30', '18:45', '19:00',
    ])
    expect(isAllowedSlot('13:30')).toBe(true)
    expect(isAllowedSlot('13:45')).toBe(false)
    expect(isAllowedSlot('17:15')).toBe(false)
    expect(isAllowedSlot('19:15')).toBe(false)
  })

  it('reconnaît les jours de semaine', () => {
    expect(isWeekday('2026-12-02')).toBe(true) // mercredi
    expect(isWeekday('2026-12-05')).toBe(false) // samedi
    expect(isWeekday('2026-12-06')).toBe(false) // dimanche
    expect(isWeekday('pas une date')).toBe(false)
  })

  it('convertit l’heure de Paris en UTC, hiver comme été', () => {
    expect(parisToIso('2026-12-02', '12:30')).toBe('2026-12-02T11:30:00.000Z')
    expect(parisToIso('2027-06-02', '12:30')).toBe('2027-06-02T10:30:00.000Z')
    expect(toParisParts('2026-12-02T11:30:00.000Z')).toEqual({ date: '2026-12-02', time: '12:30' })
    expect(toParisParts(parisToIso('2027-03-29', '08:00'))).toEqual({ date: '2027-03-29', time: '08:00' })
  })

  it('affiche le jour et l’heure', () => {
    expect(formatSchedule('2026-12-02T11:30:00.000Z')).toMatch(/mer\.? 2 déc\.? · 12:30/)
  })

  it('vérifie la saisie', () => {
    expect(checkSchedule('', '')).toBeNull()
    expect(checkSchedule('2026-12-02', '12:30')).toBeNull()
    expect(checkSchedule('2026-12-02', '')).toMatch(/jour et l’heure/)
    expect(checkSchedule('2026-12-05', '12:30')).toMatch(/lundi au vendredi/)
    expect(checkSchedule('2026-12-02', '12:20')).toMatch(/15 minutes/)
    expect(checkSchedule('2026-12-02', '19:00')).toBeNull()
    expect(checkSchedule('2026-12-02', '08:00')).toMatch(/12:00–13:30 ou 17:30–19:00/)
    expect(checkSchedule('2026-12-02', '14:00')).toMatch(/12:00–13:30 ou 17:30–19:00/)
    // Horaire hors plages déjà enregistré : conservé tel quel, mais pas déplacé hors plages.
    const old = { date: '2026-12-02', time: '08:00' }
    expect(checkSchedule('2026-12-02', '08:00', old)).toBeNull()
    expect(checkSchedule('2026-12-03', '08:00', old)).toMatch(/12:00–13:30/)
  })
})

describe('canSchedule', () => {
  const pending = { status: 'pending', homePlayerId: 'pa', awayPlayerId: null }
  const alice = { isAdmin: false, isActivePlayer: true, playerId: 'pa' }
  const admin = { isAdmin: true, isActivePlayer: true, playerId: null }
  it('joueur du match tant que le match n’a pas de résultat (adversaire encore inconnu compris)', () => {
    expect(canSchedule(pending, alice, 'in_progress')).toBe(true)
    expect(canSchedule({ ...pending, status: 'played' }, alice, 'in_progress')).toBe(false)
    expect(canSchedule(pending, { ...alice, playerId: 'pc' }, 'in_progress')).toBe(false)
    expect(canSchedule(pending, alice, 'finished')).toBe(false)
  })
  it('admin : toujours, sauf exempts et tournois archivés', () => {
    expect(canSchedule({ ...pending, status: 'played' }, admin, 'finished')).toBe(true)
    expect(canSchedule({ ...pending, status: 'bye' }, admin, 'in_progress')).toBe(false)
    expect(canSchedule(pending, admin, 'archived')).toBe(false)
  })
})
