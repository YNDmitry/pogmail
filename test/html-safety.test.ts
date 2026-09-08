import { describe, expect, it } from "vitest";
import { safeEmailHtml } from "@/worker/email/html-safety";

describe("outbound email HTML", () => {
	it("keeps formatting but removes active browser content", () => {
		expect(safeEmailHtml('<p onclick="steal()">Hello <a href="javascript:steal()">there</a></p><script>steal()</script>'))
			.toBe("<p>Hello <a>there</a></p>");
	});
});
