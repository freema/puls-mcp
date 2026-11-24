import { expect, test } from '@playwright/test';
import { getShopByPlatformAccount } from '../helpers/db';
import {
  buildInstallPayload,
  postInstall,
  uniqueUpgatesToken,
} from '../helpers/upgates';

test.describe('POST /api/upgates/install', () => {
  test('valid signed payload creates an Upgates shop with encrypted credentials', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const token = uniqueUpgatesToken('inst');

    const res = await postInstall(request, buildInstallPayload({ token }));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ error: false });

    const shop = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(shop).not.toBeNull();
    expect(shop!.status).toBe('ACTIVE');
    expect(shop!.tierId).toBe('trial');
    // admin_email se spáruje přes mock /owner endpoint.
    expect(shop!.adminEmail).toBe('owner@demo-upgates.cz');
    // apiKey NIKDY plaintext — uložen v šifrované obálce enc:v1:….
    expect(shop!.platformApiKey).toMatch(/^enc:v1:/);
    expect(shop!.platformApiKey).not.toContain('mock-api-key');
  });

  test('invalid signature is rejected and no shop is created', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const token = uniqueUpgatesToken('badsig');

    const payload = buildInstallPayload({ token });
    // Rozbij podpis (zůstává validní base64, ale neověří se).
    payload.signature_v2 = `AAAA${payload.signature_v2.slice(4)}`;

    const res = await postInstall(request, payload);
    // Upgates kontrakt: vždy HTTP 200, chyba se nese v `error` flagu.
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ error: true });

    expect(await getShopByPlatformAccount(dbUrl, 'upgates', token)).toBeNull();
  });

  test('re-activation of the same token is idempotent (no second trial)', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const token = uniqueUpgatesToken('idem');

    const first = await postInstall(request, buildInstallPayload({ token }));
    expect(await first.json()).toMatchObject({ error: false });
    const shop1 = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(shop1).not.toBeNull();

    const second = await postInstall(request, buildInstallPayload({ token }));
    expect(await second.json()).toMatchObject({ error: false });
    const shop2 = await getShopByPlatformAccount(dbUrl, 'upgates', token);

    // Stejný shop (unique index na (platform, platform_account_id)), pořád trial.
    expect(shop2!.id).toBe(shop1!.id);
    expect(shop2!.tierId).toBe('trial');
  });
});
