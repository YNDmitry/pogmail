import { createFileRoute } from "@tanstack/react-router";
import { Empty } from "@/client/components/app/primitives";
import { RuleEditor } from "@/client/components/app/rule-editor";
import { useMailboxes } from "@/client/lib/queries";
import { useList } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/routing")({ component: Routing });

type Domain = { id: string; hostname: string; status: string };

function Routing() {
	const domains = useList<Domain>(qk.domains, "/api/domains");
	const mailboxes = useMailboxes();

	if (domains.data && domains.data.length === 0) {
		return <Empty title="No domains" body="Delivery rules belong to a domain, so add one first." />;
	}

	return (
		<RuleEditor
			scope="domain"
			ownerLabel="Domain"
			owners={(domains.data ?? []).map((domain) => ({ id: domain.id, label: domain.hostname }))}
			targetLabel="Deliver to mailbox"
			targets={(mailboxes.data ?? []).map((mailbox) => ({ id: mailbox.id, label: mailbox.address }))}
		/>
	);
}
