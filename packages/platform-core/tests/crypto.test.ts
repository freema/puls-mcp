import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from '../src/crypto.js';

const ENV_KEY = 'CREDENTIALS_ENC_KEY';
const TEST_KEY = 'test-credentials-enc-key-0123456789';

describe('platform-core crypto (AES-256-GCM credential envelope)', () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = TEST_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('round-trips a plaintext secret', () => {
    const plain = 'upgates-api-key-super-secret';
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('produces the enc:v1: envelope and never leaks plaintext', () => {
    const plain = 'mock-api-key';
    const enc = encryptSecret(plain);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain(plain);
    expect(isEncrypted(enc)).toBe(true);
  });

  it('uses a fresh IV so the same plaintext encrypts to different ciphertext', () => {
    const plain = 'same-input';
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it('is idempotent: encrypting an already-encrypted value is a no-op', () => {
    const enc = encryptSecret('secret');
    expect(encryptSecret(enc)).toBe(enc);
  });

  it('decrypt is plaintext-tolerant for un-enveloped values (legacy/seed compat)', () => {
    expect(decryptSecret('plain-seed-value')).toBe('plain-seed-value');
    expect(decryptSecret('')).toBe('');
  });

  it('isEncrypted is false for plain and nullish values', () => {
    expect(isEncrypted('plain')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('round-trips unicode and empty string', () => {
    for (const v of ['', 'žluťoučký kůň 🐎', 'a:b/c+d=']) {
      expect(decryptSecret(encryptSecret(v))).toBe(v);
    }
  });

  it('fails to decrypt when the auth tag/ciphertext is tampered (GCM integrity)', () => {
    const enc = encryptSecret('integrity-protected');
    const tampered =
      enc.slice(0, -2) + (enc.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('fails to decrypt with a different key (web & mcp must share CREDENTIALS_ENC_KEY)', () => {
    const enc = encryptSecret('cross-service-secret');
    process.env[ENV_KEY] = 'a-totally-different-enc-key-987654321';
    expect(() => decryptSecret(enc)).toThrow();
  });
});
