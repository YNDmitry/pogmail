export type InboundQueueMessage = {
	kind: "inbound";
	mailboxId: string;
	rawKey: string;
	to: string;
	from: string;
	sizeBytes: number;
	receivedAt: number;
};

export type WebhookRetryMessage = {
	kind: "webhook-retry";
	deliveryId: string;
	attempt: number;
};

export type OutboundSendMessage = {
	kind: "outbound";
	jobId: string;
};

export type QueuePayload = InboundQueueMessage | WebhookRetryMessage | OutboundSendMessage;

export const isInbound = (m: QueuePayload): m is InboundQueueMessage => m.kind === "inbound";
export const isWebhookRetry = (m: QueuePayload): m is WebhookRetryMessage => m.kind === "webhook-retry";
export const isOutbound = (m: QueuePayload): m is OutboundSendMessage => m.kind === "outbound";
