import { Notice, PrimaryButton } from '../../components/ui.tsx'
import { medal } from './darts.ts'
import { ranking, type GameConfig, type GameState } from './engine.ts'

export type SaveStatus = { kind: 'local' } | { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

type Props = {
  config: GameConfig
  state: GameState
  save: SaveStatus
  onSave: () => void
  onUndo: () => void
  onRematch: () => void
  onNewGame: () => void
}

const TITLES = {
  over: '🏁 Partie terminée',
  stopped: '⏹ Partie arrêtée',
  cancelled: 'Partie annulée',
} as const

/** Fin de partie : classement, enregistrement du résultat, revanche. */
export function ResultScreen({ config, state, save, onSave, onUndo, onRematch, onNewGame }: Props) {
  const phase = state.phase === 'over' || state.phase === 'stopped' || state.phase === 'cancelled' ? state.phase : 'over'
  const rows = ranking(state)
  const recordable = phase !== 'cancelled'
  const canUndo = save.kind !== 'saved' && save.kind !== 'saving'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-court">{TITLES[phase]}</h2>
        <p className="text-sm text-ink/60">
          {config.start} · {config.doubleOut ? 'sortie double' : 'sortie simple'}
        </p>
      </div>

      {phase === 'cancelled' ? (
        <Notice>Aucun joueur n’a terminé : la partie est annulée et rien n’est enregistré.</Notice>
      ) : (
        <ol className="divide-y divide-ink/10 rounded-2xl bg-white shadow-sm">
          {rows.map((row) => (
            <li key={config.players[row.index].key} className="flex items-center gap-3 px-4 py-3">
              <span className="w-9 shrink-0 text-center text-xl font-bold">{medal(row.rank)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{config.players[row.index].name}</span>
                <span className="block text-xs text-ink/60">
                  {row.finished ? 'a fini' : `reste ${row.remaining}`} · {row.darts} fléchettes
                  {row.average !== null && ` · moy. ${row.average}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {recordable && save.kind === 'local' && <Notice>👀 Mode local : résultat non enregistré.</Notice>}
      {recordable && save.kind === 'saved' && <Notice tone="success">✅ Résultat enregistré.</Notice>}
      {recordable && save.kind === 'error' && <Notice tone="error">{save.message}</Notice>}

      <div className="space-y-2">
        {recordable && (save.kind === 'idle' || save.kind === 'saving' || save.kind === 'error') && (
          <PrimaryButton type="button" busy={save.kind === 'saving'} onClick={onSave}>
            {save.kind === 'error' ? 'Réessayer l’enregistrement' : '✅ Valider et enregistrer le résultat'}
          </PrimaryButton>
        )}
        {(!recordable || save.kind === 'saved' || save.kind === 'local') && (
          <>
            <PrimaryButton type="button" onClick={onRematch}>
              🔁 Revanche (mêmes joueurs)
            </PrimaryButton>
            <button
              type="button"
              onClick={onNewGame}
              className="w-full rounded-xl border border-court/30 bg-white py-3 font-semibold text-court"
            >
              Nouvelle partie
            </button>
          </>
        )}
        {canUndo && (
          <button type="button" onClick={onUndo} className="w-full py-2 text-sm text-ink/60 underline">
            ↶ Erreur de saisie : revenir à la partie
          </button>
        )}
      </div>
    </div>
  )
}
