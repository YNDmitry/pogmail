export const MAILBOX_PERMISSIONS = ["read_only", "send_as", "send_on_behalf", "full_access"] as const;
export type MailboxPermission = (typeof MAILBOX_PERMISSIONS)[number];

/** Wording the UI shows; the enum names are storage detail, not user language. */
export const PERMISSION_LABELS: Record<MailboxPermission, string> = {
	read_only: "Can read",
	send_as: "Can send as this address",
	send_on_behalf: "Can send on behalf",
	full_access: "Full access",
};

export const canSend = (permission: MailboxPermission): boolean => permission !== "read_only";
