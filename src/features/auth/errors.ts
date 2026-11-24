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
  NOT_MY_MATCH: 'Tu ne peux saisir que le résultat de tes propres matchs.',
  MATCH_NOT_READY: 'Ce match ne peut pas recevoir de score (joueurs pas encore connus, forfait ou match annulé).',
  MATCH_NOT_PENDING: 'Ce match a déjà un résultat : efface-le ou rétablis le match d’abord.',
  NOT_IN_MATCH: 'Ce joueur ne fait pas partie du match.',
  CANCEL_POOL_ONLY: 'Seuls les matchs de poule peuvent être annulés. Dans un tableau, déclare plutôt un forfait.',
  MATCH_NOT_REOPENABLE: 'Seuls un forfait ou un match annulé peuvent être rétablis.',
  FORFEIT_LOOP: 'Forfait impossible à appliquer : contacte le développeur.',
  INVALID_SCORE: 'Score invalide : vérifie chaque set (11 points, 2 points d’écart).',
  RESULT_LOCKED: 'Ce résultat ne peut plus être modifié par toi (délai de 5 minutes dépassé ou saisi par un autre) : contacte l’admin.',
  NEXT_MATCH_PLAYED: 'Le match suivant a déjà été joué : efface d’abord son résultat pour changer le vainqueur de celui-ci.',
  ROUND_LOCKED: 'Un match de ce tour a déjà été joué : son format de jeu ne peut plus changer.',
  INVALID_TIEBREAK: 'Départage invalide : classe tous les joueurs à égalité de cette poule, chacun une seule fois.',
  POOL_NOT_FINISHED: 'Tous les matchs de poule ne sont pas encore joués.',
  QUALIFICATION_NOT_FINISHED: 'La qualification n’est pas terminée : des joueurs sont encore en lice.',
  QUALIFICATION_MIN_PLAYERS: 'Il faut au moins 6 joueurs pour le format à qualification.',
  QUALIFICATION_REPLACE_LOCKED:
    'Ce joueur a déjà un résultat de qualification : son bilan ne peut pas être transféré. Déclare-le plutôt forfait.',
  ROUND_NOT_FINISHED: 'Le round en cours n’est pas terminé : tous ses matchs doivent être joués avant de créer le suivant.',
  NOTHING_TO_PAIR: 'Aucun match à créer : la qualification est terminée ou tous les joueurs ont déjà un match.',
  NOT_A_BYE: 'Ce match n’est pas une exemption de qualification.',
  BYE_SWAP_NOT_ALLOWED:
    'Exemption impossible à donner à ce joueur : il doit avoir le même bilan, un match du même round pas encore joué, et l’exempté actuel ne doit pas avoir joué depuis.',
  QUALIFICATION_LOOP: 'Erreur inattendue dans la création des matchs de qualification. Préviens l’administrateur.',
  FINAL_PHASE_EXISTS:
    'La phase finale est générée : les résultats de poule et de qualification sont figés. Annule la phase finale (Gestion) pour les modifier.',
  SCHEDULE_LOCKED: 'Le résultat est saisi : lieu et horaire ne sont plus modifiables (sauf par l’admin).',
  SWAP_NOT_POSSIBLE: 'Inversion impossible : le match a déjà un résultat (ou est un exempt).',
  LAST_ADMIN: 'Tu es le seul admin : nomme un autre admin avant de supprimer ton compte.',
  CANNOT_DELETE_OWN_ACCOUNT: 'Pour ton propre compte, utilise « Supprimer mon compte » dans ton profil.',
  AUTH_DELETE_FAILED:
    'Le compte est anonymisé mais la suppression de l’accès a échoué. Réessaie : la suppression reprendra où elle s’est arrêtée.',
  DELETE_FAILED: 'La suppression du compte a échoué. Réessaie dans un instant.',
  NOT_NAME_ONLY: 'Ce joueur est déjà lié à un compte. Recharge la page.',
  // Avant MERGE_CONFLICT : la recherche se fait par inclusion dans le message.
  MERGE_CONFLICT_DART_GAME:
    'Ce compte et ce nom seul ont joué une même partie au compteur de fléchettes : fusion impossible.',
  INVALID_DART_GAME: 'Résultat de partie incohérent : il n’a pas pu être enregistré.',
  INVALID_DART_MATCH: 'Résultat du match incohérent (joueurs ou manches) : il n’a pas pu être enregistré.',
  MATCH_ALREADY_PLAYED: 'Ce match a déjà un résultat (validé depuis un autre téléphone ?) : ta partie n’est pas enregistrée.',
  TIEBREAK_ALREADY_SET: 'Ce départage a déjà un résultat (validé depuis un autre téléphone ?) : ta partie n’est pas enregistrée.',
  INVALID_LEGS: 'Score en manches invalide : le vainqueur doit avoir toutes les manches requises, le perdant moins.',
  DUPLICATE_DART_PLAYER: 'Un même joueur figure deux fois dans la partie.',
  RANKED_DAILY_LIMIT: 'Déjà 3 matchs classés aujourd’hui contre ce joueur dans cette discipline : reviens demain !',
  RANKED_SELF: 'Choisis deux joueurs différents.',
  RANKED_LOCKED:
    'Ce match classé ne peut plus être modifié par toi (délai de 24 heures dépassé ou saisi par un autre) : contacte l’admin.',
  RANKED_PLAYER_INACTIVE: 'Ce joueur ne peut pas jouer de match classé (compte désactivé ou email non confirmé).',
  INVALID_RANKED_SCORE: 'Score invalide : choisis le vainqueur (et un reste du perdant entre 1 et 301).',
  INVALID_RANKED_GAME: 'Résultat de partie incohérent : le match classé n’a pas pu être enregistré.',
  MERGE_CONFLICT:
    "Ce compte et ce nom seul jouent dans un même tournoi : fusion impossible. Remplace d'abord l'un des deux dans ce tournoi.",
}

/** Règles de la base (contraintes) violées, par nom de contrainte. */
const MESSAGES_BY_CONSTRAINT: Record<string, string> = {
  tournaments_pool_options:
    'Format avec poules : indique le nombre de poules et de qualifiés (et aucun des deux en élimination directe).',
  tournaments_name_check: 'Le nom du tournoi doit contenir entre 2 et 80 caractères.',
  tournaments_description_check: 'La description est trop longue (environ 20 000 caractères de mise en forme maximum).',
  tournaments_pool_count_check: 'Nombre de poules : entre 1 et 16.',
  tournaments_qualifiers_per_pool_check: 'Qualifiés par poule : entre 1 et 8.',
  matches_schedule_slot: 'Horaire invalide : du lundi au vendredi, par tranches de 15 minutes.',
  announcements_title_check: 'Le titre de l’annonce doit contenir entre 2 et 120 caractères.',
  announcements_body_check: 'L’annonce est trop longue : raccourcis-la.',
  announcements_expiry_check: 'La date de fin doit être après la publication.',
  locations_name_check: 'Le nom du lieu doit contenir entre 2 et 40 caractères.',
  locations_name_key: 'Ce lieu existe déjà.',
  players_full_name_check: 'Le nom du joueur doit contenir entre 2 et 80 caractères.',
  profiles_full_name_check: 'Le nom doit contenir entre 2 et 80 caractères.',
}

/** Erreurs PostgreSQL génériques (code SQLSTATE). */
const MESSAGES_BY_SQLSTATE: Record<string, string> = {
  '42501': "La base a refusé l'opération : droits insuffisants (es-tu toujours connecté en admin ?).",
  '23505': 'Cet élément existe déjà.',
  '23514': 'Une valeur saisie ne respecte pas les règles de la base.',
  '23502': 'Un champ obligatoire est vide.',
  '22P02': 'Une valeur saisie a un format invalide.',
  PGRST116: 'Élément introuvable (supprimé entre-temps ?). Recharge la page.',
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
  for (const [constraint, text] of Object.entries(MESSAGES_BY_CONSTRAINT)) {
    if (message.includes(constraint)) return text
  }
  if (/permission denied/i.test(message)) return MESSAGES_BY_SQLSTATE['42501']
  // Clé étrangère : suppression d'un élément encore utilisé, ou référence à un élément disparu.
  if (error.code === '23503' || /foreign key constraint/i.test(message)) {
    return /update or delete on table/i.test(message)
      ? 'Impossible : cet élément est encore utilisé ailleurs (ex. joueur inscrit à un tournoi).'
      : 'Élément introuvable (supprimé entre-temps ?). Recharge la page.'
  }
  if (error.code && MESSAGES_BY_SQLSTATE[error.code]) return MESSAGES_BY_SQLSTATE[error.code]
  // Erreur imprévue : on affiche le détail technique pour pouvoir la signaler.
  if (message) return `${GENERIC_ERROR} (détail : ${message})`
  return GENERIC_ERROR
}
