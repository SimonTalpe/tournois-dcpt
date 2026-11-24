import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Notice, SecondaryButton, TextField } from '../../components/ui.tsx'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import { normalizeEmail, validateEmail, validateEmailDomain } from '../auth/validation.ts'

/** Domaines (ex. fft.fr) et adresses individuelles autorisés à créer un compte. */
export function AllowedEmailsSection() {
  const [domains, setDomains] = useState<string[]>([])
  const [emails, setEmails] = useState<string[]>([])
  const [newEntry, setNewEntry] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    const [d, e] = await Promise.all([
      supabase.from('allowed_email_domains').select('domain').order('domain'),
      supabase.from('allowed_emails').select('email').order('email'),
    ])
    setDomains((d.data ?? []).map((row) => row.domain as string))
    setEmails((e.data ?? []).map((row) => row.email as string))
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const value = newEntry.trim().toLowerCase()
    setError(null)
    // Une adresse complète (prenom@domaine.fr) ou un domaine seul (domaine.fr / @domaine.fr).
    const isEmail = /^[^@\s]+@/.test(value)
    const entryError = isEmail ? validateEmail(value) : validateEmailDomain(value)
    if (entryError) return setError(entryError)
    const { error: insertError } = isEmail
      ? await supabase.from('allowed_emails').insert({ email: normalizeEmail(value) })
      : await supabase.from('allowed_email_domains').insert({ domain: value.replace(/^@/, '') })
    if (insertError) {
      return setError(insertError.code === '23505' ? 'Déjà dans la liste.' : translateError(insertError))
    }
    setNewEntry('')
    await load()
  }

  async function remove(kind: 'domain' | 'email', value: string) {
    if (!supabase) return
    if (kind === 'domain' && !window.confirm(`Retirer le domaine ${value} ? Les nouvelles inscriptions seront refusées.`)) {
      return
    }
    const { error: deleteError } =
      kind === 'domain'
        ? await supabase.from('allowed_email_domains').delete().eq('domain', value)
        : await supabase.from('allowed_emails').delete().eq('email', value)
    if (deleteError) return setError(translateError(deleteError))
    await load()
  }

  return (
    <section className="space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">Adresses autorisées à l'inscription</h2>
      <p className="text-sm text-muted">
        Les comptes déjà créés ne sont pas concernés par un retrait : utilise « Désactiver » pour cela.
      </p>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Domaines</h3>
        <ul className="flex flex-wrap gap-2">
          {domains.map((domain) => (
            <li key={domain} className="flex items-center gap-2 rounded-full bg-mist py-1 pr-1 pl-3 text-sm">
              @{domain}
              <SecondaryButton danger onClick={() => remove('domain', domain)}>
                Retirer
              </SecondaryButton>
            </li>
          ))}
        </ul>
        <h3 className="text-sm font-semibold">Adresses individuelles (tests)</h3>
        {emails.length === 0 ? (
          <p className="text-sm text-muted">Aucune.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {emails.map((email) => (
              <li key={email} className="flex items-center gap-2 rounded-full bg-ochre-tint py-1 pr-1 pl-3 text-sm break-all">
                {email}
                <SecondaryButton danger onClick={() => remove('email', email)}>
                  Retirer
                </SecondaryButton>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={handleAdd} noValidate>
        <div className="flex-1">
          <TextField
            label="Ajouter un domaine ou une adresse"
            name="allowedEntry"
            autoCapitalize="none"
            placeholder="ex. fff.fr ou prenom@gmail.com"
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value)}
          />
        </div>
        <SecondaryButton type="submit">Ajouter</SecondaryButton>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}
