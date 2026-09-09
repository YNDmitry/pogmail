import { z } from "zod";

export const updateProfileInput = z.object({
	name: z.string().min(1).max(120).optional(),
	resetEmail: z.email().nullable().optional(),
	mailLayout: z.enum(["conversations", "messages"]).optional(),
});

export const changePasswordInput = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(12, "Use at least 12 characters"),
});

export const forwardingInput = z.object({
	/** Null turns account-level forwarding off. */
	forwardingEmail: z.email().nullable(),
});

export const telegramNotificationsInput = z.object({
	/** Null turns notifications off; Telegram permits numeric IDs and @channel names. */
	telegramChatId: z.string().trim().min(1).max(128).nullable(),
});

export const brandingInput = z.object({
	appName: z.string().min(1).max(60),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #4f46e5")
		.nullable()
		.optional(),
	allowRegistration: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
export type BrandingInput = z.infer<typeof brandingInput>;

export type Branding = {
	appName: string;
	iconUrl: string | null;
	accentColor: string | null;
	allowRegistration: boolean;
};
