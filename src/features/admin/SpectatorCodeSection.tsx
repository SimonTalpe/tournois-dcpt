import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Notice, PrimaryButton, TextField } from '../../components/ui.tsx'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import { validateSpectatorCode } from '../auth/validation.ts'

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Définition / changement du code spectateur (stocké haché, jamais réaffiché). */
export function SpectatorCodeSection() {
  const [status, setStatus] = useState<{ is_set: boolean; updated_at: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.rpc('admin_spectator_code_status')
    const row = (data as { is_set: boolean; updated_at: string }[] | null)?.[0]
    setStatus(row ?? null)
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const codeError = validateSpectatorCode(code)
    if (codeError) return setError(codeError)
    if (status?.is_set && !window.confirm('Changer le code ? Les spectateurs actuels devront saisir le nouveau code.')) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error: saveError } = await supabase.rpc('admin_set_spectator_code', { p_code: code.trim() })
    setBusy(false)
    if (saveError) return setError(translateError(saveError))
    setMessage(`Nouveau code enregistré : « ${code.trim()} ». Note-le, il ne sera plus affiché.`)
    setCode('')
    await load()
  }

  return (
    <section className="space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">Code spectateur</h2>
      <p className="text-sm text-muted">
        {status?.is_set
          ? `Un code est défini (modifié le ${dateTimeFormat.format(new Date(status.updated_at))}). Il n'est jamais réaffiché.`
          : "Aucun code défini : l'accès « Regarder » est fermé."}
      </p>
      <form className="space-y-3" onSubmit={handleSubmit} noValidate>
        <TextField
          label={status?.is_set ? 'Nouveau code' : 'Code'}
          name="newSpectatorCode"
          autoComplete="off"
          autoCapitalize="none"
          hint="4 à 40 caractères. Changer le code déconnecte les spectateurs actuels."
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error}
        />
        {message && <Notice tone="success">{message}</Notice>}
        <PrimaryButton busy={busy}>Enregistrer le code</PrimaryButton>
      </form>
    </section>
  )
}
