import { beforeEach, describe, expect, it } from 'vitest';
import { maskEmail } from '~/lib/auth/otp-guard.server';
import { verifyTurnstile } from '~/lib/auth/turnstile.server';
import { resetConfigForTests } from '~/lib/config';

beforeEach(() => {
  // getConfig() vyžaduje DATABASE_URL + REDIS_URL — v testu je nastavíme na placeholder.
  process.env.DATABASE_URL = 'postgres://test';
  process.env.REDIS_URL = 'redis://test';
  process.env.NODE_ENV = 'test';
  delete process.env.TURNSTILE_SECRET_KEY;
  resetConfigForTests();
});

describe('maskEmail', () => {
  it('maskuje lokální část, ponechá doménu', () => {
    expect(maskEmail('alice.smith@example.com')).toBe('al***@example.com');
    expect(maskEmail('ab@x.cz')).toBe('ab***@x.cz');
  });

  it('na nesmysl bez zavináče vrací ***', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('verifyTurnstile (bez nakonfigurovaného secret klíče)', () => {
  it('přeskakuje ověření (vrací ok) v dev/E2E, ať se nic nerozbije', async () => {
    expect(await verifyTurnstile(null)).toEqual({ ok: true });
    expect(await verifyTurnstile('any-token')).toEqual({ ok: true });
  });
});
