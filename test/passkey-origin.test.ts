import { describe, expect, it } from "vitest";
import { toBase64Url, verifyClientData } from "@/worker/auth/passkey";

describe("passkey origin validation", () => {
  const challenge = "challenge-for-test";
  const androidOrigin = "android:apk-key-hash:lrGDO6bNCBmlTVmgC6XRUKfTauY9FV-O9vIXC7wolzo";
  const clientData = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.get", challenge, origin: androidOrigin, crossOrigin: false }),
    ),
  );

  it("accepts an Android signing origin configured for this app", async () => {
    await expect(verifyClientData(clientData, "webauthn.get", challenge, [androidOrigin])).resolves.toBeInstanceOf(Uint8Array);
  });

  it("rejects an Android assertion from a different signing identity", async () => {
    await expect(verifyClientData(clientData, "webauthn.get", challenge, ["android:apk-key-hash:another-app"])).rejects.toMatchObject({ status: 400 });
  });
});
