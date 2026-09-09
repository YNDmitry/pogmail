import { describe, expect, it } from "vitest";
import { messageSnippet, needsSnippetRepair } from "@/worker/email/snippet";

describe("email snippets", () => {
	it("drops ASCII table borders before creating a preview", () => {
		const text = `
+---------------------------------------+
| Your application confirmation code: 8020 |
+---------------------------------------+
`;

		expect(messageSnippet(text)).toBe("Your application confirmation code: 8020");
		expect(needsSnippetRepair("+--------------------+ | +----------")).toBe(true);
	});

	it("uses the HTML alternative when the text alternative contains only decoration", () => {
		expect(
			messageSnippet("+----------------+\n|\n+----------------+", "<h1>Welcome&nbsp;back</h1><p>Your code is <strong>8020</strong>.</p>"),
		).toBe("Welcome back Your code is 8020.");
	});

	it("keeps ordinary previews unchanged", () => {
		expect(messageSnippet("A normal email preview\nwith a second line.")).toBe("A normal email preview with a second line.");
		expect(needsSnippetRepair("A normal email preview")).toBe(false);
	});
});
