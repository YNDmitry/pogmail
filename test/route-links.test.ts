import { expect, it, vi } from "vitest";
import type { AnyRouter } from "@tanstack/react-router";
import { interceptRouterLinks } from "@/client/lib/route-links";

it("navigates in-app and closes the sheet only for ordinary sidebar links", () => {
	const navigate = vi.fn();
	const close = vi.fn();
	const handler = interceptRouterLinks({ navigate } as unknown as AnyRouter, close);
	const anchor = { getAttribute: () => "/settings/profile", target: "", hasAttribute: () => false };
	const event = (extra: Record<string, unknown> = {}) => ({
		button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
		target: { closest: () => anchor }, preventDefault: vi.fn(), ...extra,
	}) as unknown as Parameters<typeof handler>[0];

	const ordinary = event();
	handler(ordinary);
	expect(ordinary.preventDefault).toHaveBeenCalledOnce();
	expect(close).toHaveBeenCalledOnce();
	expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/settings/profile" }));

	handler(event({ metaKey: true }));
	handler(event({ button: 1 }));
	expect(close).toHaveBeenCalledOnce();
	expect(navigate).toHaveBeenCalledOnce();
});
