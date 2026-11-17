import { createBrowserRouter } from 'react-router'
import { AppLayout } from './components/AppLayout.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { AnnouncementsPage } from './pages/AnnouncementsPage.tsx'
import { EntryPage } from './pages/EntryPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { RulesPage } from './pages/RulesPage.tsx'
import { SpectatorPage } from './pages/SpectatorPage.tsx'
import { TournamentPage } from './pages/TournamentPage.tsx'
import { TournamentsPage } from './pages/TournamentsPage.tsx'

/**
 * Plan du site.
 * - Écran d'entrée et pages d'accès : hors de la mise en page principale.
 * - Le reste : dans AppLayout (en-tête + menu).
 * Les protections d'accès (connecté / spectateur / admin) seront ajoutées à l'étape 2.
 */
export const router = createBrowserRouter([
  { path: '/', element: <EntryPage /> },
  { path: '/jouer', element: <LoginPage /> },
  { path: '/regarder', element: <SpectatorPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/accueil', element: <HomePage /> },
      { path: '/tournois', element: <TournamentsPage /> },
      { path: '/tournois/:tournamentId', element: <TournamentPage /> },
      { path: '/annonces', element: <AnnouncementsPage /> },
      { path: '/regles', element: <RulesPage /> },
      { path: '/profil', element: <ProfilePage /> },
      { path: '/admin', element: <AdminPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
