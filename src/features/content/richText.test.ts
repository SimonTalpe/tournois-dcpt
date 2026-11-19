import { describe, expect, it } from 'vitest'
import { excerpt, isLegacyPlainText, isRichTextEmpty, normalizeRichText, richTextToPlain } from './richText.ts'

describe('contenus riches', () => {
  it('reconnaît les anciens contenus en texte simple', () => {
    expect(isLegacyPlainText('Lots : une boîte de balles')).toBe(true)
    expect(isLegacyPlainText('<p>Lots</p>')).toBe(false)
    expect(isLegacyPlainText('   ')).toBe(false)
  })

  it('extrait le texte visible', () => {
    expect(richTextToPlain('<h2>Règles</h2><p>Match en <strong>2 sets</strong> &amp; 11 points</p>')).toBe(
      'Règles Match en 2 sets & 11 points',
    )
    expect(richTextToPlain('<ul><li>Un</li><li>Deux</li></ul>')).toBe('Un Deux')
  })

  it('considère un éditeur vidé comme vide', () => {
    expect(isRichTextEmpty('<p></p>')).toBe(true)
    expect(isRichTextEmpty('<p> &nbsp;</p>')).toBe(true)
    expect(isRichTextEmpty('<p>a</p>')).toBe(false)
    expect(isRichTextEmpty('<hr>')).toBe(false)
    expect(normalizeRichText('<p></p>')).toBe('')
    expect(normalizeRichText(' <p>Bonjour</p> ')).toBe('<p>Bonjour</p>')
  })

  it('coupe les extraits trop longs', () => {
    expect(excerpt('<p>Court</p>')).toBe('Court')
    expect(excerpt(`<p>${'a'.repeat(200)}</p>`, 20)).toBe(`${'a'.repeat(19)}…`)
    expect(excerpt('Texte\nsimple')).toBe('Texte simple')
  })
})
