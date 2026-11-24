import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Symetrické šifrování citlivého materiálu credentials (Upgates `apiKey`),
 * aby v DB nikdy neležel v plaintextu — tvrdý požadavek schvalování Upgates
 * („neukládat login/heslo k API v nevhodné podobě").
 *
 * Formát obálky: `enc:v1:<base64(iv|tag|ciphertext)>` (AES-256-GCM, 96-bit IV,
 * 128-bit tag). Klíč je SHA-256 z env `CREDENTIALS_ENC_KEY`. `web` (persist) i
 * `mcp` (read-path connectoru) MUSÍ sdílet stejný `CREDENTIALS_ENC_KEY`, jinak
 * dešifrování selže — proto je nastavený shodně v obou službách (compose/release).
 */
const ENVELOPE_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Dev/test fallback klíč — NIKDY se na něj nespoléhej v produkci. */
const DEV_FALLBACK_KEY = 'puls-dev-credentials-key-do-not-use-in-prod';

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY?.trim();
  const material = raw && raw.length >= 16 ? raw : DEV_FALLBACK_KEY;
  return createHash('sha256').update(material).digest();
}

/** True, pokud hodnota už je v naší šifrované obálce. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/** Zašifruje plaintext do obálky `enc:v1:…`. Idempotentní: už zašifrované vrací beze změny. */
export function encryptSecret(plain: string): string {
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ENVELOPE_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Dešifruje obálku `enc:v1:…`. **Plaintext-tolerance:** hodnota bez prefixu
 * se vrací beze změny — drží zpětnou kompatibilitu s daty zapsanými před
 * zavedením šifrování (a s e2e seedy, které píšou mock credentials naholo).
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  const buf = Buffer.from(value.slice(ENVELOPE_PREFIX.length), 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8'
  );
}
