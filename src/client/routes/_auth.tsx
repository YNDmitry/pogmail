import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useBranding } from "@/client/lib/queries";
import { Mark } from "@/client/components/app/mark";
import { IdentityProvider } from "@/client/lib/identity-context";

export const Route = createFileRoute("/_auth")({ component: AuthRoute });

function AuthRoute() {
	const branding = useBranding();

	return (
		<IdentityProvider appName={branding.data?.appName}>
			<AuthLayout appName={branding.data?.appName ?? "Pogmail"} />
		</IdentityProvider>
	);
}

/**
 * Signed-out chrome, and the first thing an operator ever sees of this
 * deployment: one dark ground, one card, and the instance mark above the form
 * so the identity is established before the first keystroke. The auth surface
 * is dark in both themes — it is a door, not a room.
 */
function AuthLayout({ appName }: { appName: string }) {
	return (
		<div className="relative min-h-svh overflow-hidden bg-[var(--pogpin-auth-bg)] text-[var(--pogpin-auth-text)] selection:bg-white/15 selection:text-white">
			<main className="relative z-10 mx-auto flex min-h-svh w-full max-w-[30rem] items-center px-5 py-20 sm:px-6 sm:py-24">
				<div className="pogpin-auth-card w-full">
					<div className="pogpin-auth-card-inner px-6 py-7 sm:px-8 sm:py-8">
						<div className="mb-7 flex items-center justify-center gap-2.5">
							<Mark className="size-8" />
							<span className="text-[0.95rem] font-semibold tracking-[-0.03em]">{appName}</span>
						</div>

						<Outlet />
					</div>
				</div>
			</main>
		</div>
	);
}
