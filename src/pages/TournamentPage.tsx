import { useParams } from 'react-router'
import { PlaceholderPage } from '../components/PlaceholderPage.tsx'

export function TournamentPage() {
  const { tournamentId } = useParams()
  return <PlaceholderPage title={`Tournoi ${tournamentId ?? ''}`} plannedStep="étape 3" />
}
