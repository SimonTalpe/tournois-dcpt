import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Notice, PrimaryButton, SecondaryButton } from '../../components/ui.tsx'
import { newGameId } from '../darts/storage.ts'
import { DISCIPLINE_ICONS, DISCIPLINE_LABELS, type Discipline } from '../tournaments/types.ts'
import {
  correctRankedMatch,
  deleteRankedMatch,
  getRankedMatch,
  listRankablePeople,
  recordRankedMatch,
  type RankedDeltas,
  type RankedMatch,
} from './api.ts'
import { formatDelta } from './leaderboard.ts'
import {
  parseRankedScore,
  RANKED_FORMAT_LABELS,
  rankedRights,
  rankedScoreLabel,
  type RankedViewer,
  type ScoreForm,
} from './ranked.ts'

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

type Viewer = RankedViewer & { name: string }

/** Fenêtre en bas d'écran (mobile) ou centrée (ordinateur). */
function Dialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranked-dialog-title"
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ranked-dialog-title" className="text-lg font-bold text-court">
              {title}
            </h2>
            <p className="text-sm text-ink/60">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl text-ink/50 hover:bg-ink/5"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

function emptyForm(discipline: Discipline): ScoreForm {
  return discipline === 'mini_pong' ? { discipline, home: '', away: '' } : { discipline, winner: null, loserRemaining: '' }
}

/** Saisie du score : mini-pong = score du set ; fléchettes = vainqueur + reste du perdant (facultatif). */
function ScoreFields({
  form,
  onChange,
  homeName,
  awayName,
}: {
  form: ScoreForm
  onChange: (f: ScoreForm) => void
  homeName: string
  awayName: string
}) {
  if (form.discipline === 'mini_pong') {
    const field = (side: 'home' | 'away', label: string) => (
      <label className="block min-w-0 flex-1 space-y-1 text-center">
        <span className="block truncate text-sm font-medium">{label}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={99}
          value={form[side]}
          onChange={(e) => onChange({ ...form, [side]: e.target.value })}
          className="w-full rounded-xl border border-ink/20 px-3 py-3 text-center text-2xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-court/40"
        />
      </label>
    )
    return (
      <div className="flex items-end gap-3">
        {field('home', homeName)}
        <span className="pb-3 text-xl text-ink/40">–</span>
        {field('away', awayName)}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Vainqueur</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vainqueur">
        {(['home', 'away'] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={form.winner === side}
            onClick={() => onChange({ ...form, winner: side })}
            className={`truncate rounded-xl border-2 px-2 py-3 font-semibold transition ${
              form.winner === side ? 'border-court bg-court text-chalk' : 'border-court/20 bg-white text-court'
            }`}
          >
            🏆 {side === 'home' ? homeName : awayName}
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">Reste du perdant (facultatif)</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={301}
          value={form.loserRemaining}
          onChange={(e) => onChange({ ...form, loserRemaining: e.target.value })}
          className="w-full rounded-xl border border-ink/20 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-court/40"
        />
      </label>
    </div>
  )
}

function DeltaNotice({ deltas, homeName, awayName }: { deltas: RankedDeltas; homeName: string; awayName: string }) {
  return (
    <Notice tone="success">
      ✅ Match enregistré. Elo : {homeName} {deltas.home_delta === null ? '' : formatDelta(deltas.home_delta)} · {awayName}{' '}
      {deltas.away_delta === null ? '' : formatDelta(deltas.away_delta)}
    </Notice>
  )
}

/** Nouveau match classé. Joueur : lui contre un adversaire ; admin : deux comptes au choix. */
export function NewRankedMatchDialog({
  discipline,
  viewer,
  onClose,
  onSaved,
}: {
  discipline: Discipline
  viewer: Viewer
  onClose: () => void
  onSaved: () => void
}) {
  const [id] = useState(newGameId)
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [homeId, setHomeId] = useState(viewer.profileId ?? '')
  const [awayId, setAwayId] = useState('')
  const [form, setForm] = useState<ScoreForm>(() => emptyForm(discipline))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<RankedDeltas | null>(null)

  useEffect(() => {
    let alive = true
    listRankablePeople()
      .then((list) => alive && setPeople(list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'))))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])

  const nameOf = (profileId: string) =>
    profileId === viewer.profileId ? viewer.name : (people.find((p) => p.id === profileId)?.full_name ?? '…')
  const homeName = homeId ? nameOf(homeId) : 'Joueur 1'
  const awayName = awayId ? nameOf(awayId) : 'Adversaire'

  async function save() {
    if (!homeId || !awayId) return setError('Choisis les deux joueurs.')
    if (homeId === awayId) return setError('Choisis deux joueurs différents.')
    const parsed = parseRankedScore(form)
    if ('error' in parsed) return setError(parsed.error)
    const winner = parsed.winner === 'home' ? homeName : awayName
    const loser = parsed.winner === 'home' ? awayName : homeName
    if (
      !window.confirm(
        `Enregistrer la victoire de ${winner} contre ${loser} ? ${loser === viewer.name || winner === viewer.name ? 'Ton adversaire sera notifié.' : 'Les deux joueurs seront notifiés.'}`,
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      setDone(await recordRankedMatch({ id, discipline, homeProfileId: homeId, awayProfileId: awayId, score: parsed.score }))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const select = (value: string, onChange: (v: string) => void, label: string, exclude: string) => (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-court/40"
      >
        <option value="">— Choisir —</option>
        {people
          .filter((p) => p.id !== exclude)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
      </select>
    </label>
  )

  return (
    <Dialog
      title={`${DISCIPLINE_ICONS[discipline]} Match classé`}
      subtitle={`${DISCIPLINE_LABELS[discipline]} · ${RANKED_FORMAT_LABELS[discipline]}`}
      onClose={onClose}
    >
      {done ? (
        <>
          <DeltaNotice deltas={done} homeName={homeName} awayName={awayName} />
          <PrimaryButton type="button" onClick={onClose}>
            Fermer
          </PrimaryButton>
        </>
      ) : (
        <>
          {viewer.isAdmin ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {select(homeId, setHomeId, 'Joueur 1', awayId)}
              {select(awayId, setAwayId, 'Joueur 2', homeId)}
            </div>
          ) : (
            select(awayId, setAwayId, 'Adversaire', homeId)
          )}
          <ScoreFields form={form} onChange={setForm} homeName={homeName} awayName={awayName} />
          <p className="text-xs text-ink/60">
            Le résultat compte tout de suite pour l’Elo. Tu peux le corriger ou l’effacer pendant 24 heures ; ensuite, seul
            l’admin le peut. 3 matchs classés par jour au plus contre le même adversaire.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <PrimaryButton type="button" busy={busy} onClick={() => void save()}>
            ✅ Enregistrer le match
          </PrimaryButton>
        </>
      )}
    </Dialog>
  )
}

/** Détail d'un match classé ; correction ou effacement si autorisé. */
export function RankedMatchDialog({
  matchId,
  viewer,
  onClose,
  onSaved,
}: {
  matchId: string
  viewer: Viewer
  onClose: () => void
  onSaved: () => void
}) {
  const [match, setMatch] = useState<RankedMatch | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ScoreForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<ReactNode>(null)

  useEffect(() => {
    let alive = true
    getRankedMatch(matchId)
      .then((m) => alive && setMatch(m))
      .catch((e: unknown) => {
        if (!alive) return
        setMatch(null)
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [matchId])

  if (match === undefined) {
    return (
      <Dialog title="Match classé" subtitle="" onClose={onClose}>
        <p className="text-ink/60">Chargement…</p>
      </Dialog>
    )
  }
  if (match === null) {
    return (
      <Dialog title="Match classé" subtitle="" onClose={onClose}>
        <Notice tone={error ? 'error' : 'info'}>{error ?? 'Ce match classé n’existe plus (effacé ?).'}</Notice>
      </Dialog>
    )
  }

  const homeName = match.home?.full_name ?? 'Joueur'
  const awayName = match.away?.full_name ?? 'Joueur'
  const winnerName = match.winner_player_id === match.home_player_id ? homeName : awayName
  const loserName = match.winner_player_id === match.home_player_id ? awayName : homeName
  const rights = rankedRights(match, viewer)
  const score = rankedScoreLabel(match)

  function startEdit(m: RankedMatch) {
    const winner = m.winner_player_id === m.home_player_id ? 'home' : 'away'
    setForm(
      m.discipline === 'mini_pong'
        ? { discipline: 'mini_pong', home: String(m.home_points ?? ''), away: String(m.away_points ?? '') }
        : { discipline: 'darts', winner, loserRemaining: m.loser_remaining === null ? '' : String(m.loser_remaining) },
    )
    setEditing(true)
    setError(null)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function saveCorrection() {
    if (!form || !match) return
    const parsed = parseRankedScore(form)
    if ('error' in parsed) return setError(parsed.error)
    const winner = parsed.winner === 'home' ? homeName : awayName
    if (!window.confirm(`Corriger : victoire de ${winner} ? ${'L’Elo sera recalculé et ton adversaire notifié à nouveau.'}`))
      return
    return run(async () => {
      const deltas = await correctRankedMatch(match.id, parsed.score)
      setMatch(await getRankedMatch(match.id))
      setEditing(false)
      setMessage(<DeltaNotice deltas={deltas} homeName={homeName} awayName={awayName} />)
    })
  }

  function remove() {
    if (!match || !window.confirm('Effacer ce match classé ? Il ne comptera plus pour l’Elo.')) return
    return run(async () => {
      await deleteRankedMatch(match.id)
      onClose()
    })
  }

  return (
    <Dialog
      title={`${DISCIPLINE_ICONS[match.discipline]} Match classé`}
      subtitle={`${DISCIPLINE_LABELS[match.discipline]} · ${dateTimeFormat.format(new Date(match.played_at))}`}
      onClose={onClose}
    >
      <div className="space-y-1 rounded-2xl bg-chalk p-4">
        <p className="text-lg">
          🏆 <PlayerLink player={match.winner_player_id === match.home_player_id ? match.home : match.away} name={winnerName} />{' '}
          <span className="text-ink/60">bat</span>{' '}
          <PlayerLink player={match.winner_player_id === match.home_player_id ? match.away : match.home} name={loserName} />
        </p>
        {score && (
          <p className="text-sm text-ink/70 tabular-nums">
            {match.discipline === 'mini_pong' ? `${homeName} ${score} ${awayName}` : `Perdant : ${score}`}
          </p>
        )}
        {match.dart_game_id && <p className="text-xs text-ink/50">🎯 Joué au compteur</p>}
        <p className="text-xs text-ink/50">
          Saisi par {match.author?.full_name ?? 'un joueur'}
          {match.created_by_admin ? ' (admin)' : ''}
          {match.updated_at !== match.played_at &&
          new Date(match.updated_at).getTime() - new Date(match.played_at).getTime() > 1000
            ? ` · modifié le ${dateTimeFormat.format(new Date(match.updated_at))}`
            : ''}
        </p>
      </div>

      {message}
      {!rights.canEdit && rights.reason && <Notice>{rights.reason}</Notice>}

      {rights.canEdit && editing && form && (
        <div className="space-y-3 border-t border-ink/10 pt-4">
          <h3 className="font-semibold">Corriger le résultat</h3>
          <ScoreFields form={form} onChange={setForm} homeName={homeName} awayName={awayName} />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <PrimaryButton type="button" busy={busy} onClick={() => void saveCorrection()}>
                Enregistrer la correction
              </PrimaryButton>
            </div>
            <button type="button" className="text-sm text-ink/60 underline" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {rights.canEdit && !editing && (
        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-4">
          <SecondaryButton disabled={busy} onClick={() => startEdit(match)}>
            ✏️ Corriger
          </SecondaryButton>
          <SecondaryButton danger disabled={busy} onClick={() => void remove()}>
            Effacer le match
          </SecondaryButton>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  )
}

function PlayerLink({ player, name }: { player: { id: string } | null; name: string }) {
  if (!player) return <span className="font-semibold">{name}</span>
  return (
    <Link to={`/joueurs/${player.id}`} className="font-semibold text-court underline-offset-2 hover:underline">
      {name}
    </Link>
  )
}
