/**
 * Contenus en mise en forme riche (annonces, descriptions de tournoi) : HTML produit par l'éditeur.
 * Fonctions pures (testées) ; le nettoyage avant affichage est fait par DOMPurify dans RichText.tsx.
 */

/** Balises autorisées à l'affichage (celles que produit l'éditeur). */
export const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'hr']
export const ALLOWED_ATTR = ['href', 'target', 'rel']

/** Contenu enregistré en texte simple (avant l'éditeur riche) ? */
export function isLegacyPlainText(content: string): boolean {
  const trimmed = content.trim()
  return trimmed !== '' && !trimmed.startsWith('<')
}

/** Texte visible d'un contenu HTML (sans balises, espaces regroupés). */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<\/(p|h2|h3|li|blockquote)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Contenu vide (aucun texte) ? Un éditeur vidé laisse « <p></p> ». */
export function isRichTextEmpty(html: string): boolean {
  return richTextToPlain(html) === '' && !/<hr/i.test(html)
}

/** Contenu à enregistrer : chaîne vide si rien n'est saisi. */
export function normalizeRichText(html: string): string {
  return isRichTextEmpty(html) ? '' : html.trim()
}

/** Extrait court (aperçus, notifications). */
export function excerpt(html: string, max = 140): string {
  const text = isLegacyPlainText(html) ? html.replace(/\s+/g, ' ').trim() : richTextToPlain(html)
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
