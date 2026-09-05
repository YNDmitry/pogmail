import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/app/button";
import { Input, Switch } from "@/client/components/ui";
import { Card, Field } from "@/client/components/app/primitives";
import { useToast } from "@/client/components/app/toast-host";
import { api } from "@/client/lib/api";
import { useBranding } from "@/client/lib/queries";
import { qk } from "@/client/lib/queries/keys";

export const Route = createFileRoute("/_app/admin/branding")({
  component: Branding,
});

function Branding() {
  const toast = useToast();
  const client = useQueryClient();
  const branding = useBranding();

  return (
    <div className="space-y-6">
      <header>
        <h2 className="display text-base">Branding</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          The name and icon people see when they sign in.
        </p>
      </header>

      <Card className="p-5">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await api.put("/api/branding", {
              appName: String(form.get("appName")),
              allowRegistration: form.get("allowRegistration") === "on",
            });
            await client.invalidateQueries({ queryKey: qk.branding });
            toast.ok("Branding saved");
          }}
        >
          <Field label="Name">
            <Input
              name="appName"
              defaultValue={branding.data?.appName}
              required
              maxLength={60}
            />
          </Field>

          <label className="flex items-center gap-2.5 text-sm">
            <Switch
              name="allowRegistration"
              defaultChecked={branding.data?.allowRegistration}
            />
            Let anyone create an account
          </label>
          <p className="text-xs text-ink-3">
            Leave this off unless you mean it. An open mail host is an open door
            for spam.
          </p>

          <Button type="submit">Save branding</Button>
        </form>
      </Card>

      <Card className="p-5">
        <h3 className="display text-sm">Icon</h3>
        <p className="mt-1 text-sm text-ink-2">
          PNG, SVG or WebP, up to 512 KB.
        </p>

        <div className="mt-4 flex items-center gap-4">
          {branding.data?.iconUrl ? (
            <img
              src={branding.data.iconUrl}
              alt="Current icon"
              className="size-12 rounded-panel border border-seam object-cover"
            />
          ) : (
            <div className="grid size-12 place-items-center rounded-panel border border-dashed border-seam text-xs text-ink-3">
              none
            </div>
          )}

          <Input
            type="file"
            accept="image/png,image/svg+xml,image/webp,image/x-icon"
            className="h-auto py-1.5"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;

              // Sent as the raw body, so the Worker can check the type and size
              // before anything reaches the bucket.
              await fetch("/api/branding/icon", {
                method: "PUT",
                headers: { "content-type": file.type },
                body: file,
                credentials: "same-origin",
              });
              await client.invalidateQueries({ queryKey: qk.branding });
              toast.ok("Icon updated");
              event.target.value = "";
            }}
          />
        </div>
      </Card>
    </div>
  );
}
