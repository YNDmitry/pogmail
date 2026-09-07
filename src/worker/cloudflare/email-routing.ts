import type { CloudflareClient } from "./client";

export type EmailRoutingSettings = {
  enabled: boolean;
  status: string;
  name: string;
};

export type RoutingRuleAction = {
  type: "worker" | "forward" | "drop";
  value?: string[];
};
export type RoutingRuleMatcher = {
  type: "literal" | "all";
  field?: "to";
  value?: string;
};

export type EmailRoutingRule = {
  tag: string;
  name: string;
  enabled: boolean;
  matchers: RoutingRuleMatcher[];
  actions: RoutingRuleAction[];
  priority: number;
};

export function getRoutingSettings(
  cf: CloudflareClient,
  zoneId: string,
): Promise<EmailRoutingSettings> {
  return cf.get<EmailRoutingSettings>(`/zones/${zoneId}/email/routing`);
}

export function enableRouting(
  cf: CloudflareClient,
  zoneId: string,
): Promise<EmailRoutingSettings> {
  return cf.post<EmailRoutingSettings>(
    `/zones/${zoneId}/email/routing/enable`,
    {},
  );
}

export function disableRouting(
  cf: CloudflareClient,
  zoneId: string,
): Promise<EmailRoutingSettings> {
  return cf.post<EmailRoutingSettings>(
    `/zones/${zoneId}/email/routing/disable`,
    {},
  );
}

/** The MX/TXT records Email Routing needs; Cloudflare tells us what they should be. */
export function getRoutingDnsPlan(
  cf: CloudflareClient,
  zoneId: string,
): Promise<
  {
    type: string;
    name: string;
    content: string;
    priority?: number;
    required: boolean;
  }[]
> {
  return cf.get(`/zones/${zoneId}/email/routing/dns`);
}

export function listRoutingRules(
  cf: CloudflareClient,
  zoneId: string,
): Promise<EmailRoutingRule[]> {
  return cf.get<EmailRoutingRule[]>(
    `/zones/${zoneId}/email/routing/rules?per_page=500`,
  );
}

/**
 * Points one address at our Worker. Cloudflare addresses it by literal name, so the
 * deployment keeps the fixed `pogmail` Worker name.
 */
export function createWorkerRule(
  cf: CloudflareClient,
  zoneId: string,
  address: string,
  workerName: string,
): Promise<EmailRoutingRule> {
  return cf.post<EmailRoutingRule>(`/zones/${zoneId}/email/routing/rules`, {
    name: `pogmail:${address}`,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: address }],
    actions: [{ type: "worker", value: [workerName] }],
  });
}

/** Catch-all so unknown local parts still reach the Worker's routing engine. */
export function setCatchAllToWorker(
  cf: CloudflareClient,
  zoneId: string,
  workerName: string,
): Promise<EmailRoutingRule> {
  return cf.put<EmailRoutingRule>(
    `/zones/${zoneId}/email/routing/rules/catch_all`,
    {
      name: "pogmail:catch-all",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [workerName] }],
    },
  );
}

export function deleteRoutingRule(
  cf: CloudflareClient,
  zoneId: string,
  tag: string,
): Promise<unknown> {
  return cf.delete(`/zones/${zoneId}/email/routing/rules/${tag}`);
}
