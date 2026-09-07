import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Checkbox, Input } from "@/client/components/ui";
import { Choice } from "@/client/components/app/choice";
import { Modal } from "@/client/components/app/modal";
import {
  Card,
  Empty,
  Field,
  Machine,
  Tag,
} from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api, ApiError } from "@/client/lib/api";
import { fullDate } from "@/client/lib/format";
import { useMailboxes } from "@/client/lib/queries";
import { useCreate, useList, useRemove } from "@/client/lib/queries/crud";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/webhooks")({
  component: Webhooks,
});

const EVENTS = ["message.received", "message.sent", "message.bounced"] as const;

type Webhook = {
  id: string;
  mailboxId: string;
  url: string;
  events: string[];
  enabled: boolean;
  consecutiveFailures: number;
  secret?: string;
};

type Delivery = {
  id: string;
  event: string;
  status: string;
  attempt: number;
  responseStatus: number | null;
  errorSnippet: string | null;
  durationMs: number | null;
  createdAt: string;
};

function Webhooks() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const hooks = useList<Webhook>(qk.webhooks, "/api/webhooks");
  const mailboxes = useMailboxes();
  const create = useCreate<Record<string, unknown>, Webhook>(
    qk.webhooks,
    "/api/webhooks",
  );
  const remove = useRemove(qk.webhooks, (id) => `/api/webhooks/${id}`);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display text-base">Webhooks</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            Pogmail POSTs to your endpoint when mail arrives, signed with{" "}
            <Machine>X-Pogmail-Signature</Machine>. Failures retry with a
            growing delay, and an endpoint that fails twenty times running is
            switched off.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!mailboxes.data?.length}
        >
          <Plus className="size-3.5" />
          New webhook
        </Button>
      </header>

      {hooks.data?.length ? (
        <Card>
          <ul className="divide-y divide-seam">
            {hooks.data.map((hook) => (
              <li key={hook.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Machine className="min-w-0 flex-1 truncate text-sm">
                    {hook.url}
                  </Machine>

                  {hook.events.map((event) => (
                    <Tag key={event} tone="accent">
                      <span className="machine">{event}</span>
                    </Tag>
                  ))}
                  {!hook.enabled ? <Tag tone="fail">Off</Tag> : null}
                  {hook.consecutiveFailures > 0 ? (
                    <Tag tone="wait">{hook.consecutiveFailures} failing</Tag>
                  ) : null}

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await api.post(`/api/webhooks/${hook.id}/test`);
                        toast.ok("Test event sent");
                      } catch (error) {
                        toast.fail(
                          "Test failed",
                          error instanceof ApiError ? error.message : undefined,
                        );
                      }
                    }}
                  >
                    <Send className="size-3.5" />
                    Test
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setInspecting(inspecting === hook.id ? null : hook.id)
                    }
                  >
                    Deliveries
                  </Button>

                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete webhook"
                    className="hover:text-fail"
                    onClick={() =>
                      remove.mutate(hook.id, {
                        onSuccess: () => toast.ok("Webhook deleted"),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                {inspecting === hook.id ? (
                  <Deliveries webhookId={hook.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Empty
          title="No webhooks"
          body="Point one at your service to get a POST whenever mail arrives."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New webhook">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate(
              {
                mailboxId: String(form.get("mailboxId")),
                url: String(form.get("url")),
                events: form.getAll("events").map(String),
              },
              {
                onSuccess: (hook) => {
                  setSecret(hook.secret ?? null);
                  setOpen(false);
                },
                onError: (error) =>
                  toast.fail(
                    "Could not create the webhook",
                    error instanceof ApiError ? error.message : undefined,
                  ),
              },
            );
          }}
        >
          <Field label="Mailbox">
            <Choice
              name="mailboxId"
              required
              className="machine"
              options={(mailboxes.data ?? []).map((mailbox) => ({
                value: mailbox.id,
                label: mailbox.address,
              }))}
            />
          </Field>

          <Field label="Endpoint" hint="Must be HTTPS.">
            <Input
              name="url"
              type="url"
              required
              placeholder="https://example.com/hooks/mail"
              className="machine"
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="field-label">Events</legend>
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="events"
                  value={event}
                  defaultChecked={event === "message.received"}
                />
                <span className="machine text-xs">{event}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create webhook</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Copy the signing secret"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Verify it against the <Machine>X-Pogmail-Signature</Machine> header,
            which is
            <Machine> sha256=HMAC(secret, body)</Machine>.
          </p>
          <code className="block rounded-panel border border-seam bg-recess p-3 text-xs break-all">
            {secret}
          </code>
          <div className="flex justify-end">
            <Button onClick={() => setSecret(null)}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Deliveries({ webhookId }: { webhookId: string }) {
  const toast = useToast();
  const deliveries = useList<Delivery>(
    qk.deliveries(webhookId),
    `/api/webhooks/${webhookId}/deliveries`,
  );

  if (!deliveries.data?.length) {
    return <p className="text-xs text-ink-3">No deliveries yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-panel border border-seam">
      <table className="w-full text-left text-xs">
        <thead className="bg-recess">
          <tr>
            <th className="field-label px-3 py-2">When</th>
            <th className="field-label px-3 py-2">Event</th>
            <th className="field-label px-3 py-2">Result</th>
            <th className="field-label px-3 py-2">Took</th>
            <th className="field-label px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-seam">
          {deliveries.data.map((delivery) => (
            <tr key={delivery.id}>
              <td className="machine px-3 py-1.5">
                {fullDate(delivery.createdAt)}
              </td>
              <td className="machine px-3 py-1.5">{delivery.event}</td>
              <td className="px-3 py-1.5">
                <Tag tone={delivery.status === "delivered" ? "ok" : "fail"}>
                  {delivery.responseStatus ?? delivery.status}
                </Tag>
                {delivery.errorSnippet ? (
                  <span className="ml-2 text-ink-3">
                    {delivery.errorSnippet.slice(0, 60)}
                  </span>
                ) : null}
              </td>
              <td className="machine px-3 py-1.5 tabular-nums">
                {delivery.durationMs ? `${delivery.durationMs} ms` : "—"}
              </td>
              <td className="px-3 py-1.5 text-right">
                {delivery.status !== "delivered" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.post(
                        `/api/webhooks/${webhookId}/deliveries/${delivery.id}/retry`,
                      );
                      await deliveries.refetch();
                      toast.ok("Retried");
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
