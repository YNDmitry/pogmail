import type { MailboxPermission } from "./permissions";

export type MessageStatus =
  "received" | "sent" | "draft" | "spam" | "trash" | "archived";
export type MailAddress = { address: string; name?: string };

export type MailboxSummary = {
  id: string;
  address: string;
  localPart: string;
  displayName: string | null;
  avatarKey: string | null;
  type: "personal" | "shared";
  disabled: boolean;
  permission: MailboxPermission;
};

export type MessageSummary = {
  id: string;
  mailboxId: string;
  threadId: string;
  direction: "inbound" | "outbound";
  status: MessageStatus;
  folderId: string | null;
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: MailAddress[];
  snippet: string | null;
  read: boolean;
  starred: boolean;
  snoozedUntil: string | null;
  hasAttachments: boolean;
  sizeBytes: number;
  receivedAt: string;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  disposition: "attachment" | "inline";
  contentId: string | null;
};

export type MessageDetail = MessageSummary & {
  messageId: string | null;
  inReplyTo: string | null;
  ccAddresses: MailAddress[] | null;
  bccAddresses: MailAddress[] | null;
  replyTo: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawKey: string | null;
  attachments: Attachment[];
	/** Present only for messages that have an outbound delivery job. */
	delivery: {
		status: "queued" | "sending" | "sent" | "failed";
		attempts: number;
		lastError: string | null;
		scheduledFor: string | null;
		sentAt: string | null;
		recipients: Array<{
			recipient: string;
			status: "pending" | "sending" | "sent" | "failed" | "permanent";
			attempts: number;
			lastError: string | null;
			sentAt: string | null;
			/** Latest final-or-intermediate event from Cloudflare Email Sending, if subscribed. */
			lifecycle: {
				type: "delivered" | "deferred" | "bounced" | "failed" | "rejected" | "complained";
				deliveryStatus: string;
				bounceType: "hard" | "soft" | null;
				terminal: boolean;
				detail: string | null;
				occurredAt: string;
			} | null;
		}>;
	} | null;
};

export type MessageCounts = {
  byStatus: Partial<Record<MessageStatus, number>>;
  byMailbox: Record<string, number>;
  starred: number;
};

export type Folder = {
  id: string;
  mailboxId: string;
  name: string;
  color: string | null;
  position: number;
};
