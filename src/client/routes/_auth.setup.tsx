import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { api, ApiError } from "@/client/lib/api";
import { SubmitButton } from "@/client/components/app/button";
import { AuthError, AuthField, authInputClass } from "@/client/components/app/auth-field";
import { Input } from "@/client/components/ui";
import type { SetupStatus } from "@/shared/contract/auth";

export const Route = createFileRoute("/_auth/setup")({
	beforeLoad: async () => {
		const status = await api.get<SetupStatus>("/api/setup/status");
		// Running the wizard twice would be a way to mint a second admin.
		if (!status.needsSetup) throw redirect({ to: "/login" });
	},
	component: Setup,
});

function Setup() {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(event.currentTarget);
		try {
			await api.post("/api/setup", {
				email: String(form.get("email")),
				name: String(form.get("name")),
				password: String(form.get("password")),
			});
			await router.invalidate();
			await router.navigate({ to: "/admin/domains" });
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : "Setup failed");
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={submit} className="space-y-5 text-left">
			<header className="space-y-2 text-center">
				<h1 className="text-[1.75rem] font-medium tracking-[-0.035em] text-balance text-[var(--pogpin-auth-text)] sm:text-[2rem]">Create the admin account</h1>
				<p className="mx-auto max-w-[22rem] text-sm leading-6 text-balance text-[var(--pogpin-auth-copy)]">
					This account owns the instance. You can add a domain and mailboxes next.
				</p>
			</header>

			<AuthField label="Your name">
				<Input name="name" required autoFocus maxLength={120} className={authInputClass} />
			</AuthField>

			<AuthField label="Email" hint="Used to sign in. It does not have to be on a domain you host.">
				<Input name="email" type="email" required autoComplete="username" className={authInputClass} />
			</AuthField>

			<AuthField label="Password" hint="At least 12 characters.">
				<Input
					name="password"
					type="password"
					required
					minLength={12}
					autoComplete="new-password"
					className={authInputClass}
				/>
			</AuthField>

			{error ? <AuthError>{error}</AuthError> : null}

			<SubmitButton type="submit" state={pending ? "loading" : "idle"} className="h-11 w-full">
				Create account
			</SubmitButton>
		</form>
	);
}
