import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import type { ReactNode } from 'react'
import { isLegacyPlainText, normalizeRichText } from './richText.ts'

type Props = {
  /** Contenu initial (HTML, ou ancien texte simple). Pour réinitialiser, changer la `key` du composant. */
  initialValue: string
  onChange: (html: string) => void
  /** Identifiant du champ (pour l'étiquette). */
  id: string
  placeholder?: string
}

/** Ancien contenu en texte simple → paragraphes HTML. */
function toHtml(value: string): string {
  if (!isLegacyPlainText(value)) return value
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return value
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<p>${escape(line)}</p>`)
    .join('')
}

/** Éditeur de texte riche (gras, italique, titres, listes, liens), adapté au mobile. */
export function RichTextEditor({ initialValue, onChange, id, placeholder }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: toHtml(initialValue),
    editorProps: {
      attributes: {
        id,
        class: 'rich-text min-h-32 px-3 py-2.5 outline-none',
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: e }) => onChange(normalizeRichText(e.getHTML())),
  })

  return (
    <div className="overflow-hidden rounded-xl border border-ink/20 bg-white focus-within:ring-2 focus-within:ring-court/40">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  function toggleLink() {
    if (state.link) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const url = window.prompt('Adresse du lien (ex. https://…)')?.trim()
    if (!url) return
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
  }

  return (
    <div className="flex flex-wrap gap-1 border-b border-ink/10 bg-chalk/60 p-1" role="toolbar" aria-label="Mise en forme">
      <ToolButton label="Gras" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>G</strong>
      </ToolButton>
      <ToolButton label="Italique" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolButton>
      <ToolButton label="Souligné" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">S</span>
      </ToolButton>
      <ToolButton label="Titre" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        T1
      </ToolButton>
      <ToolButton label="Sous-titre" active={state.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        T2
      </ToolButton>
      <ToolButton label="Liste à puces" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •≡
      </ToolButton>
      <ToolButton label="Liste numérotée" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </ToolButton>
      <ToolButton label={state.link ? 'Retirer le lien' : 'Lien'} active={state.link} onClick={toggleLink}>
        🔗
      </ToolButton>
      <span className="ml-auto flex gap-1">
        <ToolButton label="Annuler" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          ↶
        </ToolButton>
        <ToolButton label="Rétablir" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          ↷
        </ToolButton>
      </span>
    </div>
  )
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Garde la sélection dans l'éditeur au clic.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-h-9 min-w-9 rounded-lg px-2 text-sm transition disabled:opacity-30 ${
        active ? 'bg-court text-chalk' : 'text-court hover:bg-court/10'
      }`}
    >
      {children}
    </button>
  )
}
