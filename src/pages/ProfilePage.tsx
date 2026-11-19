import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { DemoModeNotice, Notice, PrimaryButton, SecondaryButton, TextField } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { playerIdForProfile, renameMe } from '../features/profile/api.ts'
import { PlayerStatsView } from '../features/profile/PlayerStatsView.tsx'
import { invokeFunction } from '../lib/functions.ts'

/** Mon profil : informations, statistiques et historique, suppression du compte. */
export function ProfilePage() {
  const auth = useAuth()
  const { profile, session, demoMode } = auth
  const [playerId, setPlayerId] = useState<string | null | undefined>(undefined)

  const profileId = profile?.id
  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    playerIdForProfile(profileId)
      .then((id) => !cancelled && setPlayerId(id))
      .catch(() => !cancelled && setPlayerId(null))
    return () => {
      cancelled = true
    }
  }, [profileId])

  if (demoMode || !profile) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-court">Mon profil</h1>
        <DemoModeNotice />
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <NameEditor />
        <p className="text-sm break-all text-ink/70">{session?.user.email}</p>
        <Link to="/nouveau-mot-de-passe" className="inline-block text-sm text-court underline">
          Changer mon mot de passe
        </Link>
      </section>

      {playerId === undefined ? (
        <p className="text-ink/60">Chargement…</p>
      ) : playerId === null ? (
        <div className="rounded-2xl border border-dashed border-court/30 bg-white p-4 text-sm text-ink/70">
          Pas encore de tournoi joué : ton historique et tes statistiques apparaîtront ici.
        </div>
      ) : (
        <PlayerStatsView playerId={playerId} />
      )}

      <DeleteAccount />
    </section>
  )
}

function NameEditor() {
  const { profile, refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.full_name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!profile) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 80) return setError('Le nom doit contenir entre 2 et 80 caractères.')
    setBusy(true)
    setError(null)
    try {
      await renameMe(profile!.id, trimmed)
      await refresh()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-court">{profile.full_name}</h1>
        <SecondaryButton
          onClick={() => {
            setName(profile.full_name)
            setEditing(true)
          }}
        >
          Modifier mon nom
        </SecondaryButton>
      </div>
    )
  }
  return (
    <form className="space-y-3" onSubmit={save} noValidate>
      <TextField
        label="Nom affiché (prénom et nom)"
        name="fullName"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint="Visible dans les tableaux et l’historique."
        error={error}
      />
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <PrimaryButton busy={busy}>Enregistrer</PrimaryButton>
        </div>
        <button type="button" className="text-sm text-ink/60 underline" onClick={() => setEditing(false)}>
          Annuler
        </button>
      </div>
    </form>
  )
}

function DeleteAccount() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleDelete(e: FormEvent) {
    e.preventDefault()
    if (confirmation.trim().toUpperCase() !== 'SUPPRIMER') return setError('Tape SUPPRIMER pour confirmer.')
    setBusy(true)
    setError(null)
    const result = await invokeFunction<{ ok: boolean }>('delete-account')
    if ('error' in result) {
      setBusy(false)
      return setError(result.error)
    }
    await signOut().catch(() => {})
    navigate('/', { replace: true, state: { accountDeleted: true } })
  }

  return (
    <section className="space-y-3 rounded-2xl border border-clay/30 bg-white p-4">
      <h2 className="font-bold text-clay">Supprimer mon compte</h2>
      {!open ? (
        <SecondaryButton danger onClick={() => setOpen(true)}>
          Supprimer mon compte…
        </SecondaryButton>
      ) : (
        <form className="space-y-3" onSubmit={handleDelete} noValidate>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
            <li>Ton nom sera remplacé par « Joueur supprimé » dans les tableaux et l’historique (les résultats sont conservés).</li>
            <li>Tu ne pourras plus te connecter ; ton adresse email sera effacée du site.</li>
            <li>Si tu as encore des matchs à jouer, l’admin te remplacera ou te déclarera forfait.</li>
            <li>C’est définitif : pour revenir, il faudra créer un nouveau compte.</li>
          </ul>
          <TextField
            label="Tape SUPPRIMER pour confirmer"
            name="deleteConfirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-clay px-4 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
            <button type="button" className="text-sm text-ink/60 underline" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
