/**
 * Parse CLERK_AUTHORIZED_PARTIES (comma-separated origins) into the list Clerk
 * checks the session token's `azp` claim against.
 *
 * Entries are normalized with `new URL(entry).origin`, so trailing slashes,
 * paths, and host casing don't cause silent mismatches. An invalid entry
 * throws: a misconfigured allow-list should fail loudly, not quietly turn
 * every user anonymous. Unset/empty returns [] (Clerk skips the azp check).
 */
export function parseAuthorizedParties(value: string | undefined): string[] {
  if (!value) return [];
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const { origin } = new URL(entry);
      if (origin === "null") {
        throw new Error(`CLERK_AUTHORIZED_PARTIES: "${entry}" is not an http(s) origin`);
      }
      return origin;
    });
  return [...new Set(origins)];
}
