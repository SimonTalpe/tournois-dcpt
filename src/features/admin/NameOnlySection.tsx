import { useCallback, useEffect, useState } from 'react'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import {
  deletePlayer,
  linkPlayerToAccount,
  listLinkableAccounts,
  listNameOnlyPlayers,
  renamePlayer,
  type NameOnlyPlayer,
} from '../tournaments/api.ts'

type Account = { id: string; full_name: string; hasPlayer: boolean }
type Mode = { playerId: string; kind: 'link' | 'rename' } | null

const normalize = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

/** « Noms seuls » : rattachement à un compte (avec fusion), renommage, suppression. */
export function NameOnlySection() {
  const [players, setPlayers] = useState<NameOnlyPlayer[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [mode, setMode] = useState<Mode>(null)
  const [accountId, setAccountId] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, accountList] = await Promise.all([listNameOnlyPlayers(), listLinkableAccounts()])
      setPlayers(list)
      setAccounts(accountList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  function open(player: NameOnlyPlayer, kind: 'link' | 'rename') {
    setMode({ playerId: player.id, kind })
    setAccountId('')
    setNewName(player.full_name)
    setError(null)
    setMessage(null)
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(success)
      setMode(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function link(player: NameOnlyPlayer) {
    const account = accounts.find((a) => a.id === accountId)
    if (!account) return
    const merge = account.hasPlayer
      ? `\n\n${account.full_name} a déjà une fiche joueur : les deux fiches seront fusionnées.`
      : ''
    const confirmed = window.confirm(
      `Rattacher « ${player.full_name} » au compte de ${account.full_name} ?\n\nSes inscriptions et ses matchs (joués et à venir) passeront sur ce compte, sous le nom « ${account.full_name} ».${merge}\n\nCette opération ne peut pas être annulée.`,
    )
    if (!confirmed) return
    void run(
      () => linkPlayerToAccount(player.id, account.id),
      `« ${player.full_name} » est maintenant rattaché au compte de ${account.full_name}.`,
    )
  }

  function rename(player: NameOnlyPlayer) {
    const name = newName.trim()
    if (name.length < 2 || name.length > 80) return setError('Le nom doit contenir entre 2 et 80 caractères.')
    const duplicate = players?.some((p) => p.id !== player.id && normalize(p.full_name) === normalize(name))
    if (duplicate) return setError(`Un autre « nom seul » s'appelle déjà « ${name} ». Différencie-les (ex. « Julien M. »).`)
    void run(() => renamePlayer(player.id, name), `« ${player.full_name} » renommé en « ${name} ».`)
  }

  function remove(player: NameOnlyPlayer) {
    if (!window.confirm(`Supprimer le nom seul « ${player.full_name} » ?`)) return
    void run(() => deletePlayer(player.id), `« ${player.full_name} » supprimé.`)
  }

  return (
    <section className="space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">Noms seuls</h2>
      <p className="text-sm text-muted">
        Joueurs sans compte. Quand l'un d'eux crée son compte, rattache-le : ses inscriptions et ses matchs passent sur
        son compte.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {!players ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : players.length === 0 ? (
        <p className="text-sm text-muted">Aucun nom seul.</p>
      ) : (
        <ul className="divide-y divide-black">
          {players.map((player) => {
            const current = mode?.playerId === player.id ? mode.kind : null
            return (
              <li key={player.id} className="space-y-2 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{player.full_name}</p>
                    <p className="text-xs text-muted">
                      {player.tournaments.length === 0
                        ? 'Aucun tournoi'
                        : `${player.tournaments.join(', ')} · ${player.match_count} match${player.match_count > 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton disabled={busy} onClick={() => (current === 'link' ? setMode(null) : open(player, 'link'))}>
                      Rattacher à un compte
                    </SecondaryButton>
                    <SecondaryButton
                      disabled={busy}
                      onClick={() => (current === 'rename' ? setMode(null) : open(player, 'rename'))}
                    >
                      Renommer
                    </SecondaryButton>
                    {player.tournaments.length === 0 && (
                      <SecondaryButton danger disabled={busy} onClick={() => remove(player)}>
                        Supprimer
                      </SecondaryButton>
                    )}
                  </div>
                </div>
                {current === 'link' && (
                  <div className="flex flex-col gap-2 rounded-xl bg-chalk p-3 sm:flex-row sm:items-center">
                    <select
                      aria-label="Compte à rattacher"
                      className="w-full rounded-xl border border-black bg-white px-3 py-2.5 text-base sm:flex-1"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      <option value="">Choisir un compte…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}
                          {a.hasPlayer ? ' (a déjà une fiche joueur : fusion)' : ''}
                        </option>
                      ))}
                    </select>
                    <SecondaryButton disabled={busy || !accountId} onClick={() => link(player)}>
                      Rattacher
                    </SecondaryButton>
                  </div>
                )}
                {current === 'rename' && (
                  <div className="flex flex-col gap-2 rounded-xl bg-chalk p-3 sm:flex-row sm:items-center">
                    <input
                      aria-label="Nouveau nom"
                      className="w-full rounded-xl border border-black px-3 py-2.5 text-base sm:flex-1"
                      value={newName}
                      maxLength={80}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <SecondaryButton disabled={busy} onClick={() => rename(player)}>
                      Enregistrer
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
