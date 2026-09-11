import { Checkbox, Input, Switch } from "@/client/components/ui";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./button";
import { Choice } from "./choice";
import { Modal } from "./modal";
import { Card, Empty, Field, Machine, Tag } from "./primitives";
import { useToast } from "./toast-host";
import { useCreate, useList, useRemove, useUpdate } from "@/client/lib/queries/crud";
import { cn } from "@/client/lib/utils";
import { qk } from "@/client/lib/queries/keys";

export type RuleScope = "domain" | "mailbox";

export type RuleCondition = {
	field: "to" | "from" | "subject" | "any_header";
	operator: "equals" | "contains" | "starts_with" | "ends_with" | "regex";
	value: string;
	header?: string;
};

/** Rows are added and removed mid-list, so each needs an identity of its own. */
type DraftCondition = RuleCondition & { key: string };

const newCondition = (): DraftCondition => ({
	key: crypto.randomUUID(),
	field: "from",
	operator: "contains",
	value: "",
});

export type Rule = {
	id: string;
	scope: RuleScope;
	domainId: string | null;
	mailboxId: string | null;
	name: string;
	enabled: boolean;
	priority: number;
	conditions: RuleCondition[];
	matchAll: boolean;
	action: string;
	actionTarget: string | null;
	rejectReason: string | null;
	stopProcessing: boolean;
	matchCount: number;
};

/**
 * The two rule scopes are different engines, and the wording follows that: domain
 * rules decide whether mail is accepted at all, mailbox rules decide where accepted
 * mail is filed. Mixing the vocabulary is what makes routing confusing.
 */
const COPY = {
	domain: {
		title: "Delivery rules",
		blurb:
			"Evaluated while the sender is still connected. Rejections run first, then real mailboxes, then catch-alls — so a catch-all can never swallow mail addressed to a real mailbox.",
		actions: [
			{ value: "reject", label: "Reject the message" },
			{ value: "forward", label: "Forward elsewhere" },
			{ value: "store", label: "Deliver to a mailbox" },
		],
		empty: "No delivery rules. Mail is accepted for known addresses and rejected otherwise.",
		modalHint: "Checked while the sender is still connected, before the mail is accepted.",
	},
	mailbox: {
		title: "Filters",
		blurb: "Applied after mail is accepted, to decide where it is filed.",
		actions: [
			{ value: "move", label: "Move to a folder" },
			{ value: "spam", label: "Mark as spam" },
			{ value: "trash", label: "Move to trash" },
		],
		empty: "No filters yet. New mail goes straight to the inbox.",
		modalHint: "Applied to mail that has already been accepted, to decide where it is filed.",
	},
} as const;

const FIELDS = [
	{ value: "from", label: "Sender" },
	{ value: "to", label: "Recipient" },
	{ value: "subject", label: "Subject" },
	{ value: "any_header", label: "Any header" },
] as const;

const OPERATORS = [
	{ value: "contains", label: "contains" },
	{ value: "equals", label: "is exactly" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
	{ value: "regex", label: "matches regex" },
] as const;

/** A value field says what shape of answer it wants, so the hint costs no row. */
const PLACEHOLDERS: Record<RuleCondition["field"], string> = {
	from: "@example.com",
	to: "sales@",
	subject: "invoice",
	any_header: "X-Spam: yes",
};

/**
 * The rule in the words the list uses. Reading a rule back is how an operator
 * catches an inverted condition before it starts rejecting mail.
 */
function describeRule({
	matchAll,
	conditions,
	action,
	actions,
}: {
	matchAll: boolean;
	conditions: DraftCondition[];
	action: string;
	actions: readonly { value: string; label: string }[];
}): string {
	const filled = conditions.filter((condition) => condition.value.trim());
	const parts = filled.map((condition) => {
		const field = FIELDS.find((entry) => entry.value === condition.field)?.label.toLowerCase();
		const operator = OPERATORS.find((entry) => entry.value === condition.operator)?.label;
		return `${field} ${operator} "${condition.value.trim()}"`;
	});

	const then = actions.find((entry) => entry.value === action)?.label.toLowerCase() ?? action;
	if (parts.length === 0) return `Add a condition, then this rule will ${then}.`;

	const joined = parts.join(matchAll ? " and " : " or ");
	return `When ${joined}, ${then}.`;
}

export function RuleEditor({
	scope,
	owners,
	ownerLabel,
	targets,
	targetLabel,
}: {
	scope: RuleScope;
	/** Domains for the domain scope, mailboxes for the mailbox scope. */
	owners: { id: string; label: string }[];
	ownerLabel: string;
	/** Forward addresses are free text; folders come from a list. */
	targets?: { id: string; label: string; ownerId?: string }[];
	targetLabel?: string;
}) {
	const toast = useToast();
	const copy = COPY[scope];
	const key = qk.rules({ scope });

	const [open, setOpen] = useState(false);
	const [conditions, setConditions] = useState<DraftCondition[]>([newCondition()]);
	const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
	const [action, setAction] = useState(copy.actions[0].value as string);
	const [matchAll, setMatchAll] = useState(true);

	const rules = useList<Rule>(key, "/api/routing-rules", { scope });
	const create = useCreate<Record<string, unknown>, Rule>(key, "/api/routing-rules");
	const update = useUpdate<Record<string, unknown>, Rule>(key, (id) => `/api/routing-rules/${id}`);
	const remove = useRemove(key, (id) => `/api/routing-rules/${id}`);

	return (
		<div className="space-y-5">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="display text-base">{copy.title}</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">{copy.blurb}</p>
				</div>
				<Button size="sm" onClick={() => { setOwnerId(owners[0]?.id ?? ""); setOpen(true); }} disabled={owners.length === 0}>
					<Plus className="size-3.5" />
					New rule
				</Button>
			</header>

			{rules.data?.length ? (
				<Card>
					<ul className="divide-y divide-seam">
						{rules.data.map((rule) => (
							<li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
								<Switch
									checked={rule.enabled}
									aria-label={`Enable ${rule.name}`}
									onCheckedChange={() =>
										update.mutate({ id: rule.id, input: { enabled: !rule.enabled } })
									}
								/>

								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-ink">{rule.name}</p>
									<p className="text-xs text-ink-2">
										{rule.matchAll ? "All of" : "Any of"}{" "}
										{rule.conditions.map((condition, index) => (
											<span key={`${condition.field}:${condition.operator}:${condition.value}`}>
												{index > 0 ? ", " : ""}
												{FIELDS.find((f) => f.value === condition.field)?.label.toLowerCase()}{" "}
												{OPERATORS.find((o) => o.value === condition.operator)?.label}{" "}
												<Machine className="text-xs">{condition.value}</Machine>
											</span>
										))}
									</p>
								</div>

								<Tag tone={rule.action === "reject" ? "fail" : "accent"}>{rule.action}</Tag>
								{rule.actionTarget ? <Machine className="text-xs">{rule.actionTarget}</Machine> : null}

								<span className="machine w-12 text-right text-xs text-ink-3 tabular-nums">
									{rule.matchCount}
								</span>

								<Button
									size="icon"
									variant="ghost"
									aria-label={`Delete ${rule.name}`}
									className="hover:text-fail"
									onClick={() => remove.mutate(rule.id, { onSuccess: () => toast.ok("Rule deleted") })}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
				</Card>
			) : (
				<Empty title="No rules" body={copy.empty} />
			)}

			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title="New rule"
				description={copy.modalHint}
				className="sm:max-w-2xl"
			>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);

						create.mutate(
							{
								scope,
								...(scope === "domain"
									? { domainId: String(form.get("owner")) }
									: { mailboxId: String(form.get("owner")) }),
								name: String(form.get("name")),
								conditions: conditions.filter((condition) => condition.value.trim()),
								matchAll,
								action,
								actionTarget: String(form.get("actionTarget") ?? "") || null,
								rejectReason: String(form.get("rejectReason") ?? "") || null,
								priority: Number(form.get("priority") ?? 0),
								stopProcessing: form.get("stopProcessing") === "on",
							},
							{
								onSuccess: () => {
									toast.ok("Rule created");
									setOpen(false);
									setConditions([newCondition()]);
								},
								onError: (error) => toast.fail("Could not create the rule", String(error)),
							},
						);
					}}
				>
					{/* Two short answers, so they share a line instead of two. */}
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name">
							<Input name="name" required maxLength={120} placeholder="Block marketing mail" />
						</Field>

						<Field label={ownerLabel}>
							<Choice
								name="owner"
								required
								value={ownerId}
								onChange={setOwnerId}
								options={owners.map((owner) => ({ value: owner.id, label: owner.label }))}
							/>
						</Field>
					</div>

					{/*
					 * A rule is one sentence — when these things are true, do that — so the
					 * two halves are two panels on the same surface rather than a fieldset
					 * with a legend floating in its border.
					 */}
					<section className="pogpin-shell-panel-alt space-y-3 rounded-lg p-3">
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<span className="font-medium text-foreground">When</span>
							<Choice
								value={matchAll ? "all" : "any"}
								onChange={(next) => setMatchAll(next === "all")}
								aria-label="How conditions combine"
								size="sm"
								className="w-auto"
								options={[
									{ value: "all", label: "all" },
									{ value: "any", label: "any" },
								]}
							/>
							<span className="text-muted-foreground">of these match:</span>
						</div>

						{conditions.map((condition, index) => (
							<div
								key={condition.key}
								className="grid gap-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)_auto] sm:items-center"
							>
								<Choice
									value={condition.field}
									aria-label="Field"
									options={FIELDS.map((field) => ({ value: field.value, label: field.label }))}
									onChange={(next) =>
										setConditions((current) =>
											current.map((entry, position) =>
												position === index
													? { ...entry, field: next as RuleCondition["field"] }
													: entry,
											),
										)
									}
								/>

								<Choice
									value={condition.operator}
									aria-label="Operator"
									options={OPERATORS.map((operator) => ({
										value: operator.value,
										label: operator.label,
									}))}
									onChange={(next) =>
										setConditions((current) =>
											current.map((entry, position) =>
												position === index
													? { ...entry, operator: next as RuleCondition["operator"] }
													: entry,
											),
										)
									}
								/>

								<Input
									value={condition.value}
									aria-label="Value"
									required={index === 0}
									placeholder={PLACEHOLDERS[condition.field]}
									className="machine text-xs"
									onChange={(event) =>
										setConditions((current) =>
											current.map((entry, position) =>
												position === index ? { ...entry, value: event.target.value } : entry,
											),
										)
									}
								/>

								{/* The slot is always there, so removing a row never re-flows the
								    ones above it. */}
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label="Remove condition"
									className={cn("justify-self-end", conditions.length === 1 && "invisible")}
									disabled={conditions.length === 1}
									onClick={() =>
										setConditions((current) => current.filter((_, position) => position !== index))
									}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}

						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="text-muted-foreground"
							onClick={() => setConditions((current) => [...current, newCondition()])}
						>
							<Plus className="size-3.5" />
							Add condition
						</Button>
					</section>

					<section className="pogpin-shell-panel-alt space-y-3 rounded-lg p-3">
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<span className="font-medium text-foreground">Then</span>
							<Choice
								value={action}
								onChange={setAction}
								aria-label="What the rule does"
								size="sm"
								className="w-auto"
								options={copy.actions}
							/>
						</div>

						{action === "forward" ? (
							<Field
								label="Forward to"
								hint="Must be a verified destination address on your Cloudflare account."
							>
								<Input name="actionTarget" type="email" required className="machine" />
							</Field>
						) : null}

						{action === "reject" ? (
							<Field label="Rejection message" hint="Sent back to the sender.">
								<Input name="rejectReason" maxLength={300} placeholder="Not accepted here." />
							</Field>
						) : null}

						{action === "move" || action === "store" ? (
							<Field label={targetLabel ?? "Target"}>
								<Choice
									name="actionTarget"
									required
									options={(targets ?? []).filter((target) => !target.ownerId || target.ownerId === ownerId).map((target) => ({
										value: target.id,
										label: target.label,
									}))}
								/>
							</Field>
						) : null}
					</section>

					<div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
						<Field label="Priority" hint="Higher runs first.">
							<Input name="priority" type="number" defaultValue={0} />
						</Field>

						{/* Aligned to the field beside it rather than to its hint, which is
						    what left the checkbox floating a line low. */}
						<label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm sm:mt-6">
							<Checkbox name="stopProcessing" className="mt-0.5" />
							<span>
								Stop after this rule
								<span className="mt-0.5 block text-xs text-muted-foreground">
									Rules further down are skipped once this one matches.
								</span>
							</span>
						</label>
					</div>

					{/*
					 * The rule read back in the same words the list will use, so a mistake
					 * is caught here rather than in the routing log.
					 */}
					<p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
						{describeRule({ matchAll, conditions, action, actions: copy.actions })}
					</p>

					<div className="sticky bottom-0 flex justify-end gap-2 bg-background pt-2">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">Create rule</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
