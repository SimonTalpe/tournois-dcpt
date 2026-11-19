import { describe, expect, it } from 'vitest'
import {
  announcementState,
  checkAnnouncementDates,
  expiryFromLastDay,
  lastDayFromExpiry,
  nextDay,
  publicationFromFields,
} from './dates.ts'

describe('dates des annonces', () => {
  const now = new Date('2026-12-02T10:00:00Z')

  it('calcule l’état d’une annonce', () => {
    expect(announcementState({ published_at: '2026-12-03T08:00:00Z', expires_at: null }, now)).toBe('scheduled')
    expect(announcementState({ published_at: '2026-12-01T08:00:00Z', expires_at: null }, now)).toBe('live')
    expect(announcementState({ published_at: '2026-12-01T08:00:00Z', expires_at: '2026-12-02T10:00:00Z' }, now)).toBe(
      'expired',
    )
  })

  it('passe au jour suivant, y compris en fin de mois et d’année', () => {
    expect(nextDay('2026-12-05')).toBe('2026-12-06')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('2028-02-28')).toBe('2028-02-29')
  })

  it('expire le lendemain du dernier jour à minuit, heure de Paris', () => {
    expect(expiryFromLastDay('2026-12-05')).toBe('2026-12-05T23:00:00.000Z')
    expect(expiryFromLastDay('2027-07-14')).toBe('2027-07-14T22:00:00.000Z')
    expect(lastDayFromExpiry('2026-12-05T23:00:00.000Z')).toBe('2026-12-05')
    expect(lastDayFromExpiry(expiryFromLastDay('2027-03-28'))).toBe('2027-03-28')
  })

  it('convertit la publication saisie en heure de Paris', () => {
    expect(publicationFromFields('2026-12-01', '09:00')).toBe('2026-12-01T08:00:00.000Z')
  })

  it('vérifie la saisie', () => {
    expect(checkAnnouncementDates('', '09:00', '')).toMatch(/publication/)
    expect(checkAnnouncementDates('2026-12-05', '09:00', '2026-12-04')).toMatch(/après/)
    expect(checkAnnouncementDates('2026-12-05', '09:00', '2026-12-05')).toBeNull()
    expect(checkAnnouncementDates('2026-12-05', '09:00', '')).toBeNull()
  })
})
