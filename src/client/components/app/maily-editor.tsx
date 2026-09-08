import { lazy, Suspense, useImperativeHandle, useRef, type Ref } from "react";
import type { RichTextHandle } from "@/client/components/app/rich-text-editor";
import { cn } from "@/client/lib/utils";

import "@maily-to/core/style.css";

const Editor = lazy(() =>
  import("@maily-to/core").then((module) => ({ default: module.Editor })),
);

/** The subset of Maily's editor API the compose flow needs to preserve. */
type MailyEditorInstance = {
  isEmpty: boolean;
  getHTML(): string;
  getText(options?: { blockSeparator?: string }): string;
  chain(): {
    focus(position?: "start" | "end"): {
      insertContentAt(position: number, content: string): { run(): boolean };
      run(): boolean;
    };
  };
};

/**
 * Maily's block editor, adapted to Pogmail's HTML draft contract.
 *
 * Maily retains the document structure while editing, but the HTML it emits is
 * the portable email representation that the Worker already stores and sends.
 * This makes old hand-written drafts editable and keeps drafts self-contained.
 */
export function MailyEditor({
  initialHtml,
  onChange,
  ariaLabel,
  handleRef,
  className,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  handleRef?: Ref<RichTextHandle>;
  className?: string;
}) {
  const editorRef = useRef<MailyEditorInstance | null>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      focusStart: () => editorRef.current?.chain().focus("start").run(),
      getText: () => editorRef.current?.getText({ blockSeparator: "\n" }) ?? "",
      prepend: (html: string) =>
        editorRef.current
          ?.chain()
          .focus("start")
          .insertContentAt(0, html)
          .run(),
    }),
    [],
  );

  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      aria-label={ariaLabel}
    >
      <Suspense
        fallback={
          <div className="grid min-h-64 flex-1 place-items-center text-sm text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        <Editor
          contentHtml={initialHtml || undefined}
          config={{
            hasMenuBar: true,
            // Compose has one stable toolbar. Block controls and a second
            // selection toolbar turn a short email into a page-layout editor.
            hideContextMenu: true,
            spellCheck: true,
            immediatelyRender: false,
            wrapClassName: "maily-compose-editor flex min-h-0 flex-1 flex-col",
            toolbarClassName: "maily-compose-toolbar",
            bodyClassName:
              "maily-compose-canvas min-h-96 flex-1 border-0! p-0! shadow-none! bg-transparent!",
            contentClassName: "w-full max-w-none! py-4",
          }}
          onCreate={(editor) => {
            editorRef.current = editor as unknown as MailyEditorInstance;
          }}
          onUpdate={(editor) => {
            editorRef.current = editor as unknown as MailyEditorInstance;
            onChange(editor.isEmpty ? "" : editor.getHTML());
          }}
        />
      </Suspense>
    </div>
  );
}
