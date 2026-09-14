function fromBase64Url(value: string): ArrayBuffer {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return bytes.buffer;
}

function toBase64Url(value: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

type RegistrationOptions = {
	challengeId: string;
	publicKey: {
		challenge: string;
		rp: { id: string; name: string };
		user: { id: string; name: string; displayName: string };
		pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
		timeout: number;
		attestation: "none";
		authenticatorSelection: AuthenticatorSelectionCriteria;
		excludeCredentials: Array<{ type: "public-key"; id: string }>;
	};
};

type AuthenticationOptions = {
	challengeId: string;
	publicKey: { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement };
};

export function passkeysSupported(): boolean {
	return typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;
}

export async function createPasskey(options: RegistrationOptions) {
	const credential = (await navigator.credentials.create({
		publicKey: {
			...options.publicKey,
			challenge: fromBase64Url(options.publicKey.challenge),
			user: { ...options.publicKey.user, id: fromBase64Url(options.publicKey.user.id) },
			excludeCredentials: options.publicKey.excludeCredentials.map((item) => ({
				...item,
				id: fromBase64Url(item.id),
			})),
		},
	})) as PublicKeyCredential | null;
	if (!credential || !(credential.response instanceof AuthenticatorAttestationResponse)) {
		throw new Error("No passkey was created");
	}
	return {
		challengeId: options.challengeId,
		credential: {
			id: credential.id,
			rawId: toBase64Url(credential.rawId),
			response: {
				clientDataJSON: toBase64Url(credential.response.clientDataJSON),
				attestationObject: toBase64Url(credential.response.attestationObject),
			},
		},
	};
}

export async function requestPasskey(options: AuthenticationOptions) {
	const credential = (await navigator.credentials.get({
		publicKey: { ...options.publicKey, challenge: fromBase64Url(options.publicKey.challenge) },
	})) as PublicKeyCredential | null;
	if (!credential || !(credential.response instanceof AuthenticatorAssertionResponse)) {
		throw new Error("No passkey was selected");
	}
	return {
		challengeId: options.challengeId,
		credential: {
			id: credential.id,
			rawId: toBase64Url(credential.rawId),
			response: {
				clientDataJSON: toBase64Url(credential.response.clientDataJSON),
				authenticatorData: toBase64Url(credential.response.authenticatorData),
				signature: toBase64Url(credential.response.signature),
			},
		},
	};
}
