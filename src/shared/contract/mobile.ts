import { z } from "zod";
import { loginInput } from "./auth";

/** Credentials submitted only to the dedicated Android login endpoint. */
export const mobileLoginInput = loginInput.extend({
	deviceName: z.string().trim().min(1).max(120),
	appVersion: z.string().trim().min(1).max(64).optional(),
});

/** A refresh token is opaque and deliberately has no user-identifying fields. */
export const mobileRefreshInput = z.object({
	refreshToken: z.string().min(40).max(512),
	deviceName: z.string().trim().min(1).max(120).optional(),
	appVersion: z.string().trim().min(1).max(64).optional(),
});

export type MobileLoginInput = z.infer<typeof mobileLoginInput>;
export type MobileRefreshInput = z.infer<typeof mobileRefreshInput>;
