import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { DemoModeNotice, Notice } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'
import { PlayerStatsView } from '../features/profile/PlayerStatsView.tsx'
import { supabase } from '../lib/supabase.ts'

/** Profil d'un participant (joueurs connectés uniquement) : statistiques et historique. */
export function PlayerPage() {
  const { playerId = '' } = useParams()
  const auth = useAuth()
  const [name, setName] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void supabase
      .from('players')
      .select('full_name')
      .eq('id', playerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setName((data as { full_name: string } | null)?.full_name ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  if (auth.demoMode) return <DemoModeNotice />
  if (name === undefined) return <p className="text-ink/60">Chargement…</p>
  if (name === null) {
    return (
      <section className="space-y-3">
        <Notice>Ce joueur est introuvable.</Notice>
        <Link to="/tournois" className="text-sm underline">
          ← Tournois
        </Link>
      </section>
    )
  }
  return (
    <section className="space-y-6">
      <button type="button" onClick={() => history.back()} className="text-sm text-ink/60 underline">
        ← Retour
      </button>
      <h1 className="text-2xl font-bold text-court">{name}</h1>
      <PlayerStatsView playerId={playerId} />
    </section>
  )
}
