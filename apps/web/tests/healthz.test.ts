import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHealthChecks } from '~/lib/health';

vi.mock('~/lib/db', () => ({
  healthDbPing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/lib/redis', () => ({
  healthRedisPing: vi.fn().mockResolvedValue(undefined),
}));

describe('runHealthChecks', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when db and redis are up', async () => {
    const body = await runHealthChecks();
    expect(body).toEqual({ ok: true, db: 'up', redis: 'up' });
  });
});
