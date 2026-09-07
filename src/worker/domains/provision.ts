import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { domainRecords, domains } from "@/db/schema";
import { CloudflareClient } from "../cloudflare/client";
import {
  createWorkerRule,
  deleteRoutingRule,
  disableRouting,
  enableRouting,
  getRoutingDnsPlan,
  getRoutingSettings,
  listRoutingRules,
  setCatchAllToWorker,
} from "../cloudflare/email-routing";
import {
  createDnsRecord,
  deleteDnsRecord,
  findZoneByHostname,
  listDnsRecords,
} from "../cloudflare/zones";

/**
 * Adding a domain is a multi-step remote operation that can fail halfway. Every
 * record we create is recorded in `domain_records`, so teardown removes exactly what
 * we added and never touches DNS the user set up themselves.
 */
export async function provisionDomain(
  env: Env,
  db: Database,
  domainId: string,
): Promise<{ status: "active" | "error"; error?: string }> {
  const domain = await db
    .select()
    .from(domains)
    .where(eq(domains.id, domainId))
    .get();
  if (!domain) throw new Error(`Domain ${domainId} disappeared mid-provision`);

  const cf = CloudflareClient.fromEnv(env);

  try {
    const settings = await getRoutingSettings(cf, domain.zoneId).catch(
      () => null,
    );
    if (!settings?.enabled) await enableRouting(cf, domain.zoneId);

    // Cloudflare tells us which MX/TXT records Email Routing needs; create only
    // the ones that are missing so a re-run is idempotent.
    const plan = await getRoutingDnsPlan(cf, domain.zoneId);
    const existing = await listDnsRecords(cf, domain.zoneId);

    for (const wanted of plan) {
      if (!wanted.required) continue;
      const already = existing.some(
        (record) =>
          record.type === wanted.type &&
          record.name === wanted.name &&
          record.content === wanted.content,
      );
      if (already) continue;

      const created = await createDnsRecord(cf, domain.zoneId, {
        type: wanted.type,
        name: wanted.name,
        content: wanted.content,
        ...(wanted.priority !== undefined ? { priority: wanted.priority } : {}),
      });

      await db.insert(domainRecords).values({
        domainId: domain.id,
        cloudflareRecordId: created.id,
        type: created.type,
        name: created.name,
        content: created.content,
      });
    }

    // Unknown local parts must still reach the Worker: our own routing engine
    // decides whether to reject, forward or store them.
    await setCatchAllToWorker(cf, domain.zoneId, env.CF_EMAIL_WORKER_NAME);

    const after = await getRoutingSettings(cf, domain.zoneId);

    await db
      .update(domains)
      .set({
        status: "active",
        routingEnabled: true,
        routingStatus: after.status,
        lastError: null,
        verifiedAt: new Date(),
      })
      .where(eq(domains.id, domain.id));

    return { status: "active" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(domains)
      .set({ status: "error", lastError: message.slice(0, 500) })
      .where(eq(domains.id, domain.id));

    return { status: "error", error: message };
  }
}

/**
 * Removes everything we created on the zone. Best-effort per step: a record deleted
 * by hand in the dashboard must not block the rest of the cleanup.
 */
export async function deprovisionDomain(
  env: Env,
  db: Database,
  domainId: string,
): Promise<void> {
  const domain = await db
    .select()
    .from(domains)
    .where(eq(domains.id, domainId))
    .get();
  if (!domain) return;

  const cf = CloudflareClient.fromEnv(env);

  const rules = await listRoutingRules(cf, domain.zoneId).catch(() => []);
  for (const rule of rules) {
    if (!rule.name?.startsWith("pogmail:")) continue;
    await deleteRoutingRule(cf, domain.zoneId, rule.tag).catch(() => undefined);
  }

  const records = await db
    .select()
    .from(domainRecords)
    .where(eq(domainRecords.domainId, domain.id))
    .all();
  for (const record of records) {
    await deleteDnsRecord(cf, domain.zoneId, record.cloudflareRecordId).catch(
      () => undefined,
    );
  }

  // Only turn routing off if we were the ones who turned it on.
  if (domain.routingEnabled)
    await disableRouting(cf, domain.zoneId).catch(() => undefined);
}

/** Creates the Email Routing rule that points one mailbox address at the Worker. */
export async function provisionMailboxRule(
  env: Env,
  zoneId: string,
  address: string,
): Promise<string | null> {
  const cf = CloudflareClient.fromEnv(env);
  const rule = await createWorkerRule(
    cf,
    zoneId,
    address,
    env.CF_EMAIL_WORKER_NAME,
  );
  return rule.tag ?? null;
}

export async function removeMailboxRule(
  env: Env,
  zoneId: string,
  tag: string,
): Promise<void> {
  const cf = CloudflareClient.fromEnv(env);
  await deleteRoutingRule(cf, zoneId, tag).catch(() => undefined);
}

/** Looks up the zone that owns a hostname, so the user never types a zone id. */
export async function resolveZone(env: Env, hostname: string) {
  return findZoneByHostname(CloudflareClient.fromEnv(env), hostname);
}
