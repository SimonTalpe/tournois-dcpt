// Edge Function « admin-temp-password » (secours) :
// l'admin génère un mot de passe provisoire pour un joueur qui n'arrive pas à réinitialiser le sien.
// Seule cette fonction utilise la clé de service (variable SUPABASE_SERVICE_ROLE_KEY fournie par Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Sans caractères ambigus (0/O, 1/l/I) pour être dicté facilement.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generatePassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Vérifier que l'appelant est admin, avec ses propres droits.
  const authorization = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: isAdmin, error: adminError } = await callerClient.rpc('is_admin')
  if (adminError || isAdmin !== true) return json({ error: 'FORBIDDEN' }, 403)

  // 2. Lire la demande.
  let userId: unknown
  try {
    ;({ userId } = await req.json())
  } catch {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }

  const { data: caller } = await callerClient.auth.getUser()
  if (caller.user?.id === userId) return json({ error: 'CANNOT_RESET_OWN_PASSWORD' }, 400)

  // 3. Appliquer le mot de passe provisoire avec la clé de service.
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await service
    .from('profiles')
    .select('id, status')
    .eq('id', userId)
    .maybeSingle()
  if (!profile || profile.status === 'deleted') return json({ error: 'NOT_FOUND' }, 404)

  const password = generatePassword()
  const { error: updateError } = await service.auth.admin.updateUserById(userId, { password })
  if (updateError) return json({ error: 'UPDATE_FAILED' }, 500)

  await service.from('profiles').update({ must_change_password: true }).eq('id', userId)

  return json({ password })
})
