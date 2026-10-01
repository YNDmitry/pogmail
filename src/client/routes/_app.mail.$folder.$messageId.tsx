import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  Archive,
  ArrowLeft,
  CalendarPlus,
  ChevronDown,
  CornerUpLeft,
  Download,
  MailWarning,
  Paperclip,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Choice } from "@/client/components/app/choice";
import { EmailFrame } from "@/client/components/app/email-frame";
import { Empty, Machine, Tag, type Tone } from "@/client/components/app/primitives";
import { Modal } from "@/client/components/app/modal";
import { ReplyBox } from "@/client/components/app/reply-box";
import { useToast } from "@/client/components/app/toast-host";
import { Loader } from "@/client/components/motion/loader";
import { api } from "@/client/lib/api";
import { bytes, conversationKey, fullDate, initials, replyAddress, senderLabel, shortDate } from "@/client/lib/format";
import {
  useBulkPatch,
  useDeleteMessage,
  useFolders,
  useMailboxes,
  useMessage,
  useMoveMessages,
  usePatchMessage,
  useSession,
  useThread,
} from "@/client/lib/queries";
import { canSend } from "@/shared/contract/permissions";
import { cn } from "@/client/lib/utils";
import { htmlHasContent } from "@/client/lib/mail-html";
import type {
  Attachment,
  MessageDetail,
  MessageStatus,
  MessageSummary,
} from "@/shared/contract/mail";

export const Route = createFileRoute("/_app/mail/$folder/$messageId")({
  component: Reader,
});

/*
 * Each option resolves to a real moment rather than an offset dressed up as one.
 * "Tomorrow morning" used to be `+20h`, which from breakfast meant tonight and
 * from midnight meant tomorrow evening — the label was a guess about when the
 * reader happened to be reading.
 */
const SNOOZE_OPTIONS: { label: string; at: () => Date }[] = [
  {
    label: "In 3 hours",
    at: () => new Date(Date.now() + 3 * 3_600_000),
  },
  {
    label: "Tomorrow",
    at: () => {
      const when = new Date();
      when.setDate(when.getDate() + 1);
      when.setHours(9, 0, 0, 0);
      return when;
    },
  },
  {
    label: "Next week",
    at: () => {
      const when = new Date();
      // The next Monday, not seven days from whenever this was read.
      when.setDate(when.getDate() + ((8 - when.getDay()) % 7 || 7));
      when.setHours(9, 0, 0, 0);
      return when;
    },
  },
];

const SNOOZE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function deliverySummary(delivery: NonNullable<MessageDetail["delivery"]>): {
  label: string;
  tone: Tone;
} {
  const lifecycle = delivery.recipients.flatMap((recipient) =>
    recipient.lifecycle ? [recipient.lifecycle] : [],
  );
  if (
    lifecycle.some((event) =>
      ["bounced", "failed", "rejected", "complained"].includes(event.type),
    )
  ) {
    return {
      label: lifecycle.some((event) => event.type === "complained")
        ? "Complaint received"
        : "Delivery issue",
      tone: "fail",
    };
  }
  if (lifecycle.some((event) => event.type === "deferred"))
    return { label: "Delivery deferred", tone: "wait" };
  if (
    delivery.recipients.length > 0 &&
    lifecycle.filter((event) => event.type === "delivered").length ===
      delivery.recipients.length
  ) {
    return { label: "Delivered", tone: "ok" };
  }
  if (delivery.status === "failed")
    return { label: "Delivery failed", tone: "fail" };
  if (delivery.status === "sent") return { label: "Accepted", tone: "ok" };
  return { label: "Sending", tone: "wait" };
}

function Reader() {
  const { folder, messageId } = useParams({
    from: "/_app/mail/$folder/$messageId",
  });
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/mail/$folder" });
  const toast = useToast();

  const session = useSession();
  const mailboxes = useMailboxes();
  const folders = useFolders();
  const conversations = session.data?.mailLayout === "conversations" && folder !== "drafts";

  const [purging, setPurging] = useState(false);

  const message = useMessage(messageId);
  const thread = useThread(messageId);
  const history = thread.data?.filter((item) => item.status !== "draft");
  const latestIncoming = conversations ? history?.findLast((item) => item.direction === "inbound" && item.status !== "draft") : undefined;
  const correspondent = useMessage(latestIncoming && latestIncoming.id !== messageId ? latestIncoming.id : undefined);
  const replySource = latestIncoming && latestIncoming.id !== messageId ? correspondent.data : message.data;
  const [previousReply, setPreviousReply] = useState<MessageDetail | null>(null);
  if (thread.data && replySource && previousReply !== replySource) setPreviousReply(replySource);
  const patch = usePatchMessage();
  const bulk = useBulkPatch();
  const moveMessages = useMoveMessages(conversations);
  const remove = useDeleteMessage();

  // Opening a message is what marks it read; there is no separate action for it.
  // The ref is what keeps this to one write per message: the optimistic patch
  // updates the cache, which re-runs the effect with `read` already true.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    const mail = message.data;
    if (conversations || !mail || mail.read || marked.current === mail.id) return;

    marked.current = mail.id;
    patch.mutate({ id: mail.id, patch: { read: true } });
  }, [message.data, patch, conversations]);

  const canReply = canSend(
    (mailboxes.data ?? []).find(
      (mailbox) => mailbox.id === message.data?.mailboxId,
    )?.permission ?? "read_only",
  );

  const hasThread = (history?.length ?? 0) > 1;
  const conversationList = useRef<HTMLOListElement>(null);
  const focused = useRef<string | null>(null);
  useLayoutEffect(() => {
    const mail = message.data;
    if (!conversations || !mail || !thread.data || focused.current === mail.id) return;
    const focusId = mail.id === history?.at(-1)?.id ? (history.find((item) => !item.read)?.id ?? mail.id) : mail.id;
    const list = conversationList.current;
    const viewport = list?.closest<HTMLElement>("[data-reader-scroll]");
    const target = list?.querySelector<HTMLElement>(`[data-thread-message="${CSS.escape(focusId)}"]`);
    if (!viewport || !target) return;
    const toolbar = viewport.querySelector<HTMLElement>("[data-conversation-toolbar]");
    viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (toolbar?.offsetHeight ?? 0) - 16;
    focused.current = mail.id;
  }, [conversations, message.data, thread.data, history]);

  if (message.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Loader />
      </div>
    );
  }

  if (message.isError && !message.data) {
    return <Empty title="Could not load the message" body={message.error.message}
      action={<Button variant="secondary" onClick={() => void message.refetch()}>Retry</Button>} />;
  }
  if (!message.data) return null;
  const mail = message.data;
  // Keep the editor mounted while a newly arrived correspondent's details load.
  const replyTarget = replySource ?? (previousReply?.mailboxId === mail.mailboxId && previousReply.threadId === mail.threadId ? previousReply : undefined);
  const mailboxAddress = mailboxes.data?.find((entry) => entry.id === mail.mailboxId)?.address;
  const recipient = replyTarget ? replyAddress(replyTarget, mailboxAddress) : "";
  const actionRows = conversations ? (thread.data ?? [mail]).filter((item) => item.status === mail.status && item.folderId === mail.folderId) : [mail];
  const starred = actionRows.some((item) => item.starred);

  function updateRows(change: { starred?: boolean; snoozedUntil?: number }, onSuccess?: () => void) {
    if (actionRows.length > 1) bulk.mutate({ ids: actionRows.map((item) => item.id), ...change }, { onSuccess });
    else if (actionRows[0]) patch.mutate({ id: actionRows[0].id, patch: change }, { onSuccess });
  }
  const title = conversations
    ? (history?.[0]?.subject ?? mail.subject)
    : mail.subject;
  const outboundSummary = mail.delivery ? deliverySummary(mail.delivery) : null;

  function move(status: MessageStatus, done: string) {
    void moveMessages([mail], { status, folderId: null }, done)
      .then(() => navigate({ to: "/mail/$folder", params: { folder } })).catch(() => {});
  }

  function moveToFolder(folderId: string) {
    const destination = folderId === "inbox" ? "inbox" : folderId;
    void moveMessages([mail], { status: "received", folderId: folderId === "inbox" ? null : folderId },
      folderId === "inbox" ? "Moved to inbox" : "Moved to folder")
      .then(() => navigate({ to: "/mail/$folder", params: { folder: destination } })).catch(() => {});
  }

  const moveTargets = (folders.data ?? []).filter(
    (entry) => entry.mailboxId === mail.mailboxId,
  );

  return (
    <article className="mx-auto flex min-w-0 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Link
        to="/mail/$folder"
        params={{ folder }}
        search={(previous) => previous}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground lg:hidden"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to messages
      </Link>

      <header className={conversations ? "contents" : "space-y-4"}>
        <div data-conversation-toolbar={conversations ? "" : undefined}
          className={cn("flex flex-wrap items-start justify-between gap-3", conversations && "sticky top-0 z-10 bg-[var(--pogpin-shell-panel)] py-2")}>
          <h1 title={title || "(no subject)"} className={cn("display min-w-0 flex-1 break-words text-xl leading-snug text-ink", conversations && "line-clamp-2")}>
            {title || "(no subject)"}
          </h1>

          <div className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto sm:shrink-0">
            <IconAction
              label={starred ? "Remove star" : "Add star"}
              pressed={starred}
              disabled={conversations && !thread.data}
              onClick={() => updateRows({ starred: !starred })}
            >
              <Star
                className={cn("size-4", starred && "fill-wait text-wait")}
              />
            </IconAction>

            <IconAction
              label="Archive"
              onClick={() => move("archived", "Archived")}
            >
              <Archive className="size-4" />
            </IconAction>

            <IconAction
              label="Report as spam"
              onClick={() => move("spam", "Moved to spam")}
            >
              <MailWarning className="size-4" />
            </IconAction>

            {folder === "trash" ? (
              // The one irreversible action in the reader, so it asks first.
              <IconAction
                label="Delete permanently"
                destructive
                onClick={() => setPurging(true)}
              >
                <Trash2 className="size-4" />
              </IconAction>
            ) : (
              <IconAction
                label="Move to trash"
                onClick={() => move("trash", "Moved to trash")}
              >
                <Trash2 className="size-4" />
              </IconAction>
            )}
            {moveTargets.length > 0 ? (
              <Choice
                placeholder="Move to…"
                aria-label={conversations ? "Move this conversation to a folder" : "Move this message to a folder"}
                size="sm"
                className="w-auto min-w-32"
                options={[
                  { value: "inbox", label: "Inbox" },
                  ...moveTargets.map((entry) => ({
                    value: entry.id,
                    label: entry.name,
                  })),
                ]}
                onChange={moveToFolder}
              />
            ) : null}
          </div>
        </div>

        {conversations && hasThread ? (
          <p className="text-xs text-muted-foreground">
            {history?.length} messages · oldest first
          </p>
        ) : null}

        {mail.delivery ? (
          <div className="flex flex-wrap items-center gap-2 rounded-panel border border-seam bg-recess px-3 py-2 text-xs">
            <Tag tone={outboundSummary?.tone}>{outboundSummary?.label}</Tag>
            {mail.delivery.attempts > 1 ? (
              <span className="text-ink-3">
                Attempt {mail.delivery.attempts}
              </span>
            ) : null}
            {mail.delivery.lastError ? (
              <span
                className="min-w-0 truncate text-fail"
                title={mail.delivery.lastError}
              >
                {mail.delivery.lastError}
              </span>
            ) : null}
            {mail.delivery.recipients.length > 0 ? (
              <span
                className="text-ink-3"
                title={mail.delivery.recipients
                  .map((entry) => `${entry.recipient}: ${entry.status}`)
                  .join("\n")}
              >
                {
                  mail.delivery.recipients.filter(
                    (entry) => entry.status === "sent",
                  ).length
                }
                /{mail.delivery.recipients.length} recipients accepted
                {mail.delivery.recipients.some((entry) => entry.lifecycle)
                  ? ` · ${mail.delivery.recipients.filter((entry) => entry.lifecycle?.type === "delivered").length} delivered`
                  : ""}
              </span>
            ) : null}
            {mail.delivery.status === "failed" ? (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                onClick={async () => {
                  try {
                    await api.post(`/api/messages/${mail.id}/retry`, {});
                    await message.refetch();
                    toast.ok("Delivery retry queued");
                  } catch (error) {
                    toast.fail("Could not retry delivery", String(error));
                  }
                }}
              >
                Retry delivery
              </Button>
            ) : null}
          </div>
        ) : null}

        {!conversations ? <div className="flex flex-wrap items-start gap-3 border-b border-seam pb-4">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-recess text-xs font-semibold text-ink-2"
          >
            {initials(senderLabel(mail.fromName, mail.fromAddress))}
          </span>

          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-ink">
              {senderLabel(mail.fromName, mail.fromAddress)}
            </p>
            <p className="truncate">
              <Machine>{mail.fromAddress}</Machine>
            </p>
            <p className="mt-1 text-xs text-ink-3">
              to{" "}
              <Machine className="break-all text-ink-3">
                {mail.toAddresses.map((entry) => entry.address).join(", ")}
              </Machine>
            </p>
          </div>

          <time
            dateTime={mail.receivedAt}
            className="machine w-full shrink-0 pl-12 text-xs text-ink-3 sm:w-auto sm:pl-0"
          >
            {fullDate(mail.receivedAt)}
          </time>
        </div> : null}

        <div className="flex flex-wrap items-center gap-2">
          {/* Read as a conversation, the reply box at the end of the thread is
					    the reply; a second button for it would be a second answer to the
					    same question. */}
          {conversations || !canReply ? null : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigate({
                  to: "/compose",
                  search: { replyTo: mail.id },
                })
              }
            >
              <CornerUpLeft className="size-3.5" />
              Reply
            </Button>
          )}

          {/*
           * A message that names a time is usually the only record of it. The
           * event keeps the mailbox and the message it came from, so the two stay
           * findable from each other.
           */}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const start = new Date();
              start.setMinutes(0, 0, 0);
              start.setHours(start.getHours() + 1);

              try {
                await api.post("/api/calendar/events", {
                  title: mail.subject || "(no subject)",
                  description: (mail.bodyText ?? "").slice(0, 2000),
                  mailboxId: mail.mailboxId,
                  messageId: mail.id,
                  startsAt: start.getTime(),
                  endsAt: start.getTime() + 3_600_000,
                });
                toast.ok(
                  "Added to the calendar",
                  "An hour from now; open it to set the time.",
                );
              } catch (error) {
                toast.fail("Could not add the event", String(error));
              }
            }}
          >
            <CalendarPlus className="size-3.5" />
            Add to calendar
          </Button>

          <Choice aria-label="Snooze" placeholder="Snooze…" value="" size="sm" className="w-32"
            disabled={conversations && !thread.data}
            options={SNOOZE_OPTIONS.map((option, index) => ({ value: String(index), label: option.label }))}
            onChange={(value) => {
              const when = SNOOZE_OPTIONS[Number(value)]?.at();
              if (!when) return;
              updateRows({ snoozedUntil: when.getTime() }, () =>
                toast.ok("Snoozed", `Back in your inbox on ${SNOOZE_FORMAT.format(when)}.`));
            }} />
        </div>
      </header>

      {thread.isError ? <div role="alert" className="space-y-2 text-sm">
        <p>Could not load the conversation</p>
        <Button variant="secondary" size="sm" onClick={() => void thread.refetch()}>Retry conversation</Button>
      </div> : null}

      {!conversations && hasThread ? (
        <section aria-labelledby="thread-heading" className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="thread-heading"
              className="text-sm font-medium text-foreground"
            >
              Thread
            </h2>
            <span className="text-xs text-muted-foreground">
              {history?.length} messages · latest at top
            </span>
          </div>

          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {(history ?? []).toReversed().map((item, index) => {
              const current = item.id === mail.id;
              return (
                <li key={item.id}>
                  <Link
                    to="/mail/$folder/$messageId"
                    params={{ folder, messageId: item.id }}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      current
                        ? "selected-row"
                        : "hover:bg-[var(--pogpin-shell-fill-soft)]",
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium text-foreground">
                        {senderLabel(item.fromName, item.fromAddress)}
                      </span>
                      {index === 0 ? (
                        <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                          Latest
                        </span>
                      ) : null}
                      {current ? (
                        <span className="shrink-0 text-[0.6875rem] font-medium text-primary">
                          Open
                        </span>
                      ) : null}
                    </span>
                    <time
                      dateTime={item.receivedAt}
                      className="machine shrink-0 text-[0.6875rem] text-muted-foreground"
                    >
                      <span className="sm:hidden">{shortDate(item.receivedAt)}</span><span className="hidden sm:inline">{fullDate(item.receivedAt)}</span>
                    </time>
                    <span className="col-span-2 mt-0.5 truncate text-xs text-muted-foreground">
                      {item.snippet || "No preview"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {conversations ? (
        <ol ref={conversationList} aria-label="Conversation messages" className="divide-y divide-border" key={conversationKey(mail)}>
          {(history?.length ? history : [mail]).map((item, index, items) => (
            <ConversationMessage key={item.id} item={item} selectedId={mail.id}
              initiallyOpen={item.id === mail.id || !item.read || index === items.length - 1}
              latest={index === items.length - 1} foldQuotes={!search.q} />
          ))}
        </ol>
      ) : <MessageContents key={mail.id} mail={mail} />}

      <Modal
        open={purging}
        onClose={() => setPurging(false)}
        title="Delete this message for good?"
        description="It leaves the trash, the search index and the storage bucket. This cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPurging(false)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            className="bg-fail text-primary-foreground hover:bg-fail/90"
            onClick={() =>
              remove.mutate(mail.id, {
                onSuccess: () => {
                  setPurging(false);
                  toast.ok("Deleted permanently");
                  void navigate({ to: "/mail/$folder", params: { folder } });
                },
              })
            }
          >
            <Trash2 className="size-3.5" />
            Delete for good
          </Button>
        </div>
      </Modal>

      {/*
       * A shared mailbox can be readable without being sendable-from, and the
       * old reply paths let someone write the whole answer before the server
       * refused it. The box is only offered where the answer can actually go.
       */}
      {conversations && thread.data && mail.status !== "draft" ? (
        canReply && replyTarget && recipient ? (
          <ReplyBox
            key={conversationKey(mail)}
            mailboxId={mail.mailboxId}
            to={recipient}
            subject={replyTarget.subject}
            inReplyTo={replyTarget.messageId}
            threadId={mail.threadId}
            replyToId={replyTarget.id}
          />
        ) : canReply && !replyTarget && correspondent.isPending ? <Loader /> : !canReply ? (
          <p className="rounded-xl border border-border bg-[var(--pogpin-shell-panel-alt)] px-3 py-2 text-xs text-muted-foreground">
            You can read this mailbox, but not send from it — ask its owner for
            send access to reply here.
          </p>
        ) : correspondent.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Could not load the reply recipient</p>
            <Button variant="secondary" size="sm" onClick={() => void correspondent.refetch()}>Retry reply</Button>
          </div>
        ) : null
      ) : null}
    </article>
  );
}

/** Email HTML stays in the script-disabled sandbox, never in the app DOM. */
function MessageBody({
  html, text, messageId, attachments, foldQuotes = false, compact = false,
}: {
  html: string | null;
  text: string | null;
  messageId: string;
  attachments: Attachment[];
  foldQuotes?: boolean;
  compact?: boolean;
}) {
  const [showQuotes, setShowQuotes] = useState(false);
  // ponytail: common quote markers only; keep the original toggle, add a parser if false positives matter.
  const quoteStart = text?.search(/\n(?:>|On .+ wrote:)/) ?? -1;
  const htmlQuoteStart = html?.search(/<(?:blockquote\b|[^>]+\bclass\s*=\s*["'][^"']*\b(?:gmail_quote|yahoo_quoted)\b)/i) ?? -1;
  const htmlPrefix = html?.slice(0, htmlQuoteStart).replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "") ?? "";
  const hasQuotes = foldQuotes && (html
    ? htmlQuoteStart >= 0 && htmlHasContent(htmlPrefix)
    : quoteStart >= 0 && Boolean(text?.slice(0, quoteStart).trim()));
  const hidden = hasQuotes && !showQuotes;
  const body = html ? attachments.reduce((result, attachment) => {
    if (attachment.disposition !== "inline" || !attachment.contentId) return result;
    return result.replaceAll(
      `cid:${attachment.contentId}`,
      `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`,
    );
  }, html) : null;

  return (
    <div className="space-y-2">
      {body ? <EmailFrame title="Message body" minHeight={compact ? 80 : undefined}
        html={hidden ? `${body}<style>blockquote,.gmail_quote,.yahoo_quoted{display:none!important}</style>` : body}
        className={compact ? undefined : "rounded-panel border border-seam"} /> : (
        <div dir="auto" className="text-base leading-relaxed whitespace-pre-wrap break-words text-ink sm:text-sm">
          {hidden ? text?.slice(0, quoteStart).trimEnd() : text ?? <span className="text-ink-3">This message has no body.</span>}
        </div>
      )}
      {hasQuotes ? <Button variant="ghost" size="sm" aria-expanded={showQuotes} onClick={() => setShowQuotes(!showQuotes)}>
        {showQuotes ? "Hide quoted text" : "Show quoted text"}
      </Button> : null}
    </div>
  );
}

function IconAction({
  label,
  children,
  onClick,
  pressed,
  destructive,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-ink-2",
        destructive ? "hover:bg-fail-soft hover:text-fail" : "hover:text-ink",
      )}
    >
      {children}
    </Button>
  );
}

function ConversationMessage({ item, initiallyOpen, latest, selectedId, foldQuotes }: {
  item: MessageSummary; initiallyOpen: boolean; latest: boolean; selectedId: string; foldQuotes: boolean;
}) {
  const [view, setView] = useState({ selectedId, expanded: initiallyOpen });
  if (view.selectedId !== selectedId) setView({ selectedId, expanded: view.expanded || item.id === selectedId });
  const expanded = view.expanded;
  const panelId = useId();
  const message = useMessage(expanded ? item.id : undefined);
  const patch = usePatchMessage();
  const marked = useRef(false);
  useEffect(() => {
    if (!expanded || !message.data || message.data.read || marked.current) return;
    marked.current = true;
    patch.mutate({ id: item.id, patch: { read: true } });
  }, [expanded, message.data, item.id, patch]);
  const label = senderLabel(item.fromName, item.fromAddress);

  return (
    <li data-thread-message={item.id} className="min-w-0">
      <Button variant="ghost" aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${expanded ? "Collapse" : "Expand"} message from ${label}, ${fullDate(item.receivedAt)}`}
        onClick={() => setView({ selectedId, expanded: !expanded })}
        className="h-auto w-full min-w-0 items-start justify-start gap-3 rounded-none px-0 py-4 text-left">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-recess text-xs font-semibold text-ink-2">
          {initials(label)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cn("min-w-0 truncate text-sm text-ink", !item.read && "font-semibold")}>{label}</span>
            {latest ? <span className="text-xs text-ink-3">Latest</span> : null}
            {!item.read ? <span className="text-xs text-ink-2">Unread</span> : null}
            <time dateTime={item.receivedAt} className="machine ml-auto shrink-0 text-xs text-ink-3">
              <span className="sm:hidden">{shortDate(item.receivedAt)}</span><span className="hidden sm:inline">{fullDate(item.receivedAt)}</span>
            </time>
          </span>
          {!expanded ? <span className="mt-1 block truncate text-xs text-ink-3">{item.snippet || "No preview"}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 self-center text-ink-3 transition-transform", expanded && "rotate-180")} />
      </Button>
      <div id={panelId} hidden={!expanded} className="space-y-4 pb-5">
        {expanded ? message.data ? <>
          <p className="break-all text-xs text-ink-3">
            <Machine>{message.data.fromAddress}</Machine>{" · to "}
            <Machine>{message.data.toAddresses.map((entry) => entry.address).join(", ")}</Machine>
          </p>
          <MessageContents mail={message.data} foldQuotes={foldQuotes} compact />
        </> : message.isError ? <div role="alert" className="space-y-2 text-sm">
          <p>Could not load this message</p>
          <Button variant="secondary" size="sm" onClick={() => void message.refetch()}>Retry</Button>
        </div> : <Loader /> : null}
      </div>
    </li>
  );
}

function MessageContents({ mail, foldQuotes = false, compact = false }: { mail: MessageDetail; foldQuotes?: boolean; compact?: boolean }) {
  return <div className="space-y-4">
    {mail.attachments.length > 0 ? <section className="space-y-2">
      <h2 className="field-label">{mail.attachments.length} attachment{mail.attachments.length === 1 ? "" : "s"}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {mail.attachments.map((attachment) => <li key={attachment.id}>
          <a href={`/api/messages/${mail.id}/attachments/${attachment.id}`}
            className="flex items-center gap-2 rounded-panel border border-seam bg-panel px-3 py-2 text-sm transition-colors hover:border-primary">
            <Paperclip aria-hidden className="size-4 shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
            <Machine className="shrink-0 text-xs">{bytes(attachment.sizeBytes)}</Machine>
            <Download aria-hidden className="size-3.5 shrink-0 text-ink-3" />
          </a>
        </li>)}
      </ul>
    </section> : null}
    <MessageBody html={mail.bodyHtml} text={mail.bodyText} messageId={mail.id} attachments={mail.attachments} foldQuotes={foldQuotes} compact={compact} />
    <footer className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-ink-3">
      <span>{mail.direction === "inbound" ? "Received" : "Sent"}</span>
      <a href={`/api/mail/export/${mail.id}/eml`} className="ml-auto underline underline-offset-2 hover:text-ink-2">Download original</a>
    </footer>
  </div>;
}
