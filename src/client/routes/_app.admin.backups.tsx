import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Play, Trash2, Undo2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/app/button";
import { Input, Skeleton, Switch } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Modal } from "@/client/components/app/modal";
import { Card, Empty, Field, Machine, Tag } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api } from "@/client/lib/api";
import { bytes, fullDate } from "@/client/lib/format";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/backups")({ component: Backups });

type Backup = {
	id: string;
	status: "queued" | "running" | "completed" | "failed";
	trigger: "manual" | "scheduled";
	filename: string | null;
	sizeBytes: number | null;
	error: string | null;
	createdAt: string;
	completedAt: string | null;
};

type Settings = {
	enabled: boolean;
	scheduleType: "daily" | "weekly" | "monthly";
	scheduleValue: number | null;
	retentionEnabled: boolean;
	retentionDays: number;
};

const TONE = { completed: "ok", failed: "fail", running: "wait", queued: "neutral" } as const;

/** The cron in `wrangler.jsonc`; the schedule only decides which nights count. */
const RUN_TIME = "03:17 UTC";

/** `isBackupDue` compares against `getUTCDay()`, where the week starts on Sunday. */
const WEEKDAYS = [
	{ value: "0", label: "Sunday" },
	{ value: "1", label: "Monday" },
	{ value: "2", label: "Tuesday" },
	{ value: "3", label: "Wednesday" },
	{ value: "4", label: "Thursday" },
	{ value: "5", label: "Friday" },
	{ value: "6", label: "Saturday" },
];

function Backups() {
	const toast = useToast();
	const client = useQueryClient();
	const [restoring, setRestoring] = useState<string | null>(null);

	const data = useQuery({
		queryKey: qk.backups,
		queryFn: () => api.get<{ items: Backup[]; settings: Settings | null }>("/api/backups"),
		// A running export finishes in the background; refresh while one is in flight.
		refetchInterval: (query) =>
			query.state.data?.items.some((item) => item.status === "running" || item.status === "queued")
				? 4000
				: false,
	});

	return (
		<div className="space-y-6">
			<Modal open={restoring !== null} onClose={() => setRestoring(null)} title="Restore backup">
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						if (String(form.get("confirm")) !== "restore") {
							toast.fail("Type restore to confirm");
							return;
						}

						try {
							const result = await api.post<{ restored: number }>(
								`/api/backups/${restoring}/restore`,
								{ confirm: "restore" },
							);
							toast.ok(`Restored ${result.restored} rows`, "Reload to see the restored data.");
							setRestoring(null);
						} catch (error) {
							toast.fail("Restore failed", String(error));
						}
					}}
				>
					<p className="text-sm text-ink-2">
						Rows from the backup overwrite the current ones with the same id. Anything created since
						the backup was taken stays where it is. This cannot be undone.
					</p>

					<Field label="Type restore to confirm">
						<Input name="confirm" required autoComplete="off" />
					</Field>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="secondary" onClick={() => setRestoring(null)}>
							Cancel
						</Button>
						<Button type="submit" className="bg-fail text-primary-foreground hover:bg-fail/90">
							Restore
						</Button>
					</div>
				</form>
			</Modal>

			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="display text-base">Backups</h2>
					<p className="mt-1 max-w-prose text-sm text-ink-2">
						A full dump of the database as newline-delimited JSON, kept in R2. Attachments stay where
						they are.
					</p>
				</div>
				<Button
					size="sm"
					onClick={async () => {
						await api.post("/api/backups");
						await client.invalidateQueries({ queryKey: qk.backups });
						toast.ok("Backup started");
					}}
				>
					<Play className="size-3.5" />
					Back up now
				</Button>
			</header>

			{data.isPending ? (
				<Card className="space-y-3 p-5">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-2/3" />
				</Card>
			) : (
				<ScheduleCard settings={data.data?.settings ?? null} />
			)}

			<Card>
				{data.data?.items.length ? (
					<ul className="divide-y divide-border">
						{data.data.items.map((backup) => (
							<li key={backup.id} className="px-4 py-3">
								<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
									<Tag tone={TONE[backup.status]}>{backup.status}</Tag>

									<Machine className="min-w-0 flex-1 truncate text-xs">
										{backup.filename ?? backup.id}
									</Machine>

									{/* What a machine wrote down about the run, in the order it is read:
									    what triggered it, how big it came out, and when. */}
									<Tag tone="neutral" glyph={false}>
										{backup.trigger}
									</Tag>
									<Machine className="w-20 shrink-0 text-right text-xs">
										{backup.sizeBytes ? bytes(backup.sizeBytes) : "—"}
									</Machine>
									<Machine className="shrink-0 text-xs">{fullDate(backup.createdAt)}</Machine>

									<div className="flex shrink-0 items-center gap-1">
										{backup.status === "completed" ? (
											<>
												<Button asChild size="sm" variant="ghost">
													{/* A download is a real navigation, not a fetch. */}
													<a href={`/api/backups/${backup.id}/download`}>
														<Download className="size-3.5" />
														Download
													</a>
												</Button>
												<Button size="sm" variant="ghost" onClick={() => setRestoring(backup.id)}>
													<Undo2 className="size-3.5" />
													Restore
												</Button>
											</>
										) : null}

										<Button
											size="icon"
											variant="ghost"
											aria-label="Delete backup"
											className="hover:text-fail"
											onClick={async () => {
												await api.delete(`/api/backups/${backup.id}`);
												await client.invalidateQueries({ queryKey: qk.backups });
												toast.ok("Backup deleted");
											}}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</div>
								</div>

								{backup.error ? (
									<p className="mt-2 rounded-md bg-fail-soft px-3 py-2 text-xs text-fail">
										{backup.error}
									</p>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<Empty title="No backups yet" body="Run one now, or turn on a schedule above." />
				)}
			</Card>
		</div>
	);
}

/**
 * The schedule reads as two decisions, not five boxes: whether backups run on
 * their own, and whether old ones are thrown away. Each detail field appears
 * under the switch that gives it meaning — a day of the week is nonsense while
 * the schedule is daily, and a retention window is nonsense while nothing is
 * being deleted.
 */
function ScheduleCard({ settings }: { settings: Settings | null }) {
	const toast = useToast();
	const client = useQueryClient();

	const [enabled, setEnabled] = useState(settings?.enabled ?? false);
	const [scheduleType, setScheduleType] = useState(settings?.scheduleType ?? "daily");
	const [weekday, setWeekday] = useState(String(settings?.scheduleValue ?? 0));
	const [monthDay, setMonthDay] = useState(String(settings?.scheduleValue ?? 1));
	const [retentionEnabled, setRetentionEnabled] = useState(settings?.retentionEnabled ?? false);
	const [retentionDays, setRetentionDays] = useState(String(settings?.retentionDays ?? 30));
	const [saving, setSaving] = useState(false);

	// The two day fields are separate state, because switching weekly ⇄ monthly
	// must not carry a weekday over into a day of the month.
	const scheduleValue =
		scheduleType === "weekly" ? Number(weekday) : scheduleType === "monthly" ? Number(monthDay) : null;

	async function save() {
		setSaving(true);
		try {
			await api.put("/api/backups/settings", {
				enabled,
				scheduleType,
				scheduleValue,
				retentionEnabled,
				retentionDays: Number(retentionDays) || 1,
			});
			await client.invalidateQueries({ queryKey: qk.backups });
			toast.ok("Schedule saved");
		} catch (error) {
			toast.fail("Could not save the schedule", String(error));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<form
				className="divide-y divide-border"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<SettingRow
					label="Run automatically"
					hint={
						enabled
							? describeSchedule(scheduleType, scheduleValue)
							: `Nothing runs on its own; a backup only starts when you press Back up now.`
					}
					control={<Switch checked={enabled} onCheckedChange={setEnabled} />}
				>
					{enabled ? (
						<div className="grid gap-3 sm:grid-cols-2">
							<Field label="How often">
								<Choice
									value={scheduleType}
									onChange={(next) => setScheduleType(next as Settings["scheduleType"])}
									aria-label="How often"
									options={[
										{ value: "daily", label: "Daily" },
										{ value: "weekly", label: "Weekly" },
										{ value: "monthly", label: "Monthly" },
									]}
								/>
							</Field>

							{scheduleType === "weekly" ? (
								<Field label="Day of the week">
									<Choice
										value={weekday}
										onChange={setWeekday}
										aria-label="Day of the week"
										options={WEEKDAYS}
									/>
								</Field>
							) : null}

							{scheduleType === "monthly" ? (
								<Field label="Day of the month" hint="1–28, so every month has one.">
									<Input
										value={monthDay}
										onChange={(event) => setMonthDay(event.target.value)}
										type="number"
										min={1}
										max={28}
									/>
								</Field>
							) : null}
						</div>
					) : null}
				</SettingRow>

				<SettingRow
					label="Delete old backups"
					hint={
						retentionEnabled
							? `Anything older than ${retentionDays || "0"} days is removed after the next run.`
							: "Every backup is kept until you delete it by hand."
					}
					control={<Switch checked={retentionEnabled} onCheckedChange={setRetentionEnabled} />}
				>
					{retentionEnabled ? (
						<Field label="Keep for" className="max-w-40">
							<div className="flex items-center gap-2">
								<Input
									value={retentionDays}
									onChange={(event) => setRetentionDays(event.target.value)}
									type="number"
									min={1}
									aria-label="Days to keep backups for"
								/>
								<span className="shrink-0 text-sm text-muted-foreground">days</span>
							</div>
						</Field>
					) : null}
				</SettingRow>

				<div className="flex items-center justify-end gap-3 px-4 py-3">
					<Button type="submit" variant="secondary" disabled={saving}>
						{saving ? "Saving…" : "Save schedule"}
					</Button>
				</div>
			</form>
		</Card>
	);
}

/** A switch, what it does, and the fields it turns on — in that reading order. */
function SettingRow({
	label,
	hint,
	control,
	children,
}: {
	label: string;
	hint: string;
	control: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="px-4 py-4">
			<label className="flex items-start gap-3">
				<span className="mt-0.5 shrink-0">{control}</span>
				<span className="min-w-0">
					<span className="block text-sm font-medium text-foreground">{label}</span>
					<span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
				</span>
			</label>

			{children ? <div className="mt-4 pl-11">{children}</div> : null}
		</div>
	);
}

function describeSchedule(type: Settings["scheduleType"], value: number | null): string {
	if (type === "weekly") {
		const day = WEEKDAYS.find((entry) => entry.value === String(value ?? 0))?.label ?? "Sunday";
		return `Every ${day} at ${RUN_TIME}.`;
	}
	if (type === "monthly") {
		return `On day ${value ?? 1} of each month, at ${RUN_TIME}.`;
	}
	return `Every night at ${RUN_TIME}.`;
}
