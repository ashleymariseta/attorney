'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { marked } from 'marked';
import { useRef } from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Heading1, Heading2,
  Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Quote,
  Redo2, Table as TableIcon, Underline as UnderlineIcon, Undo2,
} from 'lucide-react';

// Same heuristic as the backend: decide HTML vs Markdown so older Markdown
// bodies (AI-Researcher answers, precedent conversions) open as rich text.
const BLOCK_HTML = /<(p|h[1-6]|ul|ol|li|table|blockquote|div|br|img|strong|em|b|i|u|a|hr|pre)\b/i;
function normalizeToHtml(value: string): string {
  const v = value || '';
  if (BLOCK_HTML.test(v)) return v;
  return marked.parse(v, { async: false }) as string;
}

export default function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const imgRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false, // App Router SSR-safe (avoids hydration mismatch)
    extensions: [
      // StarterKit v3 already bundles Link + Underline — do NOT add them again.
      StarterKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: normalizeToHtml(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'draft-doc ProseMirror min-h-[60vh] px-8 py-10 focus:outline-none sm:px-14',
      },
    },
  });

  function insertImage(file?: File | null) {
    if (!file || !editor) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 3 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: String(reader.result), alt: file.name.replace(/\.[^.]+$/, '') }).run();
    };
    reader.readAsDataURL(file);
    if (imgRef.current) imgRef.current.value = '';
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  if (!editor) return null;

  return (
    <div className="rounded-sm bg-white shadow-md ring-1 ring-black/5">
      <Toolbar editor={editor} onImage={() => imgRef.current?.click()} onLink={setLink} />
      <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => insertImage(e.target.files?.[0])} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, onImage, onLink }: { editor: Editor; onImage: () => void; onLink: () => void }) {
  const Btn = ({
    on, active, title, children,
  }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`grid h-8 w-8 place-items-center rounded-md text-ink transition hover:bg-canvas ${active ? 'bg-brand-light/30 text-brand-dark' : ''}`}
    >
      {children}
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px bg-line" />;

  return (
    <div className="sticky top-16 z-10 flex flex-wrap items-center gap-0.5 rounded-t-sm border-b border-line bg-white/95 px-2 py-1.5 backdrop-blur">
      <Btn title="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
      <Btn title="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
      <Btn title="Underline" active={editor.isActive('underline')} on={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></Btn>
      <Sep />
      <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Btn>
      <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Btn>
      <Sep />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
      <Btn title="Quote" active={editor.isActive('blockquote')} on={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></Btn>
      <Sep />
      <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} on={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={15} /></Btn>
      <Btn title="Align center" active={editor.isActive({ textAlign: 'center' })} on={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={15} /></Btn>
      <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} on={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={15} /></Btn>
      <Btn title="Justify" active={editor.isActive({ textAlign: 'justify' })} on={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={15} /></Btn>
      <Sep />
      <Btn title="Link" active={editor.isActive('link')} on={onLink}><LinkIcon size={15} /></Btn>
      <Btn title="Insert image" on={onImage}><ImageIcon size={15} /></Btn>
      <Btn title="Insert table" on={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={15} /></Btn>
      <Sep />
      <Btn title="Undo" on={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></Btn>
      <Btn title="Redo" on={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></Btn>
    </div>
  );
}
