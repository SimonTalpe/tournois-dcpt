/** Version du site affichée en bas de page : « 19/11/2026 15:02 · e88a7ff ». */
export function formatVersion(buildDate: string, commit: string): string {
  return commit && commit !== 'local' ? `${buildDate} · ${commit}` : buildDate
}

export const APP_VERSION = formatVersion(__APP_BUILD_DATE__, __APP_COMMIT__)

/** Fréquence de vérification d'une nouvelle version (en plus du retour sur l'appli). */
export const UPDATE_CHECK_MS = 15 * 60_000
