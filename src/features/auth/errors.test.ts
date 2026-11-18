import { describe, expect, it } from 'vitest'
import { GENERIC_ERROR, translateError } from './errors.ts'

describe('traduction des erreurs', () => {
  it('traduit les codes Supabase Auth', () => {
    expect(translateError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Email ou mot de passe incorrect.',
    )
    expect(translateError({ code: 'otp_expired' })).toMatch(/expiré/)
  })

  it('traduit les erreurs levées par la base', () => {
    expect(translateError({ message: 'TOO_MANY_ATTEMPTS' })).toMatch(/10 minutes/)
    expect(translateError({ message: 'Database error saving new user' })).toMatch(/@fft.fr/)
  })

  it('traduit les refus et contraintes de la base', () => {
    expect(translateError({ code: '42501', message: 'permission denied for table tournaments' })).toMatch(/droits insuffisants/)
    expect(
      translateError({ code: '23514', message: 'new row for relation "tournaments" violates check constraint "tournaments_pool_options"' }),
    ).toMatch(/poules/)
    expect(translateError({ code: '23503', message: 'violates foreign key constraint' })).toMatch(/encore utilisé/)
    expect(translateError({ code: '23514', message: 'violates check constraint "autre"' })).toMatch(/règles de la base/)
  })

  it('retombe sur un message générique avec le détail', () => {
    expect(translateError({ message: 'boom' })).toBe(`${GENERIC_ERROR} (détail : boom)`)
    expect(translateError({})).toBe(GENERIC_ERROR)
    expect(translateError(null)).toBe(GENERIC_ERROR)
  })
})
