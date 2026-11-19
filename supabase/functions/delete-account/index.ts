// Edge Function « delete-account » : suppression d'un compte.
// - Sans paramètre : le joueur connecté supprime son propre compte.
// - Avec { userId } : l'admin supprime le compte d'un joueur.
// 1. L'anonymisation (« Joueur supprimé ») est faite par la base, avec les droits de l'appelant
//    (fonctions delete_my_account / admin_delete_account, qui vérifient les droits).
// 2. Puis l'utilisateur d'authentification est supprimé en mode « doux » (clé de service) :
//    adresse email effacée (réutilisable pour un nouveau compte), sessions fermées,
//    ligne conservée pour ne pas effacer les résultats qui référencent le profil.
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

/** Code d'erreur de la base (ex. LAST_ADMIN) contenu dans le message. */
function dbErrorCode(message: string): string {
  const known = ['FORBIDDEN', 'NOT_FOUND', 'LAST_ADMIN', 'CANNOT_DELETE_OWN_ACCOUNT']
  return known.find((code) => message.includes(code)) ?? 'DELETE_FAILED'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authorization = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: caller } = await callerClient.auth.getUser()
  const callerId = caller.user?.id
  if (!callerId || caller.user?.is_anonymous) return json({ error: 'FORBIDDEN' }, 403)

  let userId: unknown = null
  try {
    const body = await req.json()
    userId = body?.userId ?? null
  } catch {
    // Corps vide : suppression de son propre compte.
  }
  if (userId !== null && (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId))) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const target = (userId as string | null) ?? callerId
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 1. Anonymisation par la base, avec les droits de l'appelant.
  const { error: rpcError } =
    target === callerId
      ? await callerClient.rpc('delete_my_account')
      : await callerClient.rpc('admin_delete_account', { p_user_id: target })
  if (rpcError) {
    const code = dbErrorCode(rpcError.message ?? '')
    // Reprise après un échec de l'étape 2 : le profil est déjà anonymisé.
    const { data: profile } = await service.from('profiles').select('status').eq('id', target).maybeSingle()
    const alreadyDeleted = code === 'NOT_FOUND' && profile?.status === 'deleted'
    if (!alreadyDeleted) return json({ error: code }, code === 'FORBIDDEN' ? 403 : 400)
    // Une reprise pour un autre compte reste réservée à l'admin.
    if (target !== callerId) {
      const { data: isAdmin } = await callerClient.rpc('is_admin')
      if (isAdmin !== true) return json({ error: 'FORBIDDEN' }, 403)
    }
  }

  // 2. Suppression « douce » de l'utilisateur d'authentification.
  const { error: deleteError } = await service.auth.admin.deleteUser(target, true)
  if (deleteError) return json({ error: 'AUTH_DELETE_FAILED', detail: deleteError.message }, 500)

  return json({ ok: true })
})
