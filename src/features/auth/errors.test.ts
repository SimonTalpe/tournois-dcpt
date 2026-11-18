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

  it('retombe sur un message générique', () => {
    expect(translateError({ message: 'boom' })).toBe(GENERIC_ERROR)
    expect(translateError(null)).toBe(GENERIC_ERROR)
  })
})
