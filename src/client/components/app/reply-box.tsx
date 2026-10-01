import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { CornerUpLeft, PenLine, Send, X } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Modal } from "@/client/components/app/modal";
import { Machine } from "@/client/components/app/primitives";
import { MailyEditor } from "@/client/components/app/maily-editor";
import type { RichTextHandle } from "@/client/components/app/rich-text-editor";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { cn } from "@/client/lib/utils";
import { htmlHasContent } from "@/client/lib/mail-html";

/** Inline replies stay in their conversation; the full composer saves and carries their text. */
export function ReplyBox({ mailboxId, to, subject, inReplyTo, threadId, replyToId }: {
	mailboxId: string;
	to: string;
	subject: string | null;
	inReplyTo: string | null;
	threadId: string;
	replyToId: string;
}) {
	const toast = useToast();
	const client = useQueryClient();
	const navigate = useNavigate();
	const [body, setBody] = useState({ html: "", text: "" });
	const [writing, setWriting] = useState(false);
	const editorId = useId();
	const replyButton = useRef<HTMLButtonElement>(null);
	const [context, setContext] = useState({ to, subject, inReplyTo, replyToId });
	const [sending, setSending] = useState(false);
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
	const [editorKey, setEditorKey] = useState(0);
	const editorRef = useRef<RichTextHandle>(null);
	const pending = useRef(false);
	const savedForHandoff = useRef(false);
	const hasBody = Boolean(body.text.trim()) || htmlHasContent(body.html);
	const busy = sending || opening;
	useEffect(() => {
		if (writing && !busy) editorRef.current?.focusStart();
	}, [writing, busy]);
	// Once typing starts, incoming mail must not silently retarget the reply.
	const target = hasBody ? context : { to, subject, inReplyTo, replyToId };
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) => hasBody && !savedForHandoff.current && current.pathname !== next.pathname,
		enableBeforeUnload: () => hasBody && !savedForHandoff.current,
		withResolver: true,
	});

	function payload() {
		return {
			mailboxId, to: target.to ? [{ address: target.to }] : [],
			subject: /^re:/i.test(target.subject ?? "") ? target.subject : `Re: ${target.subject ?? ""}`.trim(),
			bodyText: body.text.trim(), bodyHtml: body.html || null,
			...(target.inReplyTo ? { inReplyTo: target.inReplyTo } : {}), threadId,
		};
	}

	async function send() {
		if (!hasBody || pending.current) return;
		pending.current = true;
		setSending(true);
		setError(null);
		try {
			await api.post("/api/send", payload());
			setBody({ html: "", text: "" });
			setEditorKey((key) => key + 1);
			await client.invalidateQueries({ queryKey: ["messages"] });
			toast.ok("Reply sent");
		} catch (cause) {
			setError({ title: "Could not send the reply", detail: cause instanceof ApiError ? cause.message : undefined });
		} finally {
			pending.current = false;
			setSending(false);
		}
	}

	async function openComposer() {
		if (pending.current) return;
		pending.current = true;
		setOpening(true);
		setError(null);
		try {
			const draft = await api.post<{ id: string }>("/api/send/drafts", payload());
			savedForHandoff.current = true;
			void client.invalidateQueries({ queryKey: ["messages"] });
			await navigate({ to: "/compose", search: { draftId: draft.id } });
		} catch (cause) {
			savedForHandoff.current = false;
			setError({ title: "Could not open the composer", detail: cause instanceof ApiError ? cause.message : undefined });
		} finally {
			pending.current = false;
			setOpening(false);
		}
	}

	return <>
		<section aria-label="Reply" aria-busy={busy}
			className={cn(
				"rounded-xl border border-border bg-[var(--pogpin-shell-panel-alt)] p-2 lg:sticky lg:bottom-0",
				"focus-within:border-[var(--pogpin-brand-border)]",
			)}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
				event.preventDefault();
				void send();
			}}>
			{writing ? <div className="mb-2 flex items-start gap-2 px-1">
				<Machine className="min-w-0 flex-1 break-all text-xs">To {target.to}</Machine>
				{!hasBody ? <Button variant="ghost" size="icon" disabled={busy} aria-label="Cancel reply" onClick={() => {
					setWriting(false);
					requestAnimationFrame(() => replyButton.current?.focus({ preventScroll: true }));
				}}><X aria-hidden className="size-4" /></Button> : null}
			</div> : null}
			<div id={editorId} hidden={!writing} inert={busy} className="max-h-[45vh] overflow-y-auto">
				{writing ? <MailyEditor key={editorKey} handleRef={editorRef} initialHtml="" autoFocus
					onChange={(html, text) => {
						if (!hasBody) setContext({ to, subject, inReplyTo, replyToId });
						setBody({ html, text });
					}}
					ariaLabel={`Reply to ${target.to}`} density="compact" className="min-h-36 px-2" /> : null}
			</div>
			<div className="mt-1 flex min-w-0 items-center justify-end gap-2 px-1">
				{!writing ? <span title={target.to} className="min-w-0 flex-1 truncate"><Machine className="text-xs">{target.to}</Machine></span> : null}
				{hasBody || busy ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openComposer()} title="Save this reply as a draft and open the full composer" className="shrink-0 text-muted-foreground">
					<PenLine className="size-3.5" />{opening ? "Opening…" : "Full composer"}
				</Button> : <Button asChild size="sm" variant="ghost" className="shrink-0 text-muted-foreground">
					<Link to="/compose" search={{ replyTo: target.replyToId }}><PenLine className="size-3.5" />Full composer</Link>
				</Button>}
				{writing ? <Button size="sm" disabled={busy || !hasBody} onClick={() => void send()} title="Send (⌘↵)">
					<Send className="size-3.5" />{sending ? "Sending…" : "Send"}
				</Button> : <Button ref={replyButton} size="sm" variant="secondary" aria-controls={editorId} aria-expanded={false} onClick={() => setWriting(true)}>
					<CornerUpLeft className="size-3.5" />Reply
				</Button>}
			</div>
			{error ? <p role="alert" className="mt-2 break-words px-2 text-sm text-ink">
				<span className="font-medium">{error.title}</span>
				{error.detail ? <span className="block text-ink-2">{error.detail}</span> : null}
			</p> : null}
		</section>
		<Modal open={blocker.status === "blocked"} onClose={() => blocker.reset?.()}
			title={busy ? "Reply in progress" : hasBody ? "Discard unsent reply?" : "Leave this conversation?"}
			description={busy ? "Wait for the result before leaving." : hasBody ? "Your reply has not been saved. Leaving will discard it." : "Your reply is complete. You can leave this conversation."}>
			<div className="flex justify-end gap-2">
				<Button variant="secondary" onClick={() => blocker.reset?.()}>Keep writing</Button>
				<Button variant="destructive" disabled={busy} onClick={() => blocker.proceed?.()}>{hasBody ? "Discard reply" : "Leave"}</Button>
			</div>
		</Modal>
	</>;
}
