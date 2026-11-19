import DOMPurify from 'dompurify'
import { useMemo } from 'react'
import { ALLOWED_ATTR, ALLOWED_TAGS, isLegacyPlainText } from './richText.ts'

// Liens : toujours dans un nouvel onglet, sans transmettre la page d'origine.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

/** Affiche un contenu riche (HTML nettoyé). Les anciens contenus en texte simple restent affichés tels quels. */
export function RichText({ html, className = '' }: { html: string; className?: string }) {
  const clean = useMemo(
    () => (isLegacyPlainText(html) ? null : DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })),
    [html],
  )
  if (!html.trim()) return null
  if (clean === null) return <p className={`whitespace-pre-line ${className}`}>{html}</p>
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />
}
