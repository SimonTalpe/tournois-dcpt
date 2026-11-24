import { useEffect, useState, type FormEvent } from 'react'
import { Notice, PrimaryButton } from '../../components/ui.tsx'
import { listDartPeople, type DartPerson, type Participant } from './api.ts'
import { MAX_PLAYERS, type GameMode } from './engine.ts'
import { moveItem, newNameProblem, normalizeName, rankedEligible, searchPeople, shuffled } from './setup.ts'
import { newGameId } from './storage.ts'

export type SetupValue = {
  participants: Participant[]
  start: GameMode
  doubleOut: boolean
  /** Match classé (compte pour l'Elo) : seulement si rankedEligible. */
  ranked: boolean
}

type Props = {
  /** Mode local (spectateur) : noms libres, rien n'est enregistré. */
  local: boolean
  initial: SetupValue
  onLaunch: (value: SetupValue) => void
  /** Joueur qui tient le compteur (match classé : il doit en être, sauf l'admin). */
  viewer: { profileId: string | null; isAdmin: boolean }
}

const KIND_LABELS: Record<Participant['ref']['kind'], string | null> = {
  account: null,
  name_only: 'nom seul',
  new: 'nouveau',
  guest: null,
  player: null,
}

/** Configuration d'une partie : joueurs (ordre de jeu), 301/501, sortie sur double. */
export function SetupScreen({ local, initial, onLaunch, viewer }: Props) {
  const [participants, setParticipants] = useState<Participant[]>(initial.participants)
  const [start, setStart] = useState<GameMode>(initial.start)
  const [doubleOut, setDoubleOut] = useState(initial.doubleOut)
  const [ranked, setRanked] = useState(initial.ranked)
  const [people, setPeople] = useState<DartPerson[]>([])
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    if (local) return
    let alive = true
    listDartPeople()
      .then((list) => alive && setPeople(list))
      .catch((e: unknown) => alive && setPeopleError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [local])

  const full = participants.length >= MAX_PLAYERS
  const canRank = !local && rankedEligible(participants, start, doubleOut, viewer)
  const suggestions = local || full ? [] : searchPeople(people, participants, query, query.trim() ? 6 : 4)
  const trimmed = query.trim().replace(/\s+/g, ' ')
  const exactSuggestion = suggestions.find((p) => normalizeName(p.full_name) === normalizeName(trimmed))

  function addPerson(person: DartPerson) {
    if (full) return
    const ref: Participant['ref'] =
      person.kind === 'account' ? { kind: 'account', profileId: person.id } : { kind: 'name_only', playerId: person.id }
    setParticipants((list) => [...list, { key: newGameId(), name: person.full_name, ref }])
    setQuery('')
    setAddError(null)
  }

  function addNewName() {
    const problem = newNameProblem(trimmed, people, participants)
    if (problem) {
      setAddError(problem)
      return
    }
    setParticipants((list) => [...list, { key: newGameId(), name: trimmed, ref: { kind: local ? 'guest' : 'new' } }])
    setQuery('')
    setAddError(null)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed) return
    if (exactSuggestion) addPerson(exactSuggestion)
    else if (suggestions.length === 1 && !local) addPerson(suggestions[0])
    else addNewName()
  }

  return (
    <div className="space-y-6">
      {local && (
        <Notice>Mode local : la partie se joue sur cet appareil et ne sera pas enregistrée.</Notice>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[30px] leading-none font-extrabold">
            Joueurs <span className="text-sm font-normal text-muted">({participants.length}/{MAX_PLAYERS})</span>
          </h2>
          {participants.length > 1 && (
            <button
              type="button"
              onClick={() => setParticipants((list) => shuffled(list))}
              className="rounded-lg border border-black px-3 py-1.5 text-sm font-medium text-court hover:bg-mist"
            >
              Tirer au sort l'ordre
            </button>
          )}
        </div>

        {participants.length > 0 ? (
          <ol className="divide-y divide-black rounded-2xl bg-white border-2 border-black">
            {participants.map((p, i) => (
              <li key={p.key} className="flex items-center gap-2 px-3 py-2">
                <span className="w-6 shrink-0 text-center font-bold text-court">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  {KIND_LABELS[p.ref.kind] && (
                    <span className="ml-2 rounded bg-mist px-1.5 text-xs">{KIND_LABELS[p.ref.kind]}</span>
                  )}
                </span>
                <IconButton
                  label={`Monter ${p.name}`}
                  disabled={i === 0}
                  onClick={() => setParticipants((list) => moveItem(list, i, i - 1))}
                >
                  ↑
                </IconButton>
                <IconButton
                  label={`Descendre ${p.name}`}
                  disabled={i === participants.length - 1}
                  onClick={() => setParticipants((list) => moveItem(list, i, i + 1))}
                >
                  ↓
                </IconButton>
                <IconButton
                  label={`Retirer ${p.name}`}
                  danger
                  onClick={() => setParticipants((list) => list.filter((x) => x.key !== p.key))}
                >
                  ✕
                </IconButton>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">Ajoute au moins un joueur (une partie à 1 = entraînement).</p>
        )}

        {full ? (
          <p className="text-sm text-muted">Nombre maximum de joueurs atteint.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Ajouter un joueur"
                placeholder={local ? 'Nom du joueur…' : 'Rechercher ou saisir un nom…'}
                autoComplete="off"
                enterKeyHint="done"
                className="min-w-0 flex-1 rounded-xl border border-black bg-white px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ochre"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setAddError(null)
                }}
              />
              <button
                type="submit"
                disabled={!trimmed}
                className="shrink-0 rounded-xl bg-court px-4 font-semibold text-chalk disabled:opacity-40"
              >
                Ajouter
              </button>
            </div>
            {suggestions.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Joueurs proposés">
                {suggestions.map((p) => (
                  <li key={`${p.kind}:${p.id}`}>
                    <button
                      type="button"
                      onClick={() => addPerson(p)}
                      className="rounded-full border border-black bg-white px-3 py-1.5 text-sm hover:bg-mist"
                    >
                      + {p.full_name}
                      {p.kind === 'name_only' && <span className="ml-1 text-xs text-muted">(nom seul)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!local && trimmed.length >= 2 && !exactSuggestion && (
              <button type="button" onClick={addNewName} className="text-sm font-medium text-ochre-text underline">
                + Ajouter « {trimmed} » comme nouveau joueur (sans compte)
              </button>
            )}
            {addError && <Notice tone="error">{addError}</Notice>}
            {peopleError && <Notice tone="error">{peopleError}</Notice>}
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[30px] leading-none font-extrabold">Règles</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode de jeu">
          {([301, 501] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={start === mode}
              onClick={() => setStart(mode)}
              className={`rounded-xl border-2 py-3 text-xl font-bold transition ${
                start === mode ? 'border-court bg-court text-chalk' : 'border-black bg-white text-court'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 border-2 border-black">
          <span>
            <span className="block font-medium">Finir sur un double</span>
            <span className="block text-xs text-muted">Le dernier lancer doit être un double (ou le Bull).</span>
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 accent-court"
            checked={doubleOut}
            onChange={(e) => setDoubleOut(e.target.checked)}
          />
        </label>
      </section>

      {!local && (
        <section className="space-y-2">
          <label
            className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border-2 border-black ${
              canRank ? 'cursor-pointer bg-white' : 'bg-white/60 text-muted'
            }`}
          >
            <span>
              <span className="block font-medium">Match classé</span>
              <span className="block text-xs text-muted">
                {canRank
                  ? 'Le résultat compte pour l’Elo des deux joueurs ; ton adversaire sera notifié.'
                  : 'Possible à 2 joueurs avec compte (dont toi), en 301 sortie simple.'}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-6 w-6 accent-court"
              disabled={!canRank}
              checked={canRank && ranked}
              onChange={(e) => setRanked(e.target.checked)}
            />
          </label>
        </section>
      )}

      <PrimaryButton
        type="button"
        disabled={participants.length === 0}
        onClick={() => onLaunch({ participants, start, doubleOut, ranked: canRank && ranked })}
      >
        {canRank && ranked ? 'Lancer le match classé' : 'Lancer la partie'}
      </PrimaryButton>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`h-9 w-9 shrink-0 rounded-lg text-lg disabled:opacity-25 ${
        danger ? 'text-clay hover:bg-ochre-tint' : 'text-court hover:bg-mist'
      }`}
    >
      {children}
    </button>
  )
}
