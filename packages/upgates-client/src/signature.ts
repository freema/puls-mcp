import { verify as cryptoVerify } from 'node:crypto';

/**
 * Ověření aktivačních callbacků doplňku Upgates (install/opening/uninstall/
 * versioning). Upgates podepisuje `signature_v2` privátním klíčem; my ověřujeme
 * veřejným (`api.signature.pub.key`, OpenSSL RSA-SHA256). Podepsaná data jsou
 * vybraná pole payloadu spojená středníkem + náš `signature_token`.
 *
 * Pořadí polí MUSÍ odpovídat tomu, jak je skládá Upgates pro daný endpoint —
 * viz `buildSignatureData` u jednotlivých handlerů (task 03).
 */
export function buildSignatureData(parts: Array<string | number>): string {
  return parts.map((p) => String(p)).join(';');
}

/**
 * Ověří RSA-SHA256 podpis. `signatureV2` je base64. Vrací false (nikdy
 * nevyhazuje) na jakoukoliv chybu — neplatný klíč, špatný base64, kratší buffer.
 */
export function verifyUpgatesSignature(
  data: string,
  signatureV2: string,
  publicKeyPem: string
): boolean {
  if (!data || !signatureV2 || !publicKeyPem) return false;
  try {
    return cryptoVerify(
      'RSA-SHA256',
      Buffer.from(data, 'utf8'),
      publicKeyPem,
      Buffer.from(signatureV2, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * TTL kontrola `time` z payloadu (sekundy nebo ms epoch). Brání replay útoku
 * starým podepsaným callbackem. Default tolerance ±10 min (Upgates posílá GMT
 * timestamp aktivace; necháme rezervu na hodinový posun a latenci).
 */
export function isSignatureTimeFresh(
  time: string | number | undefined,
  nowMs: number,
  toleranceMs = 10 * 60 * 1000
): boolean {
  if (time == null) return false;
  const raw = typeof time === 'number' ? time : Number(String(time).trim());
  let tsMs: number;
  if (Number.isFinite(raw) && raw > 0) {
    // < 10^12 → epoch sekundy, jinak ms.
    tsMs = raw < 1e12 ? raw * 1000 : raw;
  } else {
    const parsed = Date.parse(String(time));
    if (Number.isNaN(parsed)) return false;
    tsMs = parsed;
  }
  return Math.abs(nowMs - tsMs) <= toleranceMs;
}
