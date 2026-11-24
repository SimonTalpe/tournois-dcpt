import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listDisabledPlayersWithPendingMatches, type DisabledPlayerPending } from '../tournaments/api.ts'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { invokeFunction } from '../../lib/functions.ts'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../auth/AuthContext.ts'
import { translateError } from '../auth/errors.ts'

type Account = {
  id: string
  email: string
  full_name: string
  role: 'player' | 'admin'
  status: 'active' | 'disabled' | 'deleted'
  email_confirmed: boolean
  must_change_password: boolean
  created_at: string
  last_sign_in_at: string | null
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })

/** Liste des comptes : désactivation / réactivation, mot de passe provisoire, suppression. */
export function AccountsSection() {
  const { session } = useAuth()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<DisabledPlayerPending[]>([])

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: loadError } = await supabase.rpc('admin_list_accounts')
    if (loadError) setError(translateError(loadError))
    else setAccounts(data as Account[])
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  async function setStatus(account: Account, status: 'active' | 'disabled') {
    if (!supabase) return
    if (status === 'disabled' && !window.confirm(`Désactiver le compte de ${account.full_name} ?`)) return
    setBusyId(account.id)
    setError(null)
    setMessage(null)
    const { error: statusError } = await supabase.rpc('admin_set_account_status', {
      p_user_id: account.id,
      p_status: status,
    })
    setBusyId(null)
    if (statusError) return setError(translateError(statusError))
    setMessage(`${account.full_name} : compte ${status === 'disabled' ? 'désactivé' : 'réactivé'}.`)
    // Compte désactivé encore engagé dans un tournoi en cours : proposer remplacement ou forfait.
    setPending(
      status === 'disabled'
        ? (await listDisabledPlayersWithPendingMatches().catch(() => [])).filter((p) => p.profile_id === account.id)
        : [],
    )
    await load()
  }

  async function generateTempPassword(account: Account) {
    if (!supabase) return
    if (!window.confirm(`Générer un mot de passe provisoire pour ${account.full_name} ? L'ancien ne fonctionnera plus.`)) {
      return
    }
    setBusyId(account.id)
    setError(null)
    setMessage(null)
    const { data, error: fnError } = await supabase.functions.invoke<{ password?: string; error?: string }>(
      'admin-temp-password',
      { body: { userId: account.id } },
    )
    setBusyId(null)
    if (fnError || !data?.password) {
      // En cas de refus, le code d'erreur est dans le corps de la réponse HTTP.
      let code = data?.error ?? fnError?.message
      const context: unknown = fnError && 'context' in fnError ? fnError.context : null
      if (context instanceof Response) {
        code = ((await context.json().catch(() => null)) as { error?: string } | null)?.error ?? code
      }
      return setError(translateError({ message: code }))
    }
    setMessage(
      `Mot de passe provisoire de ${account.full_name} : ${data.password} — transmets-le en direct (pas par email). Il devra en choisir un nouveau à la connexion.`,
    )
    await load()
  }

  async function deleteAccount(account: Account) {
    const confirmation = window.prompt(
      `Supprimer définitivement le compte de ${account.full_name} ?\n\n` +
        `Son nom sera remplacé par « Joueur supprimé » dans les tableaux et l'historique (résultats conservés), ` +
        `il ne pourra plus se connecter et son adresse email sera effacée.\n\nTape SUPPRIMER pour confirmer.`,
    )
    if (confirmation?.trim().toUpperCase() !== 'SUPPRIMER') return
    setBusyId(account.id)
    setError(null)
    setMessage(null)
    const result = await invokeFunction<{ ok: boolean }>('delete-account', { userId: account.id })
    setBusyId(null)
    if ('error' in result) return setError(result.error)
    setMessage(`Compte de ${account.full_name} supprimé.`)
    // Compte supprimé encore engagé dans un tournoi en cours : proposer remplacement ou forfait.
    setPending(
      (await listDisabledPlayersWithPendingMatches().catch(() => [])).filter((p) => p.profile_id === account.id),
    )
    await load()
  }

  return (
    <section className="space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">Comptes joueurs</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {pending.length > 0 && (
        <Notice>
          {pending[0].full_name} a encore des matchs à jouer :{' '}
          {pending.map((p, i) => (
            <span key={p.tournament_id}>
              {i > 0 && ', '}
              <Link to={`/tournois/${p.tournament_id}?onglet=gestion`} className="font-semibold underline">
                {p.tournament_name}
              </Link>{' '}
              ({p.pending_matches})
            </span>
          ))}
          . Dans la gestion du tournoi, remplace-le ou déclare-le forfait.
        </Notice>
      )}
      {!accounts ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted">Aucun compte pour le moment.</p>
      ) : (
        <ul className="divide-y divide-black">
          {accounts.map((account) => {
            const isMe = account.id === session?.user.id
            return (
              <li key={account.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {account.full_name}
                    {account.role === 'admin' && <span className="ml-2 rounded bg-ball px-1.5 text-xs">admin</span>}
                    {account.status === 'disabled' && (
                      <span className="ml-2 rounded bg-ochre-tint px-1.5 text-xs text-clay">désactivé</span>
                    )}
                    {!account.email_confirmed && (
                      <span className="ml-2 rounded bg-mist px-1.5 text-xs">email non confirmé</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted">{account.email}</p>
                  <p className="text-xs text-muted">
                    Inscrit le {dateFormat.format(new Date(account.created_at))}
                    {account.last_sign_in_at && ` · dernière connexion le ${dateFormat.format(new Date(account.last_sign_in_at))}`}
                  </p>
                </div>
                {!isMe && (
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton onClick={() => generateTempPassword(account)} disabled={busyId === account.id}>
                      Mot de passe provisoire
                    </SecondaryButton>
                    {account.status === 'active' ? (
                      <SecondaryButton danger onClick={() => setStatus(account, 'disabled')} disabled={busyId === account.id}>
                        Désactiver
                      </SecondaryButton>
                    ) : (
                      <SecondaryButton onClick={() => setStatus(account, 'active')} disabled={busyId === account.id}>
                        Réactiver
                      </SecondaryButton>
                    )}
                    <SecondaryButton danger onClick={() => deleteAccount(account)} disabled={busyId === account.id}>
                      Supprimer
                    </SecondaryButton>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
