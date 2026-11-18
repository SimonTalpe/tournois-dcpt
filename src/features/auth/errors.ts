/** Traduction des erreurs Supabase (authentification et base) en messages compréhensibles. */

type ErrorLike = { code?: string | null; message?: string | null; status?: number } | null | undefined

const MESSAGES_BY_CODE: Record<string, string> = {
  invalid_credentials: 'Email ou mot de passe incorrect.',
  email_not_confirmed: "Ton adresse email n'est pas encore confirmée.",
  user_already_exists: 'Un compte existe déjà avec cette adresse. Connecte-toi ou utilise « Mot de passe oublié ».',
  email_exists: 'Un compte existe déjà avec cette adresse. Connecte-toi ou utilise « Mot de passe oublié ».',
  weak_password: 'Mot de passe trop faible : choisis-en un plus long.',
  same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
  otp_expired: 'Code incorrect ou expiré. Vérifie le dernier email reçu ou demande un nouveau code.',
  over_email_send_rate_limit: "Trop d'emails envoyés. Patiente quelques minutes avant de redemander un code.",
  over_request_rate_limit: 'Trop de tentatives. Patiente quelques minutes.',
  email_address_invalid: "Cette adresse email n'est pas valide.",
  anonymous_provider_disabled: "L'accès spectateur n'est pas encore activé sur le site.",
  signup_disabled: 'Les inscriptions sont fermées pour le moment.',
  user_banned: 'Ce compte est bloqué. Contacte l’administrateur.',
}

const MESSAGES_BY_DB_ERROR: Record<string, string> = {
  EMAIL_NOT_ALLOWED: "Cette adresse n'est pas autorisée. Utilise ton adresse @fft.fr.",
  TOO_MANY_ATTEMPTS: 'Trop de codes erronés. Réessaie dans 10 minutes.',
  FORBIDDEN: "Tu n'as pas les droits pour cette action.",
  INVALID_CODE: 'Le code doit contenir entre 4 et 40 caractères.',
  CANNOT_CHANGE_OWN_STATUS: 'Tu ne peux pas désactiver ton propre compte.',
  CANNOT_RESET_OWN_PASSWORD: 'Pour ton propre compte, utilise « Mot de passe oublié ».',
  NOT_FOUND: 'Élément introuvable (supprimé entre-temps ?). Recharge la page.',
  CONFIG_LOCKED: 'Le tournoi est lancé : format et options ne sont plus modifiables. Annule le lancement pour les changer.',
  TOURNAMENT_HAS_RESULTS: 'Un match a déjà été joué : le tirage ne peut plus être refait.',
  TOURNAMENT_CLOSED: 'Le tournoi est terminé ou archivé.',
  NOT_ENOUGH_PLAYERS: 'Il faut au moins 2 joueurs inscrits.',
  INVALID_PLAN: 'Le tirage ne correspond plus aux inscrits. Recharge la page et recommence.',
  NOT_IN_PROGRESS: "Le tournoi n'est pas en cours.",
  ALREADY_ENTERED: 'Ce joueur est déjà inscrit au tournoi.',
  NOT_ENTERED: "Ce joueur n'est pas inscrit au tournoi.",
  INVALID_STATUS: 'Changement de statut impossible.',
}

export const GENERIC_ERROR = 'Une erreur est survenue. Réessaie dans un instant.'

export function translateError(error: ErrorLike): string {
  if (!error) return GENERIC_ERROR
  if (error.code && MESSAGES_BY_CODE[error.code]) return MESSAGES_BY_CODE[error.code]

  const message = error.message ?? ''
  for (const [key, text] of Object.entries(MESSAGES_BY_DB_ERROR)) {
    if (message.includes(key)) return text
  }
  // Refus par le déclencheur de la base à l'inscription.
  if (message.includes('Database error saving new user')) return MESSAGES_BY_DB_ERROR.EMAIL_NOT_ALLOWED
  if (/invalid login credentials/i.test(message)) return MESSAGES_BY_CODE.invalid_credentials
  if (/token has expired or is invalid/i.test(message)) return MESSAGES_BY_CODE.otp_expired
  if (/failed to fetch|network/i.test(message)) return 'Connexion impossible. Vérifie ton réseau.'
  return GENERIC_ERROR
}
