import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "@/client/lib/api";
import { AuthError, AuthField, authInputClass } from "@/client/components/app/auth-field";
import { Input, Separator } from "@/client/components/ui";
import { Button, SubmitButton } from "@/client/components/app/button";
import { passkeysSupported, requestPasskey } from "@/client/lib/passkeys";
import type { SetupStatus } from "@/shared/contract/auth";

export const Route = createFileRoute("/_auth/login")({
	// A fresh instance has nobody to sign in as; send them to the wizard instead.
	beforeLoad: async () => {
		const status = await api.get<SetupStatus>("/api/setup/status");
		if (status.needsSetup) throw redirect({ to: "/setup" });
		return { status };
	},
	component: Login,
});

function Login() {
	const router = useRouter();
	const { status } = Route.useRouteContext();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [passkeyPending, setPasskeyPending] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(event.currentTarget);
		try {
			await api.post("/api/auth/login", {
				email: String(form.get("email")),
				password: String(form.get("password")),
			});
			await router.invalidate();
			await router.navigate({ to: "/mail/$folder", params: { folder: "inbox" } });
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : "Could not sign in");
		} finally {
			setPending(false);
		}
	}

	async function signInWithPasskey() {
		setPasskeyPending(true);
		setError(null);
		try {
			const options = await api.post<Parameters<typeof requestPasskey>[0]>("/api/auth/passkeys/authenticate/options");
			const response = await requestPasskey(options);
			await api.post("/api/auth/passkeys/authenticate/verify", response);
			await router.invalidate();
			await router.navigate({ to: "/mail/$folder", params: { folder: "inbox" } });
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === "NotAllowedError") return;
			setError(cause instanceof ApiError ? cause.message : "Could not sign in with passkey");
		} finally {
			setPasskeyPending(false);
		}
	}

	return (
		<form onSubmit={submit} className="space-y-5 text-left">
			<header className="space-y-2 text-center">
				<h1 className="text-[1.75rem] font-medium tracking-[-0.035em] text-balance text-[var(--pogpin-auth-text)] sm:text-[2rem]">Sign in</h1>
			</header>

			<AuthField label="Email">
				<Input name="email" type="email" required autoComplete="username" autoFocus className={authInputClass} />
			</AuthField>

			<AuthField label="Password">
				<Input
					name="password"
					type="password"
					required
					autoComplete="current-password"
					className={authInputClass}
				/>
			</AuthField>

			{error ? <AuthError>{error}</AuthError> : null}

			<SubmitButton type="submit" state={pending ? "loading" : "idle"} className="h-11 w-full">
				Sign in
			</SubmitButton>

			{passkeysSupported() ? (
				<>
					<div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
						<Separator className="flex-1" />
						or
						<Separator className="flex-1" />
					</div>
					<Button type="button" variant="secondary" className="h-11 w-full" onClick={signInWithPasskey} disabled={passkeyPending}>
						<KeyRound className="size-4" />
						{passkeyPending ? "Waiting for passkey…" : "Sign in with passkey"}
					</Button>
				</>
			) : null}

			{status.allowRegistration ? (
				<p className="text-center text-sm text-[var(--pogpin-auth-copy)]">
					No account yet?{" "}
					<Link to="/register" className="pogpin-auth-link font-medium text-[var(--pogpin-auth-text)] underline underline-offset-2 hover:text-[var(--pogpin-brand-400)]">
						Create one
					</Link>
				</p>
			) : null}
		</form>
	);
}
