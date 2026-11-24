import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSignatureData,
  verifyUpgatesSignature,
  isSignatureTimeFresh,
} from '../src/signature.js';
import {
  getUpgatesPublicKey,
  resetUpgatesPublicKeyCache,
} from '../src/signature-key.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function signV2(data: string): string {
  return cryptoSign('RSA-SHA256', Buffer.from(data, 'utf8'), privateKey).toString(
    'base64'
  );
}

describe('verifyUpgatesSignature', () => {
  const parts = ['eshop-token', 'apiUser', 'apiKey', 'https://x.upgates.com', '1717400000', 'sig-token'];
  const data = buildSignatureData(parts);

  it('accepts a valid signature over the exact data', () => {
    expect(verifyUpgatesSignature(data, signV2(data), publicKey)).toBe(true);
  });

  it('rejects when the data is tampered', () => {
    const sig = signV2(data);
    const tampered = buildSignatureData([...parts.slice(0, 4), '9999999999', 'sig-token']);
    expect(verifyUpgatesSignature(tampered, sig, publicKey)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const sig = signV2(data);
    const broken = `${sig.slice(0, -4)}AAAA`;
    expect(verifyUpgatesSignature(data, broken, publicKey)).toBe(false);
  });

  it('rejects empty inputs without throwing', () => {
    expect(verifyUpgatesSignature('', signV2(data), publicKey)).toBe(false);
    expect(verifyUpgatesSignature(data, '', publicKey)).toBe(false);
    expect(verifyUpgatesSignature(data, signV2(data), '')).toBe(false);
  });

  it('returns false (not throw) on garbage key', () => {
    expect(verifyUpgatesSignature(data, signV2(data), 'not-a-key')).toBe(false);
  });
});

describe('buildSignatureData', () => {
  it('joins parts with semicolons and stringifies numbers', () => {
    expect(buildSignatureData(['a', 1, 'b'])).toBe('a;1;b');
  });
});

describe('isSignatureTimeFresh', () => {
  const now = 1_717_400_000_000; // fixed ms epoch

  it('accepts epoch seconds within tolerance', () => {
    expect(isSignatureTimeFresh(1_717_400_000, now)).toBe(true);
  });

  it('accepts epoch ms within tolerance', () => {
    expect(isSignatureTimeFresh(now - 60_000, now)).toBe(true);
  });

  it('rejects a stale timestamp', () => {
    expect(isSignatureTimeFresh(1_717_400_000 - 3600, now)).toBe(false);
  });

  it('rejects missing/invalid time', () => {
    expect(isSignatureTimeFresh(undefined, now)).toBe(false);
    expect(isSignatureTimeFresh('not-a-time', now)).toBe(false);
  });
});

describe('getUpgatesPublicKey (env override)', () => {
  afterEach(() => {
    resetUpgatesPublicKeyCache();
    delete process.env.UPGATES_SIGNATURE_PUBKEY;
  });

  it('reads a raw PEM from env and caches it', async () => {
    process.env.UPGATES_SIGNATURE_PUBKEY = publicKey;
    const key = await getUpgatesPublicKey();
    expect(key).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('reads a base64-encoded PEM from env', async () => {
    process.env.UPGATES_SIGNATURE_PUBKEY = Buffer.from(publicKey).toString('base64');
    const key = await getUpgatesPublicKey();
    expect(key).toContain('-----BEGIN PUBLIC KEY-----');
  });
});
