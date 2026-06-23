/**
 * Verify the signature GitHub attaches to Copilot Extension requests.
 *
 * GitHub signs each request with an ECDSA key. The public key is rotated
 * and discovered via the GitHub Meta API. In production you should enable
 * this; in local dev it can be skipped.
 *
 * Docs: https://docs.github.com/en/copilot/building-copilot-extensions/managing-data-for-your-copilot-extension/verifying-payload-signatures
 */

import crypto from "node:crypto";

const KEYS_URL =
  "https://api.github.com/meta/public_keys/copilot_api";

let cachedKeys = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchKeys() {
  if (cachedKeys && Date.now() - cachedAt < CACHE_TTL_MS) return cachedKeys;
  const res = await fetch(KEYS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Copilot public keys: ${res.status} ${res.statusText}`
    );
  }
  const json = await res.json();
  cachedKeys = json.public_keys || [];
  cachedAt = Date.now();
  return cachedKeys;
}

/**
 * @param {string} rawBody  Raw request body (as a string, before JSON parsing)
 * @param {string} signature  Value of `Github-Public-Key-Signature` header
 * @param {string} keyId     Value of `Github-Public-Key-Identifier` header
 * @returns {Promise<boolean>}
 */
export async function verifySignature(rawBody, signature, keyId) {
  if (!rawBody || !signature || !keyId) return false;
  const keys = await fetchKeys();
  const match = keys.find((k) => k.key_identifier === keyId);
  if (!match) return false;

  const verifier = crypto.createVerify("SHA256");
  verifier.update(rawBody);
  verifier.end();

  return verifier.verify(match.key, signature, "base64");
}
