import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { applyIdentity, deriveIdentity, identitySource, type Identity } from "./identity";

const IdentityContext = createContext<Identity | null>(null);

/**
 * Resolves this deployment's identity, publishes it to CSS, and hands it to any
 * component that draws the mark.
 *
 * Both shells mount this: the sign-in screen is the first thing an operator
 * sees, and it should already wear the instance's own face rather than a default
 * that changes once they are through the door.
 */
export function IdentityProvider({
	appName,
	children,
}: {
	appName: string | undefined;
	children: ReactNode;
}) {
	const identity = useMemo(() => deriveIdentity(identitySource(appName ?? "Pogmail")), [appName]);

	useEffect(() => applyIdentity(identity), [identity]);

	return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

/** Falls back to the default seed so a component never has to guard for null. */
export function useInstanceIdentity(): Identity {
	return useContext(IdentityContext) ?? FALLBACK;
}

const FALLBACK: Identity = deriveIdentity("pogmail@localhost");
