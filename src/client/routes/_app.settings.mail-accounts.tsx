import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { Button, SubmitButton } from "@/client/components/app/button";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { Input } from "@/client/components/ui";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/settings/mail-accounts")({ component: MailAccounts });

type Account = {
	id: string;
	mailboxId: string;
	address: string;
	displayName: string | null;
	imapHost: string;
	imapPort: number;
	smtpHost: string;
	smtpPort: number;
	status: "active" | "paused" | "needs_auth" | "error";
	lastSyncedAt: string | null;
	lastError: string | null;
};

function MailAccounts() {
	const toast = useToast();
	const client = useQueryClient();
	const accounts = useQuery({
		queryKey: qk.externalAccounts,
		queryFn: async () => (await api.get<{ items: Account[] }>("/api/external-accounts")).items,
	});
	const [busy, setBusy] = useState(false);

	async function refresh() {
		await client.invalidateQueries({ queryKey: qk.externalAccounts });
		await client.invalidateQueries({ queryKey: qk.mailboxes });
	}

	async function connect(form: HTMLFormElement) {
		const data = new FormData(form);
		setBusy(true);
		try {
			await api.post("/api/external-accounts", {
				address: String(data.get("address")).trim(),
				displayName: String(data.get("displayName")).trim() || null,
				imap: connection(data, "imap"),
				smtp: connection(data, "smtp"),
			});
			form.reset();
			toast.ok("Mail account connected", "The first inbox sync is queued.");
			await refresh();
		} catch (error) {
			toast.fail("Could not connect", error instanceof ApiError ? error.message : undefined);
		} finally {
			setBusy(false);
		}
	}

	async function action(account: Account, operation: "sync" | "pause" | "resume" | "disconnect") {
		setBusy(true);
		try {
			if (operation === "sync") await api.post(`/api/external-accounts/${account.id}/sync`);
			else if (operation === "disconnect") await api.delete(`/api/external-accounts/${account.id}`);
			else await api.patch(`/api/external-accounts/${account.id}`, { status: operation === "pause" ? "paused" : "active" });
			toast.ok(operation === "sync" ? "Sync queued" : operation === "disconnect" ? "Account disconnected" : "Account updated");
			await refresh();
		} catch (error) {
			toast.fail("Could not update account", error instanceof ApiError ? error.message : undefined);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-8">
			<header>
				<h2 className="display text-base">Mail accounts</h2>
				<p className="mt-1 max-w-prose text-sm text-ink-2">
					Read and send mail from an existing mailbox over IMAP and SMTP. Credentials are encrypted and never shown again.
				</p>
			</header>

			<Card className="p-5">
				<form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void connect(event.currentTarget); }}>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Email address"><Input name="address" type="email" required placeholder="you@example.com" /></Field>
						<Field label="Display name"><Input name="displayName" placeholder="Jane Doe" /></Field>
					</div>
					<ConnectionFields prefix="imap" title="IMAP inbox" host="imap.example.com" port={993} />
					<ConnectionFields prefix="smtp" title="SMTP sending" host="smtp.example.com" port={465} />
					<SubmitButton state={busy ? "loading" : "idle"} loadingText="Checking servers…">Connect account</SubmitButton>
				</form>
			</Card>

			<section className="space-y-3">
				<h3 className="display text-sm">Connected accounts</h3>
				{accounts.data?.length ? accounts.data.map((account) => (
					<Card key={account.id} className="flex flex-wrap items-center gap-3 p-4">
						<div className="min-w-0 flex-1"><p className="machine truncate text-sm text-foreground">{account.address}</p><p className="mt-1 text-xs text-muted-foreground"><Machine>{account.imapHost}:{account.imapPort}</Machine> · <Machine>{account.smtpHost}:{account.smtpPort}</Machine></p>{account.lastError ? <p className="mt-2 text-xs text-destructive">{account.lastError}</p> : null}</div>
						<Tag tone={account.status === "active" ? "ok" : account.status === "paused" ? "neutral" : "fail"}>{account.status.replace("_", " ")}</Tag>
						<Button size="sm" variant="secondary" disabled={busy || account.status !== "active"} onClick={() => void action(account, "sync")}><RefreshCw className="size-3.5" />Sync</Button>
						<Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(account, account.status === "paused" ? "resume" : "pause")}>{account.status === "paused" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{account.status === "paused" ? "Resume" : "Pause"}</Button>
						<Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(account, "disconnect")}><Unplug className="size-3.5" />Disconnect</Button>
					</Card>
				)) : <Empty title="No mail accounts" body="Connect an IMAP and SMTP account to keep it in Pogmail." />}
			</section>
		</div>
	);
}

function ConnectionFields({ prefix, title, host, port }: { prefix: "imap" | "smtp"; title: string; host: string; port: number }) {
	return <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">{title}</legend><Field label="Server"><Input name={`${prefix}Host`} required placeholder={host} /></Field><Field label="Port"><Input name={`${prefix}Port`} type="number" required defaultValue={port} /></Field><Field label="Username"><Input name={`${prefix}Username`} required autoComplete="off" /></Field><Field label="Password or app password"><Input name={`${prefix}Password`} type="password" required autoComplete="new-password" /></Field></fieldset>;
}

function connection(data: FormData, prefix: "imap" | "smtp") {
	const port = Number(data.get(`${prefix}Port`));
	return { host: String(data.get(`${prefix}Host`)).trim(), port, security: port === 465 || port === 993 ? "tls" : "starttls", username: String(data.get(`${prefix}Username`)).trim(), password: String(data.get(`${prefix}Password`)) };
}
