import { z } from "zod";

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The caller identity every authenticated route sees. Never includes the password hash. */
export type SessionUser = {
	id: string;
	email: string;
	name: string;
	role: UserRole;
	avatarKey: string | null;
	/** How this operator reads a folder; see `MAIL_LAYOUTS`. */
	mailLayout: "conversations" | "messages";
	canManageMailboxes: boolean;
};

export const loginInput = z.object({
	email: z.email(),
	password: z.string().min(1),
});

export const registerInput = z.object({
	email: z.email(),
	name: z.string().min(1).max(120),
	password: z.string().min(12, "Use at least 12 characters"),
});

export const setupInput = registerInput;

export type LoginInput = z.infer<typeof loginInput>;
export type RegisterInput = z.infer<typeof registerInput>;

export type SetupStatus = {
	needsSetup: boolean;
	allowRegistration: boolean;
	appName: string;
};
