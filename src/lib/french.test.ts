import { describe, expect, it } from 'vitest'
import { deName, plural } from './french.ts'

describe('français', () => {
  it('élide « de » devant une voyelle', () => {
    expect(deName('Andy Murray')).toBe('d’Andy Murray')
    expect(deName('Élodie')).toBe('d’Élodie')
    expect(deName('Ivan Lendl')).toBe('d’Ivan Lendl')
    expect(deName('Rafael Nadal')).toBe('de Rafael Nadal')
    expect(deName('J1')).toBe('de J1')
  })

  it('accorde le pluriel', () => {
    expect(plural(0, 'joueur')).toBe('0 joueur')
    expect(plural(1, 'joueur')).toBe('1 joueur')
    expect(plural(8, 'joueur')).toBe('8 joueurs')
  })
})
