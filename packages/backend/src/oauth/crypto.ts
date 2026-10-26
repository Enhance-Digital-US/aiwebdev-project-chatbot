/**
 * AES-GCM encryption for values stored at rest (OAuth tokens) or handed to the
 * browser sealed (the PKCE state cookie). The key is TOKEN_ENCRYPTION_KEY, 32
 * random bytes in base64 (`openssl rand -base64 32`).
 *
 * `context` is authenticated but not stored: a token encrypted for one user
 * can't be decrypted as another's, nor a cookie as a token.
 */

const IV_BYTES = 12;
const keys = new Map<string, Promise<CryptoKey>>();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function importKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  let key = keys.get(secret);
  if (!key) {
    const raw = fromBase64(secret);
    if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(secret, key);
  }
  return key;
}

/** base64(iv ‖ ciphertext) */
export async function encrypt(secret: string | undefined, plaintext: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await importKey(secret),
    new TextEncoder().encode(plaintext)
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return toBase64(out);
}

/** Throws if the value was altered, or sealed with another key or context. */
export async function decrypt(secret: string | undefined, sealed: string, context: string): Promise<string> {
  const bytes = fromBase64(sealed);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES), additionalData: new TextEncoder().encode(context) },
    await importKey(secret),
    bytes.slice(IV_BYTES)
  );
  return new TextDecoder().decode(plain);
}
