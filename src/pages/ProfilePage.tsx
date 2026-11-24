import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { DemoModeNotice, Icon, Notice, PrimaryButton, SecondaryButton, TextField } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { playerIdForProfile, renameMe } from '../features/profile/api.ts'
import { PlayerStatsView } from '../features/profile/PlayerStatsView.tsx'
import { invokeFunction } from '../lib/functions.ts'

/** Mon profil : informations, statistiques et historique, suppression du compte. */
export function ProfilePage() {
  const auth = useAuth()
  const { profile, session, demoMode } = auth
  const [playerId, setPlayerId] = useState<string | null | undefined>(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const navigate = useNavigate()

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
        <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">Mon profil</h1>
        <DemoModeNotice />
      </section>
    )
  }

  return (
    <section className="space-y-8">
      <div className="max-w-2xl border-[3px] border-black">
        <div className="flex items-start justify-between gap-3 bg-ochre px-5 pt-5 pb-4 text-white sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Carte de joueur</p>
            <h1 className="mt-1.5 font-display text-[56px] leading-[0.86] font-black break-words sm:text-[80px]">
              {profile.full_name}
            </h1>
          </div>
          <button
            type="button"
            aria-label="Réglages du compte"
            aria-expanded={settingsOpen}
            aria-controls="reglages"
            onClick={() => setSettingsOpen((v) => !v)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-white hover:bg-ochre-text"
          >
            <Icon name="settings" />
          </button>
        </div>
        <p className="border-t-2 border-black px-5 py-2.5 text-[15px] break-all sm:px-6">{session?.user.email}</p>
      </div>

      {settingsOpen && (
        <section id="reglages" aria-labelledby="reglages-titre" className="max-w-2xl space-y-5 border-2 border-black p-5">
          <h2 id="reglages-titre" className="font-display text-4xl leading-none font-black">
            Réglages
          </h2>
          <NameEditor />
          <div className="flex flex-wrap gap-3">
            <Link
              to="/nouveau-mot-de-passe"
              className="inline-flex min-h-11 items-center border-2 border-black px-3.5 text-sm font-semibold hover:bg-black hover:text-white"
            >
              Changer mon mot de passe
            </Link>
            <SecondaryButton
              onClick={() => {
                void auth.signOut().then(() => navigate('/', { replace: true }))
              }}
            >
              Se déconnecter
            </SecondaryButton>
          </div>
          <DeleteAccount />
        </section>
      )}

      {playerId === undefined ? (
        <p>Chargement…</p>
      ) : playerId === null ? (
        <p className="border-2 border-dashed border-black p-4 text-[15px]">
          Pas encore de match joué : ton Elo, ton historique et tes statistiques apparaîtront ici.
        </p>
      ) : (
        <PlayerStatsView playerId={playerId} />
      )}
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
        <p className="text-base">
          Nom affiché : <strong>{profile.full_name}</strong>
        </p>
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
        <button type="button" className="text-sm text-muted underline" onClick={() => setEditing(false)}>
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
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
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
            <button type="button" className="text-sm text-muted underline" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
