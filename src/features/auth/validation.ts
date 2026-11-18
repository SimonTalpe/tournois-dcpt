/** Règles de saisie des formulaires de compte (doublées par les contrôles de Supabase et de la base). */

export const PASSWORD_MIN_LENGTH = 8
export const OTP_LENGTH = 6

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeFullName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ')
}

/** Retourne un message d'erreur en français, ou null si la valeur est valide. */
export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email)
  if (!value) return "Saisis ton adresse email."
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "Cette adresse email n'est pas valide."
  return null
}

export function validateFullName(fullName: string): string | null {
  const value = normalizeFullName(fullName)
  if (value.length < 2) return 'Saisis ton prénom et ton nom.'
  if (value.length > 80) return 'Nom trop long (80 caractères maximum).'
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
  }
  return null
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  return password === confirmation ? null : 'Les deux mots de passe ne sont pas identiques.'
}

/** Garde uniquement les chiffres (utile quand le code est collé avec des espaces). */
export function normalizeOtp(code: string): string {
  return code.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function validateOtp(code: string): string | null {
  return normalizeOtp(code).length === OTP_LENGTH ? null : `Le code contient ${OTP_LENGTH} chiffres.`
}

export function validateSpectatorCode(code: string): string | null {
  const length = code.trim().length
  if (length < 4) return 'Le code doit contenir au moins 4 caractères.'
  if (length > 40) return 'Le code doit contenir au plus 40 caractères.'
  return null
}

export function validateEmailDomain(domain: string): string | null {
  const value = domain.trim().toLowerCase().replace(/^@/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) ? null : "Ce domaine n'est pas valide (ex. fft.fr)."
}
