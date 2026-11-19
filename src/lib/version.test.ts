import { describe, expect, it } from 'vitest'
import { formatVersion } from './version.ts'

describe('version du site', () => {
  it('affiche la date et le commit', () => {
    expect(formatVersion('19/11/2026 15:02', 'e88a7ff')).toBe('19/11/2026 15:02 · e88a7ff')
  })
  it('omet le commit en local', () => {
    expect(formatVersion('19/11/2026 15:02', 'local')).toBe('19/11/2026 15:02')
  })
})
