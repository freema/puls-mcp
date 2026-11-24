/**
 * Veřejný klíč Upgates pro ověření `signature_v2`. Produkčně se fetchuje z
 * `https://files.upgates.com/addons/signature/api.signature.pub.key` a cachuje
 * v paměti procesu. Pro E2E / testy jde přebít env `UPGATES_SIGNATURE_PUBKEY`
 * (PEM přímo, nebo base64-zakódovaný PEM — řeší newline v env proměnných).
 */
const UPGATES_PUBKEY_URL =
  'https://files.upgates.com/addons/signature/api.signature.pub.key';

let cachedKey: string | null = null;

/** Rozbalí PEM z env: buď přímo `-----BEGIN…`, nebo base64 takového PEM. */
function decodePemFromEnv(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) return decoded;
  } catch {
    // spadne níž
  }
  throw new Error('UPGATES_SIGNATURE_PUBKEY není validní PEM ani base64 PEM');
}

export async function getUpgatesPublicKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const override = process.env.UPGATES_SIGNATURE_PUBKEY?.trim();
  if (override) {
    cachedKey = decodePemFromEnv(override);
    return cachedKey;
  }

  const res = await fetch(UPGATES_PUBKEY_URL);
  if (!res.ok) {
    throw new Error(
      `Nepodařilo se stáhnout Upgates veřejný klíč (HTTP ${res.status})`
    );
  }
  cachedKey = (await res.text()).trim();
  return cachedKey;
}

/** @internal Reset cache — pouze testy. */
export function resetUpgatesPublicKeyCache(): void {
  cachedKey = null;
}
