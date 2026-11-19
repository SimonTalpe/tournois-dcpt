import { lazy, Suspense, type ComponentProps } from 'react'

// L'éditeur (Tiptap) n'est téléchargé que lorsqu'un admin ouvre un formulaire : joueurs et spectateurs ne le chargent jamais.
const Editor = lazy(() => import('./RichTextEditor.tsx').then((m) => ({ default: m.RichTextEditor })))

export function LazyRichTextEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="min-h-44 rounded-xl border border-ink/20 bg-white p-3 text-sm text-ink/50">Chargement de l’éditeur…</div>}>
      <Editor {...props} />
    </Suspense>
  )
}
