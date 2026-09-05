import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { api, ApiError } from "@/client/lib/api";
import { SubmitButton } from "@/client/components/app/button";
import { AuthError, AuthField, authInputClass } from "@/client/components/app/auth-field";
import { Input } from "@/client/components/ui";
import type { SetupStatus } from "@/shared/contract/auth";

export const Route = createFileRoute("/_auth/register")({
	beforeLoad: async () => {
		const status = await api.get<SetupStatus>("/api/setup/status");
		if (status.needsSetup) throw redirect({ to: "/setup" });
		// An open mail host is an open relay for spam, so sign-up is opt-in.
		if (!status.allowRegistration) throw redirect({ to: "/login" });
	},
	component: Register,
});

function Register() {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError(null);

		const form = new FormData(event.currentTarget);
		try {
			await api.post("/api/auth/register", {
				email: String(form.get("email")),
				name: String(form.get("name")),
				password: String(form.get("password")),
			});
			await router.invalidate();
			await router.navigate({ to: "/mail/$folder", params: { folder: "inbox" } });
		} catch (cause) {
			setError(cause instanceof ApiError ? cause.message : "Could not create the account");
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={submit} className="space-y-5 text-left">
			<header className="space-y-2 text-center">
				<h1 className="text-[1.75rem] font-medium tracking-[-0.035em] text-balance text-[var(--pogpin-auth-text)] sm:text-[2rem]">Create an account</h1>
			</header>

			<AuthField label="Your name">
				<Input name="name" required autoFocus maxLength={120} className={authInputClass} />
			</AuthField>

			<AuthField label="Email">
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

			<p className="text-center text-sm text-[var(--pogpin-auth-copy)]">
				Already have an account?{" "}
				<Link to="/login" className="pogpin-auth-link font-medium text-[var(--pogpin-auth-text)] underline underline-offset-2 hover:text-[var(--pogpin-brand-400)]">
					Sign in
				</Link>
			</p>
		</form>
	);
}
