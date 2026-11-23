import { describe, expect, it } from 'vitest'
import { visibleNavCount } from './navOverflow.ts'

describe('visibleNavCount', () => {
  const widths = [80, 80, 100, 90, 70]

  it('affiche tout quand il y a la place', () => {
    expect(visibleNavCount(widths, 70, 1000, 4)).toBe(5)
    // Pile la largeur nécessaire : 420 + 4 × 4
    expect(visibleNavCount(widths, 70, 436, 4)).toBe(5)
  })

  it('réserve la place du bouton « Plus » quand tout ne tient pas', () => {
    // 3 entrées : 260 + 8 = 268, + 4 + 70 = 342
    expect(visibleNavCount(widths, 70, 435, 4)).toBe(3)
    expect(visibleNavCount(widths, 70, 342, 4)).toBe(3)
    expect(visibleNavCount(widths, 70, 341, 4)).toBe(2)
  })

  it('garde au moins une entrée visible', () => {
    expect(visibleNavCount(widths, 70, 10, 4)).toBe(1)
    expect(visibleNavCount(widths, 70, 0, 4)).toBe(1)
  })

  it('gère un menu vide', () => {
    expect(visibleNavCount([], 70, 100, 4)).toBe(0)
  })
})
