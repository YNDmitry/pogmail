import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, List, MessagesSquare, Trash2 } from "lucide-react";
import { Button, SubmitButton } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { Card, Field } from "@/client/components/app/primitives";
import { cn } from "@/client/lib/utils";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { useSession } from "@/client/lib/queries";
import { qk } from "@/client/lib/queries/keys";
import { createPasskey, passkeysSupported } from "@/client/lib/passkeys";

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

export const Route = createFileRoute("/_app/settings/profile")({ component: Profile });

const LAYOUTS = [
	{
		value: "conversations" as const,
		label: "Conversations",
		icon: MessagesSquare,
		hint: "A thread is one row, and opening it stacks every message in it, oldest first.",
	},
	{
		value: "messages" as const,
		label: "Individual messages",
		icon: List,
		hint: "One row per message, in the order it arrived — closer to a log of what the server did.",
	},
];

function Profile() {
	const toast = useToast();
	const client = useQueryClient();
	const session = useSession();

	const [saving, setSaving] = useState<"idle" | "loading">("idle");
	const [changing, setChanging] = useState<"idle" | "loading">("idle");
	const [passkeys, setPasskeys] = useState<Passkey[]>([]);
	const [passkeyPending, setPasskeyPending] = useState(false);
	const [passkeySupported] = useState(passkeysSupported);
	const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
	const [recoveryPending, setRecoveryPending] = useState(false);

	useEffect(() => {
		void api.get<Passkey[]>("/api/settings/passkeys").then(setPasskeys).catch(() => undefined);
	}, []);

	async function addPasskey() {
		if (!passkeySupported) return;
		setPasskeyPending(true);
		try {
			const options = await api.post<Parameters<typeof createPasskey>[0]>("/api/auth/passkeys/register/options");
			const response = await createPasskey(options);
			const created = await api.post<Passkey>("/api/auth/passkeys/register/verify", {
				...response,
				name: "Passkey",
			});
			setPasskeys((current) => [...current, created]);
			toast.ok("Passkey added", "You can now sign in with this device.");
		} catch (error) {
			if (error instanceof DOMException && error.name === "NotAllowedError") return;
			toast.fail("Could not add passkey", error instanceof ApiError ? error.message : undefined);
		} finally {
			setPasskeyPending(false);
		}
	}

	async function generateRecoveryCodes() {
		setRecoveryPending(true);
		try {
			const result = await api.post<{ codes: string[] }>("/api/settings/recovery-codes");
			setRecoveryCodes(result.codes);
			toast.ok("Recovery codes created", "Save them somewhere private. Each code works once.");
		} catch (error) {
			toast.fail("Could not create recovery codes", error instanceof ApiError ? error.message : undefined);
		} finally {
			setRecoveryPending(false);
		}
	}

	return (
		<div className="space-y-8">
			<section className="space-y-4">
				<h2 className="display text-base">Your details</h2>

				<Card className="p-5">
					<form
						className="space-y-4"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							setSaving("loading");
							try {
								await api.patch("/api/settings/profile", {
									name: String(form.get("name")),
									resetEmail: String(form.get("resetEmail")) || null,
								});
								await client.invalidateQueries({ queryKey: qk.session });
								toast.ok("Profile saved");
							} catch (error) {
								toast.fail("Could not save", error instanceof ApiError ? error.message : undefined);
							} finally {
								setSaving("idle");
							}
						}}
					>
						<Field label="Name">
							<Input
								name="name"
								defaultValue={session.data?.name}
								required
								maxLength={120}

							/>
						</Field>

						<Field
							label="Recovery email"
							hint="Where password resets go if you cannot reach your own mailbox."
						>
							<Input name="resetEmail" type="email" />
						</Field>

						<SubmitButton type="submit" state={saving}>
							Save profile
						</SubmitButton>
					</form>
				</Card>
			</section>

			{/*
			 * Reading mail is either a conversation or a log, and which one it is
			 * depends on the person, not on the product: an operator watching what a
			 * server did wants every message; someone corresponding with people wants
			 * the thread. The choice follows the account rather than the browser, so
			 * a second device reads the same way.
			 */}
			<section className="space-y-4">
				<h2 className="display text-base">Reading mail</h2>

				<Card className="divide-y divide-border">
					{LAYOUTS.map((layout) => {
						const active = (session.data?.mailLayout ?? "messages") === layout.value;
						return (
							<button
								key={layout.value}
								type="button"
								aria-pressed={active}
								className={cn(
									"flex w-full items-start gap-3 p-4 text-left transition-colors",
									active ? "bg-accent" : "hover:bg-[var(--pogpin-shell-fill-soft)]",
								)}
								onClick={async () => {
									if (active) return;
									try {
										await api.patch("/api/settings/profile", { mailLayout: layout.value });
										await client.invalidateQueries({ queryKey: qk.session });
										toast.ok(`Reading mail as ${layout.label.toLowerCase()}`);
									} catch (error) {
										toast.fail("Could not save", error instanceof ApiError ? error.message : undefined);
									}
								}}
							>
								<span
									className={cn(
										"mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border",
										active
											? "border-[var(--pogpin-brand-border)] bg-primary text-primary-foreground"
											: "border-border text-muted-foreground",
									)}
								>
									<layout.icon className="size-4" />
								</span>

								<span className="min-w-0">
									<span
										className={cn(
											"flex items-center gap-2 text-sm font-medium",
											active ? "text-primary" : "text-foreground",
										)}
									>
										{layout.label}
										{active ? <Check aria-hidden className="size-3.5" /> : null}
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">{layout.hint}</span>
								</span>
							</button>
						);
					})}
				</Card>
			</section>

			<section className="space-y-4">
				<h2 className="display text-base">Recovery codes</h2>
				<p className="max-w-prose text-sm text-ink-2">Keep these offline. They let you sign in once if every passkey is unavailable, then you should add a new passkey.</p>
				<Card className="p-5">
					{recoveryCodes ? <div className="mb-4 grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm text-foreground sm:grid-cols-5">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div> : null}
					<Button type="button" variant="secondary" onClick={generateRecoveryCodes} disabled={recoveryPending}>{recoveryPending ? "Creating codes…" : recoveryCodes ? "Replace recovery codes" : "Create recovery codes"}</Button>
					<p className="mt-2 text-xs text-muted-foreground">Creating another set invalidates the previous codes.</p>
				</Card>
			</section>

			<section className="space-y-4">
				<h2 className="display text-base">Telegram notifications</h2>
				<p className="max-w-prose text-sm text-ink-2">
					Receive a short alert when a new message reaches a mailbox you can access. Start a chat with
					the instance bot first, then enter your Telegram chat ID or a channel username.
				</p>

				<Card className="p-5">
					<form
						className="flex flex-wrap items-end gap-3"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const value = String(form.get("telegramChatId")).trim();
							try {
								await api.put("/api/settings/telegram", { telegramChatId: value || null });
								await client.invalidateQueries({ queryKey: qk.session });
								toast.ok(value ? "Telegram notifications on" : "Telegram notifications off");
							} catch (error) {
								toast.fail(
									"Could not update Telegram notifications",
									error instanceof ApiError ? error.message : undefined,
								);
							}
						}}
					>
						<Field label="Chat ID" className="flex-1">
							<Input
								name="telegramChatId"
								defaultValue={session.data?.telegramChatId ?? ""}
								placeholder="-1001234567890 or @my_channel"
								maxLength={128}
							/>
						</Field>
						<Button type="submit" variant="secondary">
							Update
						</Button>
					</form>
				</Card>
			</section>

			<section className="space-y-4">
				<h2 className="display text-base">Forwarding</h2>
				<p className="max-w-prose text-sm text-ink-2">
					Send a copy of everything that arrives to another address. The original still lands in your
					mailbox here.
				</p>

				<Card className="p-5">
					<form
						className="flex flex-wrap items-end gap-3"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const value = String(form.get("forwardingEmail")).trim();
							try {
								await api.put("/api/settings/forwarding", { forwardingEmail: value || null });
								toast.ok(value ? "Forwarding on" : "Forwarding off");
							} catch (error) {
								toast.fail("Could not update forwarding", String(error));
							}
						}}
					>
						<Field label="Forward to" className="flex-1">
							<Input
								name="forwardingEmail"
								type="email"
								placeholder="you@example.com"

							/>
						</Field>
						<Button type="submit" variant="secondary">
							Update
						</Button>
					</form>
				</Card>
			</section>

			<section className="space-y-4">
				<h2 className="display text-base">Passkeys</h2>
				<p className="max-w-prose text-sm text-ink-2">
					Use Face ID, Touch ID, Windows Hello, or your device lock instead of entering your password.
				</p>

				<Card className="divide-y divide-border">
					{passkeys.length ? (
						passkeys.map((passkey) => (
							<div key={passkey.id} className="flex items-center gap-3 p-4">
								<span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground">
									<KeyRound className="size-4" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium text-foreground">{passkey.name}</span>
									<span className="block text-xs text-muted-foreground">
										{passkey.lastUsedAt ? `Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : "Not used yet"}
									</span>
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={`Remove ${passkey.name}`}
									onClick={async () => {
										try {
											await api.delete(`/api/settings/passkeys/${passkey.id}`);
											setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
											toast.ok("Passkey removed");
										} catch (error) {
											toast.fail("Could not remove passkey", error instanceof ApiError ? error.message : undefined);
										}
									}}
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						))
					) : (
						<p className="p-4 text-sm text-muted-foreground">No passkeys added yet.</p>
					)}
					<div className="p-4">
						<Button type="button" variant="secondary" onClick={addPasskey} disabled={!passkeySupported || passkeyPending}>
							<KeyRound className="size-4" />
							{passkeyPending ? "Waiting for passkey…" : "Add passkey"}
						</Button>
						{!passkeySupported ? <p className="mt-2 text-xs text-muted-foreground">This browser does not support passkeys.</p> : null}
					</div>
				</Card>
			</section>

			<section className="space-y-4">
				<h2 className="display text-base">Password</h2>
				<p className="max-w-prose text-sm text-ink-2">
					Changing your password signs you out everywhere, including this device.
				</p>

				<Card className="p-5">
					<form
						className="space-y-4"
						onSubmit={async (event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							setChanging("loading");
							try {
								await api.put("/api/settings/password", {
									currentPassword: String(form.get("currentPassword")),
									newPassword: String(form.get("newPassword")),
								});
								toast.ok("Password changed", "Sign in again to continue.");
								setTimeout(() => location.assign("/login"), 1200);
							} catch (error) {
								toast.fail(
									"Could not change the password",
									error instanceof ApiError ? error.message : undefined,
								);
							} finally {
								setChanging("idle");
							}
						}}
					>
						<Field label="Current password">
							<Input
								name="currentPassword"
								type="password"
								required
								autoComplete="current-password"

							/>
						</Field>

						<Field label="New password" hint="At least 12 characters.">
							<Input
								name="newPassword"
								type="password"
								required
								minLength={12}
								autoComplete="new-password"

							/>
						</Field>

						<SubmitButton type="submit" state={changing}>
							Change password
						</SubmitButton>
					</form>
				</Card>
			</section>
		</div>
	);
}
