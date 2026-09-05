import { useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { api, ApiError } from "@/client/lib/api";
import { AuthError, AuthField, authInputClass } from "@/client/components/app/auth-field";
import { Input } from "@/client/components/ui";
import { SubmitButton } from "@/client/components/app/button";
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
