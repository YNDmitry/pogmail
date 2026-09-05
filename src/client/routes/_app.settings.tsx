import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ArrowLeftRight, AtSign, FileText, Filter, KeyRound, UserCog } from "lucide-react";
import { SectionLayout } from "@/client/components/app/section-layout";

export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });

const LINKS = [
	{ to: "/settings/profile", label: "Profile", icon: UserCog },
	{ to: "/settings/mailboxes", label: "Mailboxes", icon: AtSign },
	{ to: "/settings/rules", label: "Filters", icon: Filter },
	{ to: "/settings/templates", label: "Templates", icon: FileText },
	{ to: "/settings/api-keys", label: "API keys", icon: KeyRound },
	{ to: "/settings/import-export", label: "Import and export", icon: ArrowLeftRight },
];

function SettingsLayout() {
	return (
		<SectionLayout
			title="Settings"
			description="Your account, your mailboxes, and how mail is filed."
			links={LINKS}
		>
			<Outlet />
		</SectionLayout>
	);
}
