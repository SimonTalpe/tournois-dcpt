import { useEffect, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'

export type LiveStatus = 'connecting' | 'live' | 'offline'

/** Ce que la page sait du tournoi affiché, pour reconnaître les événements qui le concernent. */
export type LiveContext = { tournamentId: string; poolIds: ReadonlySet<string>; roundIds: ReadonlySet<string> }

type Change = { table: string; eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> }

/**
 * Un événement de la base concerne-t-il le tournoi affiché ?
 * Les suppressions arrivent sans filtre (limite de Supabase Realtime) et avec la seule clé primaire :
 * on les reconnaît par les identifiants déjà connus.
 */
export function concernsTournament(change: Change, context: LiveContext): boolean {
  const row = change.eventType === 'DELETE' ? change.old : change.new
  switch (change.table) {
    case 'tournaments':
      return row.id === context.tournamentId
    case 'pool_tiebreaks':
      return change.eventType === 'DELETE' || context.poolIds.has(String(row.pool_id))
    case 'tournament_rounds':
      return change.eventType === 'DELETE' ? context.roundIds.has(String(row.id)) : row.tournament_id === context.tournamentId
    case 'matches':
    case 'tournament_entries':
      return change.eventType === 'DELETE' || row.tournament_id === context.tournamentId
    default:
      return false
  }
}

/** Délai de regroupement des événements (une saisie de score en déclenche plusieurs). */
const DEBOUNCE_MS = 400

/**
 * Temps réel : appelle `onChange` (rechargement du tournoi) quand une donnée du tournoi change,
 * et au retour sur l'onglet / l'application (téléphone en veille). Renvoie l'état de la connexion.
 */
export function useLiveTournament(context: LiveContext | null, onChange: () => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const contextRef = useRef(context)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    contextRef.current = context
    onChangeRef.current = onChange
  })

  const tournamentId = context?.tournamentId
  useEffect(() => {
    if (!supabase || !tournamentId) return
    const client = supabase
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS)
    }
    const handle = (table: string) => (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const current = contextRef.current
      const change: Change = {
        table,
        eventType: payload.eventType,
        new: (payload.new ?? {}) as Record<string, unknown>,
        old: (payload.old ?? {}) as Record<string, unknown>,
      }
      if (current && concernsTournament(change, current)) schedule()
    }

    const filtered = (table: string, column: string) =>
      ({ event: '*', schema: 'public', table, filter: `${column}=eq.${tournamentId}` }) as const
    const channel = client
      .channel(`tournoi-${tournamentId}`)
      .on('postgres_changes', filtered('tournaments', 'id'), handle('tournaments'))
      .on('postgres_changes', filtered('tournament_entries', 'tournament_id'), handle('tournament_entries'))
      .on('postgres_changes', filtered('tournament_rounds', 'tournament_id'), handle('tournament_rounds'))
      .on('postgres_changes', filtered('matches', 'tournament_id'), handle('matches'))
      // Pas de colonne tournoi dans les départages ; suppressions jamais filtrables.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pool_tiebreaks' }, handle('pool_tiebreaks'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tournament_rounds' }, handle('tournament_rounds'))
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('live')
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setStatus('offline')
      })

    // Retour sur la page (onglet réaffiché, téléphone sorti de veille) : on rattrape ce qui a pu être manqué.
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      void client.removeChannel(channel)
    }
  }, [tournamentId])

  return supabase ? status : 'offline'
}
