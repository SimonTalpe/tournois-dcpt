import { useCallback, useEffect, useMemo, useState } from 'react'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { createNameOnlyPlayer, listSelectablePeople, playerForAccount } from './api.ts'
import type { Player } from './types.ts'

type Candidate = { key: string; label: string; kind: 'account' | 'name_only'; id: string }

type Props = {
  /** Participants à ne pas proposer (déjà inscrits). */
  excludedPlayerIds: Set<string>
  actionLabel: string
  /** Reçoit l'identifiant du participant choisi (créé au besoin) et son nom. */
  onPick: (playerId: string, label: string) => Promise<void>
  /** Confirmation éventuelle, demandée avant toute création. */
  confirmPick?: (label: string) => boolean
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Recherche d'un compte ou d'un « nom seul », avec création d'un nom seul. */
export function PeoplePicker({ excludedPlayerIds, actionLabel, onPick, confirmPick }: Props) {
  const [accounts, setAccounts] = useState<{ id: string; full_name: string }[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const people = await listSelectablePeople()
      setAccounts(people.accounts)
      setPlayers(people.players)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  const candidates = useMemo<Candidate[]>(() => {
    const playerByProfile = new Map(players.filter((p) => p.profile_id).map((p) => [p.profile_id as string, p]))
    const list: Candidate[] = [
      ...accounts
        .filter((a) => !excludedPlayerIds.has(playerByProfile.get(a.id)?.id ?? ''))
        .map((a) => ({ key: `a:${a.id}`, label: a.full_name, kind: 'account' as const, id: a.id })),
      ...players
        .filter((p) => !p.profile_id && !excludedPlayerIds.has(p.id))
        .map((p) => ({ key: `p:${p.id}`, label: p.full_name, kind: 'name_only' as const, id: p.id })),
    ]
    return list.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [accounts, players, excludedPlayerIds])

  const q = normalize(query.trim())
  const shown = q ? candidates.filter((c) => normalize(c.label).includes(q)) : candidates
  const exactExists = candidates.some((c) => normalize(c.label) === q) || players.some((p) => normalize(p.full_name) === q)

  async function pick(label: string, run: () => Promise<string>) {
    if (confirmPick && !confirmPick(label)) return
    setBusy(true)
    setError(null)
    try {
      await onPick(await run(), label)
      setQuery('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Rechercher un joueur"
        placeholder="Rechercher ou saisir un nom…"
        className="w-full rounded-xl border border-black px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ochre"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="max-h-64 divide-y divide-black overflow-y-auto rounded-xl border border-black">
        {shown.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate text-sm">
              {c.label}
              {c.kind === 'name_only' && <span className="ml-2 rounded bg-mist px-1.5 text-xs">nom seul</span>}
            </span>
            <SecondaryButton
              disabled={busy}
              onClick={() => pick(c.label, async () => (c.kind === 'account' ? playerForAccount(c.id) : c.id))}
            >
              {actionLabel}
            </SecondaryButton>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucun joueur trouvé.</li>}
      </ul>
      {query.trim().length >= 2 && !exactExists && (
        <SecondaryButton disabled={busy} onClick={() => pick(query.trim(), () => createNameOnlyPlayer(query))}>
          + Créer le « nom seul » « {query.trim()} » et {actionLabel.toLowerCase()}
        </SecondaryButton>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
