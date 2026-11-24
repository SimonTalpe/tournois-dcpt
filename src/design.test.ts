import { describe, expect, it } from 'vitest'

/**
 * Garde-fous du design « Ordre du jeu » (docs/DESIGN.md) : vérifiés à chaque PR pour que
 * les prochaines modifications restent dans le design.
 */

const sources = import.meta.glob<string>('./**/*.tsx', { query: '?raw', import: 'default', eager: true })
const files = Object.entries(sources).map(([path, text]) => ({ path: path.slice(2), text }))

function offenders(pattern: RegExp): string[] {
  return files.flatMap(({ path, text }) =>
    text.split('\n').flatMap((line: string, i: number) => (pattern.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  )
}

describe('design « Ordre du jeu »', () => {
  it('analyse bien les composants du site', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('n’utilise pas d’émojis dans l’interface (icônes SVG de ui.tsx à la place)', () => {
    expect(offenders(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u).filter((l) => !/[✓✕]/u.test(l))).toEqual([])
  })

  it('n’écrit pas de texte en majuscules (classe uppercase)', () => {
    expect(offenders(/\buppercase\b/)).toEqual([])
  })

  it('n’utilise que les couleurs de la palette (pas de code couleur en dur dans les composants)', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b/)).toEqual([])
  })

  it('n’ajoute pas d’ombres ni de dégradés décoratifs', () => {
    expect(offenders(/\b(shadow-(sm|md|lg|xl|2xl)|bg-gradient|bg-linear)\b/)).toEqual([])
  })
})
