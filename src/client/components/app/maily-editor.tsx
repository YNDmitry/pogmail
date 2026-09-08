import { lazy, Suspense, useEffectEvent, useImperativeHandle, useRef, type Ref } from "react";
import { ImageUploadExtension } from "@maily-to/core/extensions";
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
  density = "compose",
	  onImageUpload,
}: {
  initialHtml: string;
  /** HTML is sent to capable clients; text is the accessible MIME fallback. */
  onChange: (html: string, text: string) => void;
  ariaLabel: string;
  handleRef?: Ref<RichTextHandle>;
  className?: string;
  /** Settings and inline replies need the same editor, just less vertical chrome. */
  density?: "compose" | "compact";
	/** Returns a message-safe source, normally a `cid:` reference to an inline attachment. */
	  onImageUpload?: (file: Blob) => Promise<string>;
}) {
  const editorRef = useRef<MailyEditorInstance | null>(null);
	const uploadImage = useEffectEvent(
		(file: Blob) => onImageUpload?.(file) ?? Promise.reject(new Error("Image uploads are unavailable")),
	);
	const supportsImageUploads = Boolean(onImageUpload);
	const extensions = supportsImageUploads ? [ImageUploadExtension.configure({ onImageUpload: uploadImage })] : undefined;

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
		  extensions={extensions}
          config={{
            hasMenuBar: true,
            // Compose has one stable toolbar. Block controls and a second
            // selection toolbar turn a short email into a page-layout editor.
            hideContextMenu: true,
            spellCheck: true,
            immediatelyRender: false,
            wrapClassName: cn(
              "maily-compose-editor flex min-h-0 flex-1 flex-col",
              density === "compact" && "maily-editor-compact",
            ),
            toolbarClassName: "maily-compose-toolbar",
            bodyClassName:
              density === "compact"
                ? "maily-compose-canvas min-h-36 flex-1 border-0! p-0! shadow-none! bg-transparent!"
                : "maily-compose-canvas min-h-96 flex-1 border-0! p-0! shadow-none! bg-transparent!",
            contentClassName: density === "compact" ? "w-full max-w-none! py-3" : "w-full max-w-none! py-4",
          }}
          onCreate={(editor) => {
            editorRef.current = editor as unknown as MailyEditorInstance;
          }}
          onUpdate={(editor) => {
            editorRef.current = editor as unknown as MailyEditorInstance;
            onChange(
              editor.isEmpty ? "" : editor.getHTML(),
              editor.isEmpty ? "" : editor.getText({ blockSeparator: "\n" }),
            );
          }}
        />
      </Suspense>
    </div>
  );
}
