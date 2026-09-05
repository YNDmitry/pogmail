import { createFileRoute } from "@tanstack/react-router";
import { Empty } from "@/client/components/app/primitives";

export const Route = createFileRoute("/_app/mail/$folder/")({
	component: () => (
		/* The reader pane owns its full height, so its placeholder sits in the
		   middle of the pane rather than at the top of it. */
		<div className="grid h-full place-items-center">
			<Empty title="Nothing open" body="Pick a message on the left to read it here." />
		</div>
	),
});
