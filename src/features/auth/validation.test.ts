import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizeFullName,
  normalizeOtp,
  validateEmail,
  validateEmailDomain,
  validateFullName,
  validateOtp,
  validatePassword,
  validatePasswordConfirmation,
  validateSpectatorCode,
} from './validation.ts'

describe('validation des formulaires de compte', () => {
  it('normalise email et nom', () => {
    expect(normalizeEmail('  Alice.Martin@FFT.fr ')).toBe('alice.martin@fft.fr')
    expect(normalizeFullName('  Alice   Martin ')).toBe('Alice Martin')
  })

  it('valide les emails', () => {
    expect(validateEmail('alice@fft.fr')).toBeNull()
    expect(validateEmail('')).not.toBeNull()
    expect(validateEmail('alice@fft')).not.toBeNull()
    expect(validateEmail('alice fft.fr')).not.toBeNull()
  })

  it('valide le nom complet', () => {
    expect(validateFullName('Al')).toBeNull()
    expect(validateFullName(' A ')).not.toBeNull()
    expect(validateFullName('x'.repeat(81))).not.toBeNull()
  })

  it('valide le mot de passe et sa confirmation', () => {
    expect(validatePassword('1234567')).not.toBeNull()
    expect(validatePassword('12345678')).toBeNull()
    expect(validatePasswordConfirmation('abc', 'abc')).toBeNull()
    expect(validatePasswordConfirmation('abc', 'abd')).not.toBeNull()
  })

  it('accepte un code à 6 chiffres collé avec des espaces', () => {
    expect(normalizeOtp(' 123 456 ')).toBe('123456')
    expect(normalizeOtp('1234567')).toBe('123456')
    expect(validateOtp('123 456')).toBeNull()
    expect(validateOtp('12345')).not.toBeNull()
  })

  it('valide le code spectateur', () => {
    expect(validateSpectatorCode('abc')).not.toBeNull()
    expect(validateSpectatorCode('pause')).toBeNull()
    expect(validateSpectatorCode('x'.repeat(41))).not.toBeNull()
  })

  it('valide un domaine email', () => {
    expect(validateEmailDomain('fft.fr')).toBeNull()
    expect(validateEmailDomain('@fft.fr')).toBeNull()
    expect(validateEmailDomain('fft')).not.toBeNull()
  })
})
