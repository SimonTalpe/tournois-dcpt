import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-chalk px-6 text-center">
      <p className="text-6xl">🎯</p>
      <h1 className="text-2xl font-bold text-court">Raté, à côté de la cible !</h1>
      <p>Cette page n'existe pas.</p>
      <Link to="/" className="rounded-xl bg-court px-4 py-2 font-semibold text-chalk">
        Retour à l'accueil
      </Link>
    </main>
  )
}
