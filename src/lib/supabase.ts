import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase partagé par tout le site.
 * Les valeurs viennent des variables d'environnement (voir .env.example) :
 * - en local : fichier .env.local (non versionné)
 * - en ligne : réglages du projet Cloudflare Pages
 * Tant qu'elles ne sont pas renseignées, `supabase` vaut null et le site fonctionne en mode « maquette ».
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export const isSupabaseConfigured = supabase !== null
