import { translateError } from '../features/auth/errors.ts'
import { supabase } from './supabase.ts'

/**
 * Appelle une Edge Function. En cas de refus, le code d'erreur (ex. LAST_ADMIN) est lu dans le corps
 * de la réponse HTTP et traduit en français.
 */
export async function invokeFunction<T extends object>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<{ data: T } | { error: string }> {
  if (!supabase) return { error: "Le site n'est pas relié à la base de données." }
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(name, { body })
  if (!error && data && !('error' in data && data.error)) return { data }
  let code = (data as { error?: string } | null)?.error ?? error?.message
  const context: unknown = error && 'context' in error ? error.context : null
  if (context instanceof Response) {
    code = ((await context.json().catch(() => null)) as { error?: string } | null)?.error ?? code
  }
  return { error: translateError({ message: code }) }
}
