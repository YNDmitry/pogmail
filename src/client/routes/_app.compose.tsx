import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { Eye, Image, Paperclip, Save, Send, X } from "lucide-react";
import { Button, SubmitButton } from "@/client/components/app/button";
import { EmailFrame } from "@/client/components/app/email-frame";
import { Input } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Modal } from "@/client/components/app/modal";
import { Machine, PageHeader, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { Loader } from "@/client/components/motion/loader";
import { useMailboxes, useMessage } from "@/client/lib/queries";
import { useList } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";
import { bytes } from "@/client/lib/format";
import { escapeHtml, htmlHasContent, textToHtml } from "@/client/lib/mail-html";
import { MailyEditor } from "@/client/components/app/maily-editor";
import type { RichTextHandle } from "@/client/components/app/rich-text-editor";
import { canSend } from "@/shared/contract/permissions";
import { cn } from "@/client/lib/utils";
import type { Attachment, MailAddress, MailboxSummary } from "@/shared/contract/mail";

type Template = { id: string; name: string; subject: string; bodyText: string; bodyHtml: string | null };
type TemplateInsertion = {
	attachments: Array<Attachment & { from: string; to: string }>;
	replacements: Array<{ from: string; to: string }>;
};

function draftAttachmentUrl(draftId: string, attachmentId: string) {
	return `/api/send/drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export const Route = createFileRoute("/_app/compose")({
	validateSearch: z.object({ replyTo: z.string().optional(), draftId: z.string().optional() }),
	component: Compose,
});

function parseAddresses(value: string) {
	return value
		.split(/[,;\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((address) => ({ address }));
}

function formatAddresses(entries: MailAddress[] | null | undefined): string {
	return (entries ?? []).map((entry) => entry.address).join(", ");
}

function Compose() {
	const { replyTo, draftId } = useSearch({ from: "/_app/compose" });
	const mailboxes = useMailboxes();
	// At most one of the two: a screen is either a reply or an open draft.
	const source = useMessage(draftId ?? replyTo);

	const sendable = (mailboxes.data ?? []).filter((mailbox) => canSend(mailbox.permission));

	// Wait for the data the form is seeded from, then mount the form once with that
	// data as its initial state. Seeding state from an effect would mean rendering an
	// empty form first and clobbering anything typed in the meantime.
	if (mailboxes.isPending || ((replyTo || draftId) && source.isPending)) {
		return (
			<div className="grid h-full place-items-center">
				<Loader />
			</div>
		);
	}

	if (sendable.length === 0) {
		return (
			<div className="mx-auto max-w-2xl px-6 py-8">
				<PageHeader
					title="Write a message"
					description="You need a mailbox you can send from before you can write anything."
				/>
				<p className="mt-6 text-sm text-ink-2">
					Ask an administrator for send access, or add a mailbox under Administration.
				</p>
			</div>
		);
	}

	const draft = draftId ? source.data : undefined;
	const reply = draftId ? undefined : source.data;

	return (
		<ComposeForm
			key={draft?.id ?? reply?.id ?? "new"}
			sendable={sendable}
			draftId={draft?.id ?? null}
			initial={{
				mailboxId: draft?.mailboxId ?? reply?.mailboxId ?? sendable[0]?.id ?? "",
				to: draft
					? formatAddresses(draft.toAddresses)
					: reply
						? (reply.replyTo ?? reply.fromAddress)
						: "",
				cc: draft ? formatAddresses(draft.ccAddresses) : "",
				bcc: draft ? formatAddresses(draft.bccAddresses) : "",
				subject: draft
					? (draft.subject ?? "")
					: reply
						? reply.subject?.startsWith("Re:")
							? reply.subject
							: `Re: ${reply.subject ?? ""}`.trim()
						: "",
				body: draft
					? (draft.bodyHtml ?? textToHtml(draft.bodyText))
					: reply
						? quote(reply)
						: "",
			}}
			initialAttachments={draft?.attachments ?? []}
			inReplyTo={reply?.messageId ?? null}
			threadId={reply?.threadId ?? null}
			replyingTo={reply ? (reply.replyTo ?? reply.fromAddress) : null}
		/>
	);
}

/**
 * The quoted original, in the convention every mail client already renders: an
 * empty line to write in, the attribution, then the original inside a
 * blockquote. The original's own HTML is deliberately not carried over — it
 * arrived from a stranger and is only ever rendered in a sandboxed frame, so
 * the quote is built from the plain-text part.
 */
function quote(mail: { receivedAt: string; fromAddress: string; bodyText: string | null }): string {
	const attribution = `On ${new Date(mail.receivedAt).toLocaleString()}, ${escapeHtml(
		mail.fromAddress,
	)} wrote:`;

	return `<p></p><p>${attribution}</p><blockquote>${textToHtml(mail.bodyText)}</blockquote>`;
}

/**
 * A header row, not a stacked field: an operator filling in an envelope reads
 * label and value on one line, the way every mail client since the first one has
 * shown them, and four stacked labelled boxes push the message itself below the
 * fold for no gain.
 */
function Row({
	label,
	htmlFor,
	children,
	action,
}: {
	label: string;
	htmlFor: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 border-b border-border px-1 py-1.5">
			<label htmlFor={htmlFor} className="w-14 shrink-0 text-[0.8125rem] text-muted-foreground">
				{label}
			</label>
			<div className="min-w-0 flex-1">{children}</div>
			{action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
		</div>
	);
}

/** Borderless because the row already draws the line; the field is the whole row. */
const ROW_FIELD =
	"h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent";

/** Long enough not to save mid-word, short enough to survive a closed tab. */
const AUTOSAVE_DELAY = 1500;

type FormValues = {
	mailboxId: string;
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	/** HTML: the editor's document, and what the message is sent as. */
	body: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function ComposeForm({
	sendable,
	draftId: initialDraftId,
	initial,
	initialAttachments,
	inReplyTo,
	threadId,
	replyingTo,
}: {
	sendable: MailboxSummary[];
	draftId: string | null;
	initial: FormValues;
	initialAttachments: Attachment[];
	inReplyTo: string | null;
	threadId: string | null;
	replyingTo: string | null;
}) {
	const navigate = useNavigate();
	const toast = useToast();

	const [draftId, setDraftId] = useState(initialDraftId);
	const [mailboxId, setMailboxId] = useState(initial.mailboxId);
	const [to, setTo] = useState(initial.to);
	const [cc, setCc] = useState(initial.cc);
	const [bcc, setBcc] = useState(initial.bcc);
	const [ccOpen, setCcOpen] = useState(Boolean(initial.cc));
	const [bccOpen, setBccOpen] = useState(Boolean(initial.bcc));
	const [subject, setSubject] = useState(initial.subject);
	const [body, setBody] = useState(initial.body);
	const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
	const [state, setState] = useState<"idle" | "loading">("idle");
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [attaching, setAttaching] = useState(false);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
	/** URL replacement used by autosave is not a user leaving the composer. */
	const internalNavigation = useRef(false);

	const templates = useList<Template>(qk.templates, "/api/templates");
	const editorRef = useRef<RichTextHandle>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const imagePreviewSources = draftId
		? Object.fromEntries(
			attachments
				.filter((attachment) => attachment.disposition === "inline" && attachment.contentId)
				.map((attachment) => [`cid:${attachment.contentId}`, draftAttachmentUrl(draftId, attachment.id)]),
			)
		: undefined;
	const previewHtml = Object.entries(imagePreviewSources ?? {}).reduce(
		(html, [source, preview]) => html.replaceAll(source, preview),
		body,
	);

	const values: FormValues = { mailboxId, to, cc, bcc, subject, body };
	const snapshot = JSON.stringify(values);

	/** The last snapshot the server confirmed; an unchanged form never saves twice. */
	const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
	/** Set once the message is on its way — leaving then loses nothing. */
	const [done, setDone] = useState(false);

	const unsaved = snapshot !== savedSnapshot && hasContent(values);

	// A reply already has its recipient and subject; the only thing left to do is
	// write, so the caret starts above the quoted original rather than in `To`.
	useEffect(() => {
		if (!replyingTo) return;
		editorRef.current?.focusStart();
	}, [replyingTo]);

	/** Saves and returns the draft id, creating the draft on first use. */
	const saveDraft = useCallback(async (): Promise<string> => {
		const pending = JSON.stringify({ mailboxId, to, cc, bcc, subject, body });
		const payload = {
			mailboxId,
			to: parseAddresses(to),
			cc: parseAddresses(cc),
			bcc: parseAddresses(bcc),
			subject,
			// Every message carries both parts: the HTML the editor holds, and the
			// plain text a client that refuses HTML — and the folder snippet — read.
			bodyText: editorRef.current?.getText() ?? "",
			bodyHtml: body || null,
			...(inReplyTo ? { inReplyTo } : {}),
			...(threadId ? { threadId } : {}),
		};

		setSaveState("saving");
		try {
			let id = draftId;
			if (id) {
				await api.put(`/api/send/drafts/${id}`, payload);
			} else {
				const row = await api.post<{ id: string }>("/api/send/drafts", payload);
				id = row.id;
				setDraftId(id);
				// The id goes in the URL, so a reload reopens this draft rather than
				// starting a second one beside it. This is an internal replace, not a
				// request to leave the composer, so the blocker must stay out of its way.
				internalNavigation.current = true;
				try {
					await navigate({ to: "/compose", search: { draftId: id }, replace: true });
				} finally {
					internalNavigation.current = false;
				}
			}

			setSavedSnapshot(pending);
			setSaveState("saved");
			return id;
		} catch (error) {
			setSaveState("error");
			throw error;
		}
		// The setters are listed because the React Compiler check infers them too;
		// they are stable, so they cost nothing.
	}, [
		draftId,
		mailboxId,
		to,
		cc,
		bcc,
		subject,
		body,
		inReplyTo,
		threadId,
		navigate,
		setDraftId,
		setSavedSnapshot,
		setSaveState,
	]);

	/*
	 * Autosave. An empty form saves nothing: opening this screen and leaving it
	 * must not litter the drafts folder. A save already in flight holds the timer
	 * off, so a slow round-trip cannot start a second one on top of itself.
	 */
	useEffect(() => {
		if (!unsaved || saveState === "saving") return;
		const timer = setTimeout(() => {
			void saveDraft().catch(() => {
				// The indicator already says "Not saved"; a toast on every pause in
				// typing would be noise, and the next change tries again.
			});
		}, AUTOSAVE_DELAY);
		return () => clearTimeout(timer);
	}, [unsaved, saveState, saveDraft]);

	// The browser's own guard, for a tab close the router never sees.
	useEffect(() => {
		if (!unsaved) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [unsaved]);

	/* In-app navigation gets a dialog instead, so the choice stays inside the app. */
	const blocker = useBlocker({
		shouldBlockFn: () => unsaved && !done && !internalNavigation.current,
		withResolver: true,
	});

	async function attach(files: FileList | null) {
		if (!files?.length) return;
		setAttaching(true);
		try {
			// Files hang off a draft row, so there has to be one before the upload.
			const id = await saveDraft();
			for (const file of Array.from(files)) {
				try {
					const row = await api.upload<Attachment>(`/api/send/drafts/${id}/attachments`, file);
					setAttachments((current) => [...current, row]);
				} catch (error) {
					toast.fail(
						`Could not attach ${file.name}`,
						error instanceof ApiError ? error.message : undefined,
					);
				}
			}
		} catch (error) {
			toast.fail("Could not save the draft", error instanceof ApiError ? error.message : undefined);
		} finally {
			setAttaching(false);
			// Without this, picking the same file twice in a row fires no change event.
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	/** Images live in the MIME envelope as CID parts, never at a public bucket URL. */
	async function attachInlineImage(file: Blob): Promise<{ previewSrc: string; htmlSrc: string }> {
		if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
		const image = file instanceof File ? file : new File([file], "image", { type: file.type });
		setAttaching(true);
		try {
			const id = await saveDraft();
			const attachment = await api.upload<Attachment>(`/api/send/drafts/${id}/attachments`, image, {
				"x-inline": "true",
			});
			if (!attachment.contentId) throw new Error("Image upload did not return a content ID");
			setAttachments((current) => [...current, attachment]);
			return {
				previewSrc: draftAttachmentUrl(id, attachment.id),
				htmlSrc: `cid:${attachment.contentId}`,
			};
		} finally {
			setAttaching(false);
		}
	}

	async function detach(attachment: Attachment) {
		if (!draftId) return;
		try {
			await api.delete(`/api/send/drafts/${draftId}/attachments/${attachment.id}`);
			setAttachments((current) => current.filter((entry) => entry.id !== attachment.id));
		} catch (error) {
			toast.fail("Could not remove the file", error instanceof ApiError ? error.message : undefined);
		}
	}

	async function insertTemplate(template: Template) {
		try {
			// Template images belong to the template until this moment. Save first so
			// their MIME parts have a draft row to attach to, then swap private editor
			// URLs for fresh CIDs before the HTML reaches the outgoing message.
			const id = await saveDraft();
			const insertion = await api.post<TemplateInsertion>(`/api/templates/${template.id}/insert`, { draftId: id });
		let html = template.bodyHtml ?? textToHtml(template.bodyText);
		const previews = new Map(insertion.attachments.map((attachment) => [attachment.to, draftAttachmentUrl(id, attachment.id)]));
		for (const replacement of insertion.replacements) {
			html = html.replaceAll(replacement.from, previews.get(replacement.to) ?? replacement.to);
		}
			if (!subject.trim() && template.subject) setSubject(template.subject);
			if (insertion.attachments.length > 0) {
				setAttachments((current) => [...current, ...insertion.attachments]);
				// Let the preview-source map reach Maily before it emits its update.
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			}
			editorRef.current?.prepend(html);
			toast.ok(`Template "${template.name}" inserted`);
		} catch (error) {
			toast.fail("Could not insert the template", error instanceof ApiError ? error.message : undefined);
		}
	}

	async function submit(mode: "send" | "draft") {
		setState("loading");
		try {
			// Both paths go through the draft row, because that is what the
			// attachments hang off.
			const id = await saveDraft();

			if (mode === "draft") {
				setDone(true);
				toast.ok("Draft saved");
				await navigate({ to: "/mail/$folder", params: { folder: "drafts" } });
			} else {
				await api.post(`/api/send/drafts/${id}/send`);
				setDone(true);
				toast.ok("Message sent");
				await navigate({ to: "/mail/$folder", params: { folder: "sent" } });
			}
		} catch (error) {
			toast.fail(
				mode === "draft" ? "Could not save the draft" : "Could not send the message",
				error instanceof ApiError ? error.message : undefined,
			);
		} finally {
			setState("idle");
		}
	}

	return (
		<form
			className="mx-auto flex h-full max-w-3xl flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				void submit("send");
			}}
			/*
			 * ⌘↵ from inside the body, which is where the hands already are — the
			 * textarea swallows plain Enter, so without this the only way to send is
			 * to leave the keyboard.
			 */
			onKeyDown={(event) => {
				if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
				event.preventDefault();
				if (state !== "loading") void submit("send");
			}}
		>
			{replyingTo ? (
				<p className="pb-3 text-[0.8125rem] text-muted-foreground">
					Replying to <Machine className="text-foreground">{replyingTo}</Machine>
				</p>
			) : null}

			<div className="border-t border-border">
				<Row label="From" htmlFor="compose-from">
					<Choice
						id="compose-from"
						value={mailboxId}
						onChange={setMailboxId}
						aria-label="From"
						size="sm"
						className={cn(ROW_FIELD, "machine w-auto max-w-full gap-2")}
						options={sendable.map((mailbox) => ({ value: mailbox.id, label: mailbox.address }))}
					/>
				</Row>

				<Row
					label="To"
					htmlFor="compose-to"
					action={
						// Cc and Bcc are empty on most messages, so they cost a click rather
						// than two permanent rows of blank envelope.
						<>
							{ccOpen ? null : (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs text-muted-foreground"
									onClick={() => setCcOpen(true)}
								>
									Cc
								</Button>
							)}
							{bccOpen ? null : (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs text-muted-foreground"
									onClick={() => setBccOpen(true)}
								>
									Bcc
								</Button>
							)}
						</>
					}
				>
					<Input
						id="compose-to"
						value={to}
						onChange={(event) => setTo(event.target.value)}
						required
						autoFocus={!replyingTo}
						autoComplete="off"
						placeholder="name@example.com, other@example.com"
						className={cn(ROW_FIELD, "machine")}
					/>
				</Row>

				{ccOpen ? (
					<Row label="Cc" htmlFor="compose-cc">
						<Input
							id="compose-cc"
							value={cc}
							onChange={(event) => setCc(event.target.value)}
							autoFocus
							autoComplete="off"
							className={cn(ROW_FIELD, "machine")}
						/>
					</Row>
				) : null}

				{bccOpen ? (
					<Row label="Bcc" htmlFor="compose-bcc">
						<Input
							id="compose-bcc"
							value={bcc}
							onChange={(event) => setBcc(event.target.value)}
							autoFocus
							autoComplete="off"
							className={cn(ROW_FIELD, "machine")}
						/>
					</Row>
				) : null}

				<Row label="Subject" htmlFor="compose-subject">
					<Input
						id="compose-subject"
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						maxLength={300}
						className={ROW_FIELD}
					/>
				</Row>
			</div>

			{/* The message is the point of the screen, so it takes the space that is
			    left rather than a fixed box with the actions stranded below it. */}
			<MailyEditor
				handleRef={editorRef}
				initialHtml={initial.body}
				onChange={(html) => setBody(html)}
				ariaLabel="Message"
				onImageUpload={attachInlineImage}
				imagePreviewSources={imagePreviewSources}
				className="flex-1"
			/>

			{attachments.length > 0 ? (
				<ul className="flex flex-wrap gap-2 pb-3">
					{attachments.map((attachment) => (
						<li
							key={attachment.id}
							className="pogpin-shell-chip flex items-center gap-2 rounded-lg py-1 pr-1 pl-2.5 text-xs"
						>
							{attachment.disposition === "inline" ? <Image aria-hidden className="size-3 shrink-0" /> : <Paperclip aria-hidden className="size-3 shrink-0" />}
							<span className="max-w-[16rem] truncate text-foreground">{attachment.filename}</span>
							{attachment.disposition === "inline" ? (
								<Tag tone="accent" className="shrink-0">Inline image</Tag>
							) : (
								<>
									<Machine className="shrink-0 text-[0.6875rem]">{bytes(attachment.sizeBytes)}</Machine>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={`Remove ${attachment.filename}`}
										className="size-6"
										onClick={() => void detach(attachment)}
									>
										<X className="size-3" />
									</Button>
								</>
							)}
						</li>
					))}
				</ul>
			) : null}

			<footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-[var(--pogpin-shell-panel)] py-3">
				<SubmitButton
					type="submit"
					state={state}
					icon={<Send className="size-3.5" />}
					title="Send (⌘↵)"
				>
					Send
				</SubmitButton>

				{/* Autosave already keeps the draft; what this button does is leave. */}
				<Button
					type="button"
					variant="secondary"
					title="Save the draft and go to Drafts"
					onClick={() => void submit("draft")}
				>
					<Save className="size-3.5" />
					Save and close
				</Button>

				<input
					ref={fileRef}
					type="file"
					multiple
					className="hidden"
					aria-hidden
					tabIndex={-1}
					onChange={(event) => void attach(event.target.files)}
				/>
				<Button
					type="button"
					variant="ghost"
					disabled={attaching}
					onClick={() => fileRef.current?.click()}
				>
					<Paperclip className="size-3.5" />
					{attaching ? "Attaching…" : "Attach"}
				</Button>

				<Button type="button" variant="ghost" onClick={() => setPreviewOpen(true)}>
					<Eye className="size-3.5" />
					Preview
				</Button>

				{/*
				 * Templates are written in Settings and were, until now, unusable —
				 * saved replies with nowhere to go. This is the "one click" that screen
				 * promises: the subject if the field is still empty, the body above
				 * whatever is already typed, so a quoted reply survives.
				 */}
				{templates.data?.length ? (
					<Choice
						placeholder="Use a template"
						aria-label="Use a template"
						size="sm"
						className="w-auto min-w-40"
						options={templates.data.map((template) => ({
							value: template.id,
							label: template.name,
						}))}
						onChange={(id) => {
							const template = templates.data?.find((entry) => entry.id === id);
							if (!template) return;
							void insertTemplate(template);
						}}
					/>
				) : null}

				<span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
					<SaveIndicator state={saveState} unsaved={unsaved} />
					<kbd className="machine flex h-7 shrink-0 items-center justify-center rounded-md border border-border bg-[var(--pogpin-shell-fill-soft)] px-2 text-xs leading-none text-muted-foreground">
						⌘ + ↵
					</kbd>
				</span>
			</footer>

			{/*
			 * Autosave covers the common case, but the keystrokes inside the debounce
			 * window are not on the server yet — so leaving asks, and both answers are
			 * things an operator actually wants.
			 */}
			<Modal
				open={blocker.status === "blocked"}
				onClose={() => blocker.reset?.()}
				title="Leave without saving?"
				description="This draft has changes that have not reached the server yet."
			>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => blocker.reset?.()}>
						Keep writing
					</Button>
					<Button
						type="button"
						onClick={async () => {
							try {
								await saveDraft();
							} catch (error) {
								toast.fail(
									"Could not save the draft",
									error instanceof ApiError ? error.message : undefined,
								);
							}
							blocker.proceed?.();
						}}
					>
						Save and leave
					</Button>
				</div>
			</Modal>

			<Modal
				open={previewOpen}
				onClose={() => setPreviewOpen(false)}
				title="Message preview"
				description="Preview the subject and body before sending. Rendering can vary between email clients."
				className="sm:max-w-3xl"
			>
				<div className="flex justify-end gap-1" role="group" aria-label="Preview width">
					<Button type="button" size="sm" variant={previewMode === "desktop" ? "secondary" : "ghost"} aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")}>Desktop</Button>
					<Button type="button" size="sm" variant={previewMode === "mobile" ? "secondary" : "ghost"} aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")}>Mobile</Button>
				</div>
				<div data-preview-width={previewMode} className={cn("mx-auto overflow-hidden rounded-panel border border-seam bg-white transition-[width]", previewMode === "mobile" ? "w-[23.4375rem] max-w-full" : "w-full")}>
					<p className="border-b border-seam px-4 py-3 text-sm font-medium text-black">{subject.trim() || "(No subject)"}</p>
					<EmailFrame title="Message body preview" html={previewHtml} />
				</div>
			</Modal>
		</form>
	);
}

function SaveIndicator({ state, unsaved }: { state: SaveState; unsaved: boolean }) {
	if (state === "saving") return <span>Saving…</span>;
	if (state === "error") return <span className="text-destructive">Not saved</span>;
	if (unsaved) return <span>Unsaved changes</span>;
	if (state === "saved") return <span>Draft saved</span>;
	return null;
}

/** Opening this screen and leaving it must not litter the drafts folder. */
function hasContent(values: FormValues): boolean {
	return Boolean(
		values.to.trim() ||
			values.cc.trim() ||
			values.bcc.trim() ||
			values.subject.trim() ||
			htmlHasContent(values.body),
	);
}
