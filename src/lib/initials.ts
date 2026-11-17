/**
 * Initiales d'un nom complet, pour les pastilles des tableaux.
 * « Jean-Marc Dupont » → « JD », « Marie de la Tour » → « MT », « Zoé » → « Z ».
 */
export function getInitials(fullName: string): string {
  const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', "d'", 'van', 'von'])
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !PARTICLES.has(word.toLowerCase()))

  if (words.length === 0) return '?'

  const first = words[0]
  const last = words.length > 1 ? words[words.length - 1] : ''
  return (first.charAt(0) + last.charAt(0)).toLocaleUpperCase('fr-FR')
}
