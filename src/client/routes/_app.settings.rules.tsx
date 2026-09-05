import { createFileRoute } from "@tanstack/react-router";
import { RuleEditor } from "@/client/components/app/rule-editor";
import { Empty } from "@/client/components/app/primitives";
import { useFolders, useMailboxes } from "@/client/lib/queries";

export const Route = createFileRoute("/_app/settings/rules")({ component: Rules });

function Rules() {
	const mailboxes = useMailboxes();
	const folders = useFolders();

	if (mailboxes.data && mailboxes.data.length === 0) {
		return <Empty title="No mailboxes" body="Filters apply to a mailbox, so you need one first." />;
	}

	return (
		<RuleEditor
			scope="mailbox"
			ownerLabel="Mailbox"
			owners={(mailboxes.data ?? []).map((mailbox) => ({ id: mailbox.id, label: mailbox.address }))}
			targetLabel="Folder"
			targets={(folders.data ?? []).map((folder) => ({ id: folder.id, label: folder.name }))}
		/>
	);
}
