import { createBrowserRouter } from 'react-router'
import { AppLayout } from './components/AppLayout.tsx'
import { RequireAdmin, RequirePlayer, RequireViewer } from './features/auth/guards.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { AnnouncementsPage } from './pages/AnnouncementsPage.tsx'
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
import { EntryPage } from './pages/EntryPage.tsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { RulesPage } from './pages/RulesPage.tsx'
import { SignupPage } from './pages/SignupPage.tsx'
import { SpectatorPage } from './pages/SpectatorPage.tsx'
import { TournamentPage } from './pages/TournamentPage.tsx'
import { TournamentsPage } from './pages/TournamentsPage.tsx'
import { VerifyEmailPage } from './pages/VerifyEmailPage.tsx'

/**
 * Plan du site.
 * - Écran d'entrée et pages d'accès : ouverts à tous, hors de la mise en page principale.
 * - Le reste : joueurs et spectateurs (RequireViewer) ; profil réservé aux joueurs, administration à l'admin.
 * Ces protections sont un confort d'affichage : les vrais droits sont appliqués par la base (RLS).
 */
export const router = createBrowserRouter([
  { path: '/', element: <EntryPage /> },
  { path: '/jouer', element: <LoginPage /> },
  { path: '/inscription', element: <SignupPage /> },
  { path: '/verification', element: <VerifyEmailPage /> },
  { path: '/mot-de-passe-oublie', element: <ForgotPasswordPage /> },
  { path: '/nouveau-mot-de-passe', element: <ChangePasswordPage /> },
  { path: '/regarder', element: <SpectatorPage /> },
  {
    element: (
      <RequireViewer>
        <AppLayout />
      </RequireViewer>
    ),
    children: [
      { path: '/accueil', element: <HomePage /> },
      { path: '/tournois', element: <TournamentsPage /> },
      { path: '/tournois/:tournamentId', element: <TournamentPage /> },
      { path: '/annonces', element: <AnnouncementsPage /> },
      { path: '/regles', element: <RulesPage /> },
      {
        path: '/profil',
        element: (
          <RequirePlayer>
            <ProfilePage />
          </RequirePlayer>
        ),
      },
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
