"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";

/**
 * A small document-style rich-text editor (Tiptap) for the admin area.
 *
 * Used for the legal documents (Terms of Service, Privacy Policy). Emits
 * plain HTML through `onChange`, styled with the shared `.rich-text` class
 * so what the operator sees matches the public page.
 */

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  /** Placeholder shown while the document is empty. */
  placeholder?: string;
};

const TOOLBAR_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--admin-muted)] transition-colors hover:bg-[var(--admin-hover)] hover:text-[var(--admin-ink)] disabled:pointer-events-none disabled:opacity-30";

const ACTIVE_BUTTON = "bg-[var(--admin-hover)] text-[var(--admin-ink)]";

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Tulis di sini…",
      }),
    ],
    content: value,
    // Next.js: do not render on the server — avoids hydration mismatches.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "rich-text admin-rich-text max-w-none px-4 py-3 text-[13px] text-[var(--admin-ink)] outline-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor in sync when the form state is replaced wholesale
  // (initial load, or a revert), without fighting the operator's typing.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--admin-line)] bg-white focus-within:border-[var(--admin-ink)]">
      <Toolbar editor={editor} />
      <div className="border-t border-[var(--admin-line)]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** The formatting toolbar above the document. */
function Toolbar({ editor }: { editor: Editor | null }) {
  const toggleLink = () => {
    if (!editor) return;

    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("URL tautan", previous ?? "https://");

    // Cancelled prompt — remove the link instead when one was active.
    if (href === null) {
      if (previous) editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    if (!href.trim()) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 bg-white px-2 py-1.5">
      <ToolbarButton
        label="Bold"
        disabled={!editor}
        active={editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        disabled={!editor}
        active={editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        disabled={!editor}
        active={editor?.isActive("underline")}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <Underline size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Coret"
        disabled={!editor}
        active={editor?.isActive("strike")}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[var(--admin-line)]" />

      <ToolbarButton
        label="Judul bagian (H2)"
        disabled={!editor}
        active={editor?.isActive("heading", { level: 2 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Sub-judul (H3)"
        disabled={!editor}
        active={editor?.isActive("heading", { level: 3 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[var(--admin-line)]" />

      <ToolbarButton
        label="Daftar bullet"
        disabled={!editor}
        active={editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Daftar nomor"
        disabled={!editor}
        active={editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Kutipan"
        disabled={!editor}
        active={editor?.isActive("blockquote")}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[var(--admin-line)]" />

      <ToolbarButton
        label="Tautan"
        disabled={!editor}
        active={editor?.isActive("link")}
        onClick={toggleLink}
      >
        <Link2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Hapus tautan"
        disabled={!editor || !editor.isActive("link")}
        onClick={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}
      >
        <Link2Off size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[var(--admin-line)]" />

      <ToolbarButton
        label="Undo"
        disabled={!editor?.can().undo()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!editor?.can().redo()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`${TOOLBAR_BUTTON} ${active ? ACTIVE_BUTTON : ""}`}
    >
      {children}
    </button>
  );
}
