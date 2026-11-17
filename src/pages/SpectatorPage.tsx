import { Link } from 'react-router'

/** Accès spectateur par code commun — maquette, branché à l'étape 2. */
export function SpectatorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-chalk px-6 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-court">👀 Regarder</h1>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Code spectateur</span>
          <input
            type="password"
            inputMode="text"
            autoComplete="off"
            disabled
            className="w-full rounded-xl border border-ink/20 px-3 py-2"
          />
        </label>
        <p className="rounded-xl bg-ball/30 p-3 text-sm">
          🚧 Code spectateur disponible à l'étape 2. En attendant, tu peux{' '}
          <Link to="/accueil" className="font-semibold underline">
            visiter la maquette
          </Link>
          .
        </p>
        <Link to="/" className="block text-center text-sm text-ink/60 underline">
          ← Retour
        </Link>
      </div>
    </main>
  )
}
