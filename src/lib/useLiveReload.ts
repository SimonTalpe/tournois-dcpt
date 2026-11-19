import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.ts'
import type { LiveStatus } from '../features/tournaments/useLiveTournament.ts'

/**
 * Temps réel simple : appelle `onChange` (regroupé sur 400 ms) à chaque changement dans l'une des tables,
 * et au retour sur l'onglet / l'application. Les règles de sécurité filtrent les événements reçus.
 */
export function useLiveReload(channelName: string, tables: readonly string[], onChange: () => void, enabled = true): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  const tableKey = tables.join(',')

  useEffect(() => {
    if (!supabase || !enabled) return
    const client = supabase
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => onChangeRef.current(), 400)
    }
    let channel = client.channel(channelName)
    for (const table of tableKey.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }
    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED') setStatus('live')
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setStatus('offline')
    })
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
  }, [channelName, tableKey, enabled])

  return supabase ? status : 'offline'
}
