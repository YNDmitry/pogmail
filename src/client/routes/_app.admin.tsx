import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
	Activity,
	AtSign,
	DatabaseBackup,
	Gauge,
	GaugeCircle,
	Globe,
	Palette,
	Route as RouteIcon,
	Users,
	Webhook,
} from "lucide-react";
import { SectionLayout } from "@/client/components/app/section-layout";
import { api } from "@/client/lib/api";
import type { SessionUser } from "@/shared/contract/auth";

export const Route = createFileRoute("/_app/admin")({
	beforeLoad: async () => {
		const user = await api.get<SessionUser>("/api/auth/me");
		// The API enforces this too; the redirect just avoids showing a wall of 403s.
		if (user.role !== "admin") throw redirect({ to: "/mail/$folder", params: { folder: "inbox" } });
	},
	component: AdminLayout,
});

const LINKS = [
	{ to: "/admin/overview", label: "Overview", icon: Gauge },
	{ to: "/admin/deliverability", label: "Delivery health", icon: GaugeCircle },
	{ to: "/admin/domains", label: "Domains", icon: Globe },
	{ to: "/admin/mailboxes", label: "Mailboxes", icon: AtSign },
	{ to: "/admin/accounts", label: "Accounts", icon: Users },
	{ to: "/admin/routing", label: "Routing", icon: RouteIcon },
	{ to: "/admin/webhooks", label: "Webhooks", icon: Webhook },
	{ to: "/admin/activity", label: "Activity", icon: Activity },
	{ to: "/admin/backups", label: "Backups", icon: DatabaseBackup },
	{ to: "/admin/branding", label: "Branding", icon: Palette },
];

function AdminLayout() {
	return (
		<SectionLayout
			title="Administration"
			description="Domains, mailboxes, accounts and everything that decides how mail is handled."
			links={LINKS}
		>
			<Outlet />
		</SectionLayout>
	);
}
