import { expect, it } from "vitest";
import { conversationKey, replyAddress } from "@/client/lib/format";
import { htmlHasContent } from "@/client/lib/mail-html";

const message = {
	id: "one", mailboxId: "mailbox", threadId: "thread", status: "received" as const,
	direction: "inbound" as const, fromAddress: "peer@example.test", replyTo: null,
	toAddresses: [{ address: "me@example.test" }],
};

it("chooses a correspondent for received and sent replies", () => {
	expect(replyAddress(message)).toBe("peer@example.test");
	expect(replyAddress({ ...message, replyTo: "reply@example.test" })).toBe("reply@example.test");
	const sent = { ...message, direction: "outbound" as const, fromAddress: "me@example.test",
		toAddresses: [{ address: "ME@example.test" }, { address: "peer@example.test" }] };
	expect(replyAddress(sent)).toBe("peer@example.test");
	expect(replyAddress({ ...sent, toAddresses: [] })).toBe("");
});

it("does not treat an image-only reply as empty content", () => {
	expect(htmlHasContent('<p><img src="cid:photo"></p>')).toBe(true);
	expect(htmlHasContent("<p><br></p>")).toBe(false);
});

it("groups messages only within their mailbox and keeps drafts separate", () => {
	expect(conversationKey(message)).toBe(conversationKey({ ...message, id: "two" }));
	expect(conversationKey(message)).not.toBe(conversationKey({ ...message, mailboxId: "other" }));
	expect(conversationKey({ ...message, status: "draft", id: "draft-one" }))
		.not.toBe(conversationKey({ ...message, status: "draft", id: "draft-two" }));
});
