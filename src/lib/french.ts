/**
 * Petites règles de français pour les textes générés.
 */

/** « de » élidé devant une voyelle : « d’Andy Murray », « de Rafael Nadal ». */
export function deName(name: string): string {
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(name.trim()) ? `d’${name}` : `de ${name}`
}

/** Nombre + nom accordé : « 0 joueur », « 1 joueur », « 8 joueurs ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}
