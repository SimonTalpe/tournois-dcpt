import { describe, expect, it } from 'vitest'
import { rankedNotificationText, type AppNotification } from './api.ts'

const base: AppNotification = {
  id: 'n1',
  kind: 'ranked_match',
  announcement_id: null,
  ranked_match_id: 'r1',
  created_at: '2026-11-24T10:00:00Z',
  read_at: null,
  elo_delta: -12,
  recipient_won: false,
  actor_id: 'julien',
  actor: { full_name: 'Julien' },
  announcement: null,
  ranked_match: {
    discipline: 'darts',
    home: { full_name: 'Julien', profile_id: 'julien' },
    away: { full_name: 'Sim', profile_id: 'sim' },
  },
}

describe('notification de match classé', () => {
  it('saisie par l’adversaire', () => {
    expect(rankedNotificationText(base, 'sim')).toBe('Julien a enregistré sa victoire contre toi (−12 Elo)')
    expect(rankedNotificationText({ ...base, recipient_won: true, elo_delta: 9 }, 'sim')).toBe(
      'Julien a enregistré sa défaite contre toi (+9 Elo)',
    )
  })

  it('saisie par l’admin pour les deux joueurs', () => {
    expect(
      rankedNotificationText({ ...base, actor_id: 'admin', actor: { full_name: 'Admin' }, recipient_won: true, elo_delta: 15 }, 'sim'),
    ).toBe('Admin a enregistré ta victoire contre Julien (+15 Elo)')
  })

  it('annonce : pas de texte de match classé', () => {
    expect(rankedNotificationText({ ...base, kind: 'announcement', ranked_match: null }, 'sim')).toBeNull()
  })
})
