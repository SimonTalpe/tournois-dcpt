import { Link } from 'react-router'

/** Connexion joueur / admin — formulaire maquette, branché sur Supabase à l'étape 2. */
export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-chalk px-6 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-court">🏓 Jouer</h1>
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Email professionnel</span>
            <input
              type="email"
              autoComplete="email"
              placeholder="prenom.nom@fft.fr"
              disabled
              className="w-full rounded-xl border border-ink/20 px-3 py-2"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Mot de passe</span>
            <input
              type="password"
              autoComplete="current-password"
              disabled
              className="w-full rounded-xl border border-ink/20 px-3 py-2"
            />
          </label>
          <p className="rounded-xl bg-ball/30 p-3 text-sm">
            🚧 Connexion disponible à l'étape 2. En attendant, tu peux{' '}
            <Link to="/accueil" className="font-semibold underline">
              visiter la maquette
            </Link>
            .
          </p>
        </form>
        <Link to="/" className="block text-center text-sm text-ink/60 underline">
          ← Retour
        </Link>
      </div>
    </main>
  )
}
