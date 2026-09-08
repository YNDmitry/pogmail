import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PenLine, Send } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Machine } from "@/client/components/app/primitives";
import { MailyEditor } from "@/client/components/app/maily-editor";
import type { RichTextHandle } from "@/client/components/app/rich-text-editor";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { cn } from "@/client/lib/utils";

/**
 * The reply that belongs to a conversation.
 *
 * Read as a thread, answering is not a separate screen — the box sits at the end
 * of the messages it answers, the way it does in every chat, and sending leaves
 * the reader where it was. It posts straight to `/api/send` rather than through a
 * draft: there is nothing to attach here, so there is nothing a draft row would
 * be carrying. The full composer remains one click away for attachments and
 * drafts that need to be revisited later.
 */
export function ReplyBox({
	mailboxId,
	to,
	subject,
	inReplyTo,
	threadId,
	replyToId,
}: {
	mailboxId: string;
	to: string;
	subject: string | null;
	inReplyTo: string | null;
	threadId: string;
	/** The message the full composer should open against. */
	replyToId: string;
}) {
	const toast = useToast();
	const client = useQueryClient();
	const [body, setBody] = useState({ html: "", text: "" });
	const [sending, setSending] = useState(false);
	const [editorKey, setEditorKey] = useState(0);
	const editorRef = useRef<RichTextHandle>(null);

	async function send() {
		const text = body.text.trim();
		if (!text || sending) return;

		setSending(true);
		try {
			await api.post("/api/send", {
				mailboxId,
				to: [{ address: to }],
				subject: subject?.startsWith("Re:") ? subject : `Re: ${subject ?? ""}`.trim(),
				bodyText: text,
				bodyHtml: body.html || null,
				...(inReplyTo ? { inReplyTo } : {}),
				threadId,
			});

			setBody({ html: "", text: "" });
			setEditorKey((key) => key + 1);
			// The thread lives under the same key prefix, so one invalidation refreshes
			// both the folder list and the conversation this reply just joined.
			await client.invalidateQueries({ queryKey: ["messages"] });
			toast.ok("Reply sent");
			// The caret stays where the next reply is typed, not on the Send button.
			queueMicrotask(() => editorRef.current?.focusStart());
		} catch (error) {
			toast.fail("Could not send the reply", error instanceof ApiError ? error.message : undefined);
		} finally {
			setSending(false);
		}
	}

	return (
		<section
			className={cn(
				"sticky bottom-0 rounded-xl border border-border bg-[var(--pogpin-shell-panel-alt)] p-2",
				"focus-within:border-[var(--pogpin-brand-border)]",
			)}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
				event.preventDefault();
				void send();
			}}
		>
			<MailyEditor
				key={editorKey}
				handleRef={editorRef}
				initialHtml=""
				onChange={(html, text) => setBody({ html, text })}
				ariaLabel={`Reply to ${to}`}
				density="compact"
				className="min-h-36 px-2"
			/>

			<div className="mt-1 flex items-center gap-2 px-1">
				<Machine className="text-[0.625rem]">{to}</Machine>

				<Button asChild size="sm" variant="ghost" className="ml-auto text-muted-foreground">
					<Link to="/compose" search={{ replyTo: replyToId }}>
						<PenLine className="size-3.5" />
						Full composer
					</Link>
				</Button>

				<Button size="sm" disabled={sending || body.text.trim().length === 0} onClick={() => void send()} title="Send (⌘↵)">
					<Send className="size-3.5" />
					{sending ? "Sending…" : "Send"}
				</Button>
			</div>
		</section>
	);
}
