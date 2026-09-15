import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "@/worker/index";

describe("Android app association", () => {
  it("serves the configured Credential Manager association on every host", async () => {
    const response = await worker.fetch(
      new Request("https://mail.customer-example.test/.well-known/assetlinks.json"),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: env.ANDROID_APP_PACKAGE,
          sha256_cert_fingerprints: env.ANDROID_APP_SHA256_CERT_FINGERPRINTS.split(","),
        },
      },
    ]);
  });

  it("handles HEAD without returning a body", async () => {
    const response = await worker.fetch(
      new Request("https://mail.customer-example.test/.well-known/assetlinks.json", {
        method: "HEAD",
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
