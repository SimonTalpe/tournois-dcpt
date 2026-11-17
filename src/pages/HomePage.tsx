import { PlaceholderPage } from '../components/PlaceholderPage.tsx'
import { PlayerBadge } from '../components/PlayerBadge.tsx'
import { isSupabaseConfigured } from '../lib/supabase.ts'

export function HomePage() {
  return (
    <PlaceholderPage title="Accueil" plannedStep="étape 5">
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li>Joueur inscrit : ses prochains matchs (ou le tableau du tournoi).</li>
        <li>Autres visiteurs : tournois en cours, ou derniers résultats.</li>
      </ul>
      <div className="mt-4 flex items-center gap-2 text-sm">
        Exemple de pastille joueur (survole-la) : <PlayerBadge fullName="Simon Talpe" />
      </div>
      <p className="mt-4 text-xs">
        Base de données : {isSupabaseConfigured ? '✅ connectée' : '⏳ pas encore configurée'}
      </p>
    </PlaceholderPage>
  )
}
