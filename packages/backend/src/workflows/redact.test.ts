import { describe, expect, it } from "vitest";
import { redactLog } from "./redact";

const redact = (log: string) => redactLog(log).text;

describe("redactLog", () => {
  it("masks bearer tokens but keeps the header shape", () => {
    expect(redact("Authorization: Bearer sk-abc123def456ghi789jkl012")).toBe(
      "Authorization: Bearer [REDACTED_TOKEN]"
    );
    expect(redact("authorization: bearer abc.def.ghi")).toBe("authorization: bearer [REDACTED_TOKEN]");
  });

  it("masks JWTs outside a bearer header", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWJvYiJ9.c2lnbmF0dXJlLXNpZw";
    expect(redact(`token=${jwt} rejected`)).not.toContain("eyJ");
  });

  it("masks provider-shaped API keys", () => {
    const keys = [
      "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234",
      "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt",
      "pk-lf-1234567890abcdef1234",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "xoxb-1234567890-abcdefghij",
      "AKIAIOSFODNN7EXAMPLE",
      "sk_live_51HabcdefghijklmnopQRST",
    ];
    for (const key of keys) {
      const out = redact(`failed with key ${key} at startup`);
      expect(out, key).not.toContain(key);
      expect(out).toContain("failed with key");
    }
  });

  it("masks secret-looking assignments, keeping the name", () => {
    expect(redact('api_key="hunter2hunter2" region=us')).toBe('api_key="[REDACTED]" region=us');
    expect(redact("DB password: s3cr3t!")).toBe("DB password: [REDACTED]");
  });

  it("masks email addresses", () => {
    expect(redact("user bob.smith+test@example.co.uk not found")).toBe("user [REDACTED_EMAIL] not found");
  });

  it("masks IPv4 and IPv6 addresses", () => {
    expect(redact("connect ECONNREFUSED 10.0.12.7:5432")).toBe("connect ECONNREFUSED [REDACTED_IP]:5432");
    expect(redact("from 2001:db8:85a3:0:0:8a2e:370:7334")).toBe("from [REDACTED_IP]");
    expect(redact("listening on ::1")).toBe("listening on [REDACTED_IP]");
  });

  it("leaves ordinary log content alone", () => {
    const log = [
      "2026-10-26T15:07:22.952Z ERROR TypeError: Cannot read properties of undefined (reading 'id')",
      "    at handler (src/routes/chat.ts:42:17)",
      "status=500 duration=12:30:45 version 4.112.0",
    ].join("\n");
    expect(redact(log)).toBe(log);
  });

  it("counts what it masked", () => {
    expect(redactLog("a@b.io c@d.io 1.2.3.4").counts).toEqual({ email: 2, ipv4: 1 });
  });
});
