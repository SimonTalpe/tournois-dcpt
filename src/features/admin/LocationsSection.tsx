import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { addLocation, deleteLocation, listLocations, renameLocation } from '../tournaments/api.ts'
import type { Location } from '../tournaments/types.ts'

/** Lieux des matchs : ajout, renommage, suppression (admin). */
export function LocationsSection() {
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLocations(await listLocations())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    if (newName.trim().length < 2) return setError('Le nom du lieu doit contenir au moins 2 caractères.')
    void run(async () => {
      await addLocation(newName)
      setNewName('')
    })
  }

  return (
    <section className="space-y-3 bg-mist p-5">
      <h2 className="font-display text-[30px] leading-none font-extrabold">Lieux des matchs</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {!locations ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : (
        <ul className="divide-y divide-black">
          {locations.map((location) => (
            <li key={location.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              {editing?.id === location.id ? (
                <input
                  aria-label="Nouveau nom du lieu"
                  className="min-w-0 flex-1 rounded-xl border border-black px-3 py-2 text-base"
                  value={editing.name}
                  maxLength={40}
                  onChange={(e) => setEditing({ id: location.id, name: e.target.value })}
                />
              ) : (
                <span>{location.name}</span>
              )}
              <div className="flex gap-2">
                {editing?.id === location.id ? (
                  <>
                    <SecondaryButton
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await renameLocation(location.id, editing.name)
                          setEditing(null)
                        })
                      }
                    >
                      Enregistrer
                    </SecondaryButton>
                    <SecondaryButton disabled={busy} onClick={() => setEditing(null)}>
                      Annuler
                    </SecondaryButton>
                  </>
                ) : (
                  <>
                    <SecondaryButton disabled={busy} onClick={() => setEditing({ id: location.id, name: location.name })}>
                      Renommer
                    </SecondaryButton>
                    <SecondaryButton
                      danger
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Supprimer le lieu « ${location.name} » ? Il sera retiré des matchs où il est indiqué.`))
                          void run(() => deleteLocation(location.id))
                      }}
                    >
                      Supprimer
                    </SecondaryButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input
          aria-label="Nom du nouveau lieu"
          placeholder="Nouveau lieu (ex. Cafétéria)"
          className="min-w-0 flex-1 rounded-xl border border-black px-3 py-2.5 text-base"
          value={newName}
          maxLength={40}
          onChange={(e) => setNewName(e.target.value)}
        />
        <SecondaryButton type="submit" disabled={busy}>
          Ajouter
        </SecondaryButton>
      </form>
    </section>
  )
}
