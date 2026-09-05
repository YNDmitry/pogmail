import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileUp, Server, Upload } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Card, Field, Machine } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { useMailboxes } from "@/client/lib/queries";
import { cn } from "@/client/lib/utils";

/** Radix refuses an empty item value, so "no filter" is spelled out. */
const EVERY_MAILBOX = "__all";

export const Route = createFileRoute("/_app/settings/import-export")({ component: ImportExport });

type ImportSource = "server" | "file";

function ImportExport() {
	const toast = useToast();
	const mailboxes = useMailboxes();
	const [mailboxId, setMailboxId] = useState("");
	const [source, setSource] = useState<ImportSource>("server");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	/** Reads an NDJSON export and posts it in chunks the endpoint will accept. */
	async function importFile(file: File | null) {
		if (!file || !mailboxId) return;

		setBusy(true);
		try {
			const lines = (await file.text()).split("\n").filter(Boolean);
			const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

			// The endpoint caps a request at 500 messages, so a large archive is sent
			// in chunks rather than one enormous body.
			let imported = 0;
			for (let index = 0; index < parsed.length; index += 500) {
				const chunk = parsed.slice(index, index + 500).map((row) => ({
					subject: row.subject ?? null,
					from: row.fromAddress,
					to:
						(row.toAddresses as { address: string }[] | undefined)?.map(
							(entry) => entry.address,
						) ?? [],
					bodyText: row.bodyText ?? null,
					bodyHtml: row.bodyHtml ?? null,
					receivedAt: new Date(String(row.receivedAt)).getTime(),
					messageId: row.messageId ?? null,
					status: row.status ?? "received",
				}));

				const result = await api.post<{ imported: number }>("/api/mail/import", {
					mailboxId,
					messages: chunk,
				});
				imported += result.imported;
			}

			toast.ok(`Imported ${imported} message${imported === 1 ? "" : "s"}`);
		} catch (error) {
			toast.fail("Import failed", String(error));
		} finally {
			setBusy(false);
			// Without this, picking the same file twice in a row fires no change event.
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	return (
		<div className="space-y-8">
			<section className="space-y-4">
				<div>
					<h2 className="display text-base">Export</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Take your mail with you. NDJSON keeps every field Pogmail stores; mbox is what other mail
						clients import.
					</p>
				</div>

				<Card>
					{/*
					 * The action sits in its own row rather than trying to share a
					 * baseline with two labelled fields — a control with no label above it
					 * can only be aligned by eye, and it always looks a line low.
					 */}
					<form
						className="divide-y divide-border"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const query = new URLSearchParams({ format: String(form.get("format")) });
							const box = String(form.get("mailboxId"));
							if (box && box !== EVERY_MAILBOX) query.set("mailboxId", box);
							// A file download has to be a real navigation, not a fetch.
							location.assign(`/api/mail/export?${query}`);
						}}
					>
						<div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
							<Field label="Mailbox">
								<Choice
									name="mailboxId"
									options={[
										{ value: EVERY_MAILBOX, label: "All mailboxes" },
										...(mailboxes.data ?? []).map((mailbox) => ({
											value: mailbox.id,
											label: mailbox.address,
										})),
									]}
								/>
							</Field>

							<Field label="Format">
								<Choice
									name="format"
									options={[
										{ value: "ndjson", label: "NDJSON" },
										{ value: "mbox", label: "mbox" },
									]}
								/>
							</Field>
						</div>

						<div className="flex items-center justify-end px-4 py-3">
							<Button type="submit" variant="secondary">
								<Download className="size-3.5" />
								Export
							</Button>
						</div>
					</form>
				</Card>
			</section>

			{/*
			 * One import, two sources. They ask the same first question — which
			 * mailbox the mail lands in — so that question is asked once, above the
			 * choice of where the mail comes from, instead of twice in two cards that
			 * looked like two different features.
			 */}
			<section className="space-y-4">
				<div>
					<h2 className="display text-base">Import</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						Bring mail in from another server over IMAP, or from an NDJSON file exported here.
						Messages that are already stored are skipped, so importing twice is safe.
					</p>
				</div>

				<Card className="space-y-4 p-4">
					<Field label="Import into">
						<Choice
							value={mailboxId}
							onChange={setMailboxId}
							placeholder="Choose a mailbox"
							options={(mailboxes.data ?? []).map((mailbox) => ({
								value: mailbox.id,
								label: mailbox.address,
							}))}
						/>
					</Field>

					<Tabs value={source} onValueChange={(next) => setSource(next as ImportSource)}>
						<TabsList className="pogpin-shell-tabs w-full rounded-lg p-1">
							<TabsTrigger value="server" className="pogpin-shell-tab-trigger flex-1 rounded-md">
								<Server className="size-3.5" />
								Another server
							</TabsTrigger>
							<TabsTrigger value="file" className="pogpin-shell-tab-trigger flex-1 rounded-md">
								<FileUp className="size-3.5" />
								A file
							</TabsTrigger>
						</TabsList>

						<TabsContent value="server" className="pt-2">
							<ImapImport mailboxId={mailboxId} />
						</TabsContent>

						<TabsContent value="file" className="space-y-3 pt-2">
							<p className="text-sm text-muted-foreground">
								An <Machine className="text-foreground">.ndjson</Machine> file exported from Pogmail.
							</p>

							<div className="flex flex-wrap items-center gap-3">
								{/* The native picker is hidden: its own button ignores the palette,
								    and it says "No file chosen" where the app says nothing yet. */}
								<input
									ref={fileRef}
									type="file"
									accept=".ndjson,application/x-ndjson,application/json"
									className="hidden"
									aria-hidden
									tabIndex={-1}
									onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
								/>
								<Button
									type="button"
									variant="secondary"
									disabled={!mailboxId || busy}
									onClick={() => fileRef.current?.click()}
								>
									<Upload className="size-3.5" />
									{busy ? "Importing…" : "Choose a file"}
								</Button>

								<p className="text-sm text-muted-foreground">
									{mailboxId
										? "Nothing is sent until you pick a file."
										: "Choose a mailbox first — the messages have to land somewhere."}
								</p>
							</div>
						</TabsContent>
					</Tabs>
				</Card>
			</section>
		</div>
	);
}

/** Credentials are read out of the form each time and never held in state. */
function credentials(form: HTMLFormElement) {
	const data = new FormData(form);
	return {
		host: String(data.get("host")).trim(),
		port: Number(data.get("port")),
		username: String(data.get("username")),
		password: String(data.get("password")),
	};
}

/**
 * Two steps on purpose: the folder list is fetched first so nobody has to know
 * whether their provider calls it "Sent", "[Gmail]/Sent Mail" or "INBOX.Sent".
 */
function ImapImport({ mailboxId }: { mailboxId: string }) {
	const toast = useToast();

	const [folders, setFolders] = useState<string[] | null>(null);
	/** Shown once connected, so the form says which server it is talking to. */
	const [connectedTo, setConnectedTo] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);

	return (
		<form
			ref={formRef}
			className="space-y-4"
			onSubmit={async (event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const data = new FormData(form);

				setBusy(true);
				try {
					const result = await api.post<{ imported: number; skipped: number }>("/api/imap/import", {
						...credentials(form),
						mailboxId,
						folder: String(data.get("folder")),
						limit: Number(data.get("limit")),
					});
					toast.ok(
						`Imported ${result.imported} message${result.imported === 1 ? "" : "s"}`,
						result.skipped ? `${result.skipped} were already here.` : undefined,
					);
				} catch (error) {
					toast.fail("Import failed", error instanceof ApiError ? error.message : undefined);
				} finally {
					setBusy(false);
				}
			}}
		>
			<div className={cn("grid gap-3 sm:grid-cols-[2fr_1fr]", folders && "hidden")}>
				<Field label="Server">
					<Input name="host" required placeholder="imap.example.com" />
				</Field>
				<Field label="Port">
					<Input name="port" type="number" defaultValue={993} required />
				</Field>
			</div>

			<div className={cn("grid gap-3 sm:grid-cols-2", folders && "hidden")}>
				<Field label="Username">
					<Input name="username" required autoComplete="off" />
				</Field>
				<Field label="Password" hint="Used for this import only. It is never stored.">
					<Input name="password" type="password" required autoComplete="off" />
				</Field>
			</div>

			{folders ? (
				<>
					{/*
					 * The credentials are done with, so the step that is left says where
					 * it is connected and how to go back rather than repeating the form.
					 */}
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
						<p className="text-sm text-muted-foreground">
							Connected to <Machine className="text-foreground">{connectedTo}</Machine> ·{" "}
							{folders.length} folder{folders.length === 1 ? "" : "s"}
						</p>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								setFolders(null);
								setConnectedTo(null);
							}}
						>
							Use another server
						</Button>
					</div>

					<div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
						<Field label="Folder">
							<Choice
								name="folder"
								options={folders.map((folder) => ({ value: folder, label: folder }))}
							/>
						</Field>

						<Field label="How many" hint="Newest first.">
							<Input name="limit" type="number" min={1} max={200} defaultValue={100} />
						</Field>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={busy || !mailboxId}>
							<Upload className="size-3.5" />
							{busy ? "Importing…" : "Import messages"}
						</Button>
						{mailboxId ? null : (
							<p className="text-sm text-muted-foreground">
								Choose a mailbox above — the messages have to land somewhere.
							</p>
						)}
					</div>
				</>
			) : (
				<Button
					type="button"
					variant="secondary"
					disabled={busy}
					onClick={async () => {
						if (!formRef.current) return;
						setBusy(true);
						try {
							const result = await api.post<{ folders: string[] }>(
								"/api/imap/folders",
								credentials(formRef.current),
							);
							setFolders(result.folders);
							setConnectedTo(credentials(formRef.current).host);
						} catch (error) {
							toast.fail(
								"Could not connect",
								error instanceof ApiError ? error.message : undefined,
							);
						} finally {
							setBusy(false);
						}
					}}
				>
					{busy ? "Connecting…" : "Connect and list folders"}
				</Button>
			)}
		</form>
	);
}
