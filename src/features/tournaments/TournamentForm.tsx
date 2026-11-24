import { useState, type FormEvent, type ReactNode } from 'react'
import { Notice, PrimaryButton, TextField } from '../../components/ui.tsx'
import { normalizeRichText } from '../content/richText.ts'
import { LazyRichTextEditor as RichTextEditor } from '../content/LazyRichTextEditor.tsx'
import {
  DISCIPLINE_LABELS,
  FORMAT_LABELS,
  NEXT_STAGE_LABELS,
  PAIRING_LABELS,
  qualificationDefaults,
  type Discipline,
  type QualificationNextStage,
  type QualificationPairing,
  type TournamentFormat,
  type TournamentInput,
} from './types.ts'

type Props = {
  initial: TournamentInput
  /** Tournoi lancé : discipline, format et options ne sont plus modifiables. */
  structureLocked?: boolean
  submitLabel: string
  onSubmit: (input: TournamentInput) => Promise<void>
}

function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-xl border border-black px-3 py-2 text-sm has-[:checked]:border-court has-[:checked]:bg-court has-[:checked]:text-chalk has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              className="sr-only"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 accent-court"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** Réglages de qualification renseignés (les valeurs vides prennent les valeurs par défaut). */
function stripNulls(form: TournamentInput) {
  return Object.fromEntries(
    (['qualification_wins', 'qualification_losses', 'qualification_pairing', 'qualification_next_stage'] as const)
      .filter((key) => form[key] !== null)
      .map((key) => [key, form[key]]),
  ) as Partial<TournamentInput>
}

/** Création / configuration d'un tournoi (admin). */
export function TournamentForm({ initial, structureLocked = false, submitLabel, onSubmit }: Props) {
  const [form, setForm] = useState<TournamentInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TournamentInput>(key: K, value: TournamentInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const withPools = form.format === 'pools_knockout'
  const withQualification = form.format === 'qualification_knockout'
  const withGroups = withQualification && form.qualification_next_stage === 'groups'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const name = form.name.trim()
    if (name.length < 2) return setError('Donne un nom au tournoi (2 caractères minimum).')
    if (withPools && (!form.pool_count || form.pool_count < 1 || !form.qualifiers_per_pool || form.qualifiers_per_pool < 1)) {
      return setError('Indique le nombre de poules et de qualifiés par poule.')
    }
    const qualification = withQualification
      ? { ...qualificationDefaults(form.discipline), ...stripNulls(form) }
      : null
    setBusy(true)
    try {
      await onSubmit({
        ...form,
        name,
        description: normalizeRichText(form.description),
        pool_count: withPools ? form.pool_count : null,
        qualifiers_per_pool: withPools ? form.qualifiers_per_pool : null,
        consolation: withQualification ? false : form.consolation,
        qualification_wins: qualification?.qualification_wins ?? null,
        qualification_losses: qualification?.qualification_losses ?? null,
        qualification_pairing: qualification?.qualification_pairing ?? null,
        qualification_next_stage: qualification?.qualification_next_stage ?? null,
        group_size: withGroups ? (form.group_size ?? 3) : null,
        group_qualifiers: withGroups ? Math.min(form.group_qualifiers ?? 2, (form.group_size ?? 3) - 1) : null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const numberValue = (value: string) => (value === '' ? null : Math.max(0, Math.floor(Number(value))))

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <TextField
        label="Nom du tournoi"
        name="tournamentName"
        maxLength={80}
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="ex. Mini-pong de décembre"
      />

      <Choice<Discipline>
        legend="Discipline"
        value={form.discipline}
        disabled={structureLocked}
        options={(['mini_pong', 'darts'] as const).map((value) => ({ value, label: DISCIPLINE_LABELS[value] }))}
        onChange={(value) =>
          // Format par défaut propre à chaque discipline : 2 sets gagnants au mini-pong, 1 manche aux fléchettes.
          setForm((current) =>
            current.discipline === value
              ? current
              : {
                  ...current,
                  discipline: value,
                  default_sets_to_win: value === 'darts' || current.format === 'qualification_knockout' ? 1 : 2,
                  ...(current.format === 'qualification_knockout'
                    ? (({ qualification_next_stage, group_size, group_qualifiers }) => ({
                        qualification_next_stage,
                        group_size,
                        group_qualifiers,
                      }))(qualificationDefaults(value))
                    : {}),
                },
          )
        }
      />

      <div className="space-y-1">
        <label htmlFor="tournamentDescription" className="block text-sm font-medium">
          Description
        </label>
        <RichTextEditor
          id="tournamentDescription"
          initialValue={initial.description}
          onChange={(html) => set('description', html)}
          placeholder="Dates, déroulement, lots…"
        />
      </div>

      <Choice<TournamentFormat>
        legend="Format"
        value={form.format}
        disabled={structureLocked}
        options={(['knockout', 'pools_knockout', 'qualification_knockout'] as const).map((value) => ({
          value,
          label: FORMAT_LABELS[value],
        }))}
        onChange={(value) =>
          setForm((current) => ({
            ...current,
            format: value,
            pool_count: value === 'pools_knockout' ? (current.pool_count ?? 4) : null,
            qualifiers_per_pool: value === 'pools_knockout' ? (current.qualifiers_per_pool ?? 2) : null,
            ...(value === 'qualification_knockout'
              ? { ...qualificationDefaults(current.discipline), ...stripNulls(current), consolation: false, default_sets_to_win: 1 }
              : {
                  qualification_wins: null,
                  qualification_losses: null,
                  qualification_pairing: null,
                  qualification_next_stage: null,
                  group_size: null,
                  group_qualifiers: null,
                }),
          }))
        }
      />

      {withQualification && (
        <div className="space-y-4 bg-mist p-4">
          <p className="text-[15px] leading-snug">
            Chaque joueur affronte un joueur de même bilan. Il se qualifie pour la suite après ses victoires, il est
            éliminé après ses défaites. Avec les réglages par défaut : round 1, puis repêchage pour les perdants.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              legend="Victoires pour se qualifier"
              value={String(form.qualification_wins ?? 1)}
              disabled={structureLocked}
              options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(value) => set('qualification_wins', Number(value))}
            />
            <Choice
              legend="Défaites pour être éliminé"
              value={String(form.qualification_losses ?? 2)}
              disabled={structureLocked}
              options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(value) => set('qualification_losses', Number(value))}
            />
          </div>
          <Choice<QualificationPairing>
            legend="Création des matchs après le round 1"
            value={form.qualification_pairing ?? 'continuous'}
            disabled={structureLocked}
            options={(['continuous', 'end_of_round', 'manual'] as const).map((value) => ({ value, label: PAIRING_LABELS[value] }))}
            onChange={(value) => set('qualification_pairing', value)}
          />
          <p className="text-xs text-muted">
            Au fil de l’eau : un match se crée dès que deux joueurs de même bilan sont libres. À la fin de chaque round :
            quand tous les matchs du round sont joués. Par l’admin : bouton « Créer le round suivant » dans Gestion.
            Adversaire tiré au sort, sans revanche si possible ; nombre impair : un exempt tiré au sort.
          </p>
          <Choice<QualificationNextStage>
            legend="Étape avant le tableau final"
            value={form.qualification_next_stage ?? 'preliminary'}
            disabled={structureLocked}
            options={(['preliminary', 'groups', 'none'] as const).map((value) => ({ value, label: NEXT_STAGE_LABELS[value] }))}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                qualification_next_stage: value,
                group_size: value === 'groups' ? (current.group_size ?? 3) : null,
                group_qualifiers: value === 'groups' ? (current.group_qualifiers ?? 2) : null,
              }))
            }
          />
          <p className="text-xs text-muted">
            {form.qualification_next_stage === 'groups'
              ? 'Les qualifiés jouent des parties à plusieurs ; les premiers de chaque partie vont au tableau final.'
              : form.qualification_next_stage === 'none'
                ? 'Tous les qualifiés vont au tableau final, placés au tirage au sort.'
                : 'Les qualifiés sont classés (moins de défaites, puis différence de points) : les mieux classés sont exemptés du tour préliminaire.'}
          </p>
          {withGroups && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Choice
                  legend="Joueurs par partie"
                  value={String(form.group_size ?? 3)}
                  disabled={structureLocked}
                  options={[3, 4].map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      group_size: Number(value),
                      group_qualifiers: Math.min(current.group_qualifiers ?? 2, Number(value) - 1),
                    }))
                  }
                />
                <Choice
                  legend="Qualifiés par partie"
                  value={String(form.group_qualifiers ?? 2)}
                  disabled={structureLocked}
                  options={Array.from({ length: (form.group_size ?? 3) - 1 }, (_, i) => i + 1).map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  onChange={(value) => set('group_qualifiers', Number(value))}
                />
              </div>
              <Notice>
                Les parties à plusieurs arrivent dans la prochaine mise à jour du site. Tu peux déjà lancer la
                qualification : la phase finale pourra être générée une fois cette mise à jour en ligne.
              </Notice>
            </>
          )}
        </div>
      )}

      {withPools && (
        <div className="space-y-3 rounded-xl bg-chalk p-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Nombre de poules"
              name="poolCount"
              type="number"
              inputMode="numeric"
              min={1}
              max={16}
              disabled={structureLocked}
              value={form.pool_count ?? ''}
              onChange={(e) => set('pool_count', numberValue(e.target.value))}
            />
            <TextField
              label="Qualifiés par poule"
              name="qualifiersPerPool"
              type="number"
              inputMode="numeric"
              min={1}
              max={8}
              disabled={structureLocked}
              value={form.qualifiers_per_pool ?? ''}
              onChange={(e) => set('qualifiers_per_pool', numberValue(e.target.value))}
            />
          </div>
          <p className="text-xs text-muted">Les joueurs sont répartis au hasard ; les poules diffèrent au plus d'un joueur.</p>
          <Choice
            legend="Placement des qualifiés dans le tableau final"
            value={form.qualifier_placement}
            options={[
              { value: 'classic', label: 'Croisement classique' },
              { value: 'random', label: 'Tirage au sort' },
            ]}
            onChange={(value) => set('qualifier_placement', value)}
          />
          <p className="text-xs text-muted">
            Croisement classique : 1er A contre 2e B, 1er B contre 2e A… ; deux joueurs d'une même poule se retrouvent
            le plus tard possible.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <Toggle
          label="Match pour la 3e place"
          hint="Entre les perdants des demi-finales."
          checked={form.third_place}
          disabled={structureLocked}
          onChange={(value) => set('third_place', value)}
        />
        {!withQualification && (
          <Toggle
            label="Tableau de consolante"
            hint={withPools ? 'Pour les joueurs non qualifiés en sortie de poule.' : 'Pour les perdants du 1er tour.'}
            checked={form.consolation}
            disabled={structureLocked}
            onChange={(value) => set('consolation', value)}
          />
        )}
      </div>

      {structureLocked ? null : form.discipline === 'mini_pong' ? (
        <Choice
          legend="Format de jeu par défaut (modifiable ensuite pour chaque tour)"
          value={String(form.default_sets_to_win)}
          options={[1, 2, 3].map((n) => ({ value: String(n), label: n === 1 ? '1 set gagnant' : `${n} sets gagnants` }))}
          onChange={(value) => set('default_sets_to_win', Number(value))}
        />
      ) : (
        <fieldset className="space-y-3 rounded-xl border border-black p-3">
          <legend className="px-1 text-sm font-medium">Format de jeu par défaut (modifiable ensuite pour chaque tour)</legend>
          <Choice
            legend="Départ"
            value={String(form.default_dart_start)}
            options={[301, 501].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(value) => set('default_dart_start', Number(value))}
          />
          <Choice
            legend="Manches gagnantes"
            value={String(form.default_sets_to_win)}
            options={[1, 2, 3].map((n) => ({
              value: String(n),
              label: n === 1 ? '1 manche (partie unique)' : `${n} manches gagnantes`,
            }))}
            onChange={(value) => set('default_sets_to_win', Number(value))}
          />
          <Toggle
            label="Finir sur un double"
            hint="Le dernier lancer doit être un double (ou le Bull)."
            checked={form.default_dart_double_out}
            onChange={(value) => set('default_dart_double_out', value)}
          />
        </fieldset>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <PrimaryButton busy={busy}>{submitLabel}</PrimaryButton>
    </form>
  )
}
