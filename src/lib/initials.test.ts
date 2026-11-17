import { describe, expect, it } from 'vitest'
import { getInitials } from './initials.ts'

describe('getInitials', () => {
  it('prend la première lettre du prénom et du nom', () => {
    expect(getInitials('Simon Talpe')).toBe('ST')
  })

  it('gère les prénoms composés', () => {
    expect(getInitials('Jean-Marc Dupont')).toBe('JD')
  })

  it('ignore les particules', () => {
    expect(getInitials('Marie de la Tour')).toBe('MT')
  })

  it('gère un seul mot et les espaces superflus', () => {
    expect(getInitials('  zoé  ')).toBe('Z')
  })

  it('renvoie « ? » pour un nom vide', () => {
    expect(getInitials('   ')).toBe('?')
  })

  it('gère les accents', () => {
    expect(getInitials('élodie école')).toBe('ÉÉ')
  })
})
