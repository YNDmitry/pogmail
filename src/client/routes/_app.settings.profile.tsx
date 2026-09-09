import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, List, MessagesSquare } from "lucide-react";
import { Button, SubmitButton } from "@/client/components/app/button";
import { Input } from "@/client/components/ui";
import { Card, Field } from "@/client/components/app/primitives";
import { cn } from "@/client/lib/utils";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { useSession } from "@/client/lib/queries";
import { qk } from "@/client/lib/queries/keys";

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
