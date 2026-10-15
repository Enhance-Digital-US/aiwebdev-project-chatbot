import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { verifyAccessUser, type AccessConfig } from "./access";

const config: AccessConfig = {
  teamDomain: "https://example.cloudflareaccess.com",
  audience: "test-aud",
};

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function sign(claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? config.teamDomain)
    .setAudience(opts.aud ?? config.audience)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);
}

describe("verifyAccessUser", () => {
  it("returns the email claim for a valid token", async () => {
    const token = await sign({ email: "a@example.com", sub: "uuid-1" });
    await expect(verifyAccessUser(token, config, jwks)).resolves.toBe("a@example.com");
  });

  it("falls back to sub when there is no email", async () => {
    const token = await sign({ sub: "uuid-1" });
    await expect(verifyAccessUser(token, config, jwks)).resolves.toBe("uuid-1");
  });

  it("returns null for service tokens (no email, empty sub)", async () => {
    const token = await sign({ sub: "", common_name: "svc.access" });
    await expect(verifyAccessUser(token, config, jwks)).resolves.toBeNull();
  });

  it("tolerates a trailing slash on the configured team domain", async () => {
    const token = await sign({ email: "a@example.com" });
    const withSlash = { ...config, teamDomain: `${config.teamDomain}/` };
    await expect(verifyAccessUser(token, withSlash, jwks)).resolves.toBe("a@example.com");
  });

  it("rejects a token for another Access application", async () => {
    const token = await sign({ email: "a@example.com" }, { aud: "other-aud" });
    await expect(verifyAccessUser(token, config, jwks)).rejects.toThrow();
  });

  it("rejects a token from another team", async () => {
    const token = await sign({ email: "a@example.com" }, { iss: "https://evil.cloudflareaccess.com" });
    await expect(verifyAccessUser(token, config, jwks)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await sign({ email: "a@example.com" }, { exp: "-1m" });
    await expect(verifyAccessUser(token, config, jwks)).rejects.toThrow();
  });

  it("rejects a forged token signed with a different key", async () => {
    const { privateKey: otherKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({ email: "a@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(config.teamDomain)
      .setAudience(config.audience)
      .setExpirationTime("5m")
      .sign(otherKey);
    await expect(verifyAccessUser(token, config, jwks)).rejects.toThrow();
  });
});
