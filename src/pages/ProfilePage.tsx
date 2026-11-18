import { Link } from 'react-router'
import { PlaceholderPage } from '../components/PlaceholderPage.tsx'
import { useAuth } from '../features/auth/AuthContext.ts'

export function ProfilePage() {
  const { profile, session, demoMode } = useAuth()
  return (
    <div className="space-y-4">
      {!demoMode && profile && (
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold text-court">{profile.full_name}</h1>
          <p className="text-sm break-all text-ink/70">{session?.user.email}</p>
          <Link to="/nouveau-mot-de-passe" className="inline-block text-sm text-court underline">
            Changer mon mot de passe
          </Link>
        </section>
      )}
      <PlaceholderPage title={demoMode ? 'Mon profil' : 'Historique et statistiques'} plannedStep="étape 5" />
    </div>
  )
}
