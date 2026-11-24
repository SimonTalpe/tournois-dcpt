import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-5 border-t-8 border-ochre bg-white px-5 py-10">
      <div className="mx-auto w-full max-w-md space-y-5">
        <p className="font-display text-[120px] leading-[0.8] font-black text-ochre-text">404</p>
        <h1 className="font-display text-[52px] leading-[0.9] font-black">Raté, à côté de la cible</h1>
        <p className="text-[17px]">Cette page n'existe pas.</p>
        <Link
          to="/"
          className="flex min-h-[52px] items-center justify-center border-2 border-black bg-black px-4 text-[17px] font-semibold text-white hover:bg-ochre-text"
        >
          Retour à l'accueil
        </Link>
      </div>
    </main>
  )
}
