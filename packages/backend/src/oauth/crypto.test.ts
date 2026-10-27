import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));

describe("token encryption", () => {
  it("round-trips a value", async () => {
    const sealed = await encrypt(key, "secret-token", "issue-tracker:access:alice");
    expect(sealed).not.toContain("secret-token");
    expect(await decrypt(key, sealed, "issue-tracker:access:alice")).toBe("secret-token");
  });

  it("seals the same value differently each time (random IV)", async () => {
    expect(await encrypt(key, "x", "c")).not.toBe(await encrypt(key, "x", "c"));
  });

  it("refuses another context, so one user's token can't be read as another's", async () => {
    const sealed = await encrypt(key, "secret-token", "issue-tracker:access:alice");
    await expect(decrypt(key, sealed, "issue-tracker:access:bob")).rejects.toThrow();
  });

  it("refuses another key or an altered value", async () => {
    const sealed = await encrypt(key, "secret-token", "c");
    await expect(decrypt(otherKey, sealed, "c")).rejects.toThrow();
    const bytes = Uint8Array.from(atob(sealed), (ch) => ch.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    await expect(decrypt(key, btoa(String.fromCharCode(...bytes)), "c")).rejects.toThrow();
  });

  it("fails closed without a usable key", async () => {
    await expect(encrypt(undefined, "x", "c")).rejects.toThrow("TOKEN_ENCRYPTION_KEY is not set");
    await expect(encrypt(btoa("too short"), "x", "c")).rejects.toThrow("32 bytes");
  });
});
