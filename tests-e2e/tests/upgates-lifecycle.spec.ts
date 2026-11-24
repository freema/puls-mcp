import { expect, test } from '@playwright/test';
import { deleteShopById, getShopByPlatformAccount } from '../helpers/db';
import {
  buildInstallPayload,
  buildLifecyclePayload,
  postInstall,
  postUninstall,
  postVersioning,
  uniqueUpgatesToken,
} from '../helpers/upgates';

test.describe('Upgates add-on lifecycle', () => {
  test('install → uninstall → reactivate same row keeps tier, then versioning', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const token = uniqueUpgatesToken('life');

    // 1) Install → ACTIVE trial.
    await postInstall(request, buildInstallPayload({ token }));
    let shop = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(shop!.status).toBe('ACTIVE');
    expect(shop!.tierId).toBe('trial');

    // 2) Uninstall (signed) → UNINSTALLED + credentials zneplatněny.
    const uninstall = await postUninstall(
      request,
      buildLifecyclePayload({ token })
    );
    expect(uninstall.status()).toBe(200);
    expect(await uninstall.json()).toMatchObject({ error: false });
    shop = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(shop!.status).toBe('UNINSTALLED');
    expect(shop!.platformApiKey).toBeNull();

    // 3) Re-aktivace STÁLE EXISTUJÍCÍHO řádku → reaktivuje (ACTIVE), tier se
    //    nemění (zůstává trial s původním trialEndsAt — žádný nový trial) a
    //    credentials se obnoví (zase šifrované).
    const reinstall = await postInstall(request, buildInstallPayload({ token }));
    expect(await reinstall.json()).toMatchObject({ error: false });
    shop = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(shop!.status).toBe('ACTIVE');
    expect(shop!.tierId).toBe('trial');
    expect(shop!.platformApiKey).toMatch(/^enc:v1:/);

    // 4) Versioning → 200 {error:false}.
    const versioning = await postVersioning(
      request,
      buildLifecyclePayload({ token, version: '2' })
    );
    expect(versioning.status()).toBe(200);
    expect(await versioning.json()).toMatchObject({ error: false });
  });

  test('fresh install after the shop row was purged gets starter, not a second trial', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const token = uniqueUpgatesToken('antifree');

    // Install → trial, pak smaž řádek (simulace post-grace cleanup cronu).
    await postInstall(request, buildInstallPayload({ token }));
    const first = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(first!.tierId).toBe('trial');
    await deleteShopById(dbUrl, first!.id);

    // Čerstvý install stejného účtu → tier_assignments si pamatuje vyčerpaný
    // trial → anti-freeride přiřadí 'starter' (reason: reinstall_no_trial).
    const reinstall = await postInstall(request, buildInstallPayload({ token }));
    expect(await reinstall.json()).toMatchObject({ error: false });
    const second = await getShopByPlatformAccount(dbUrl, 'upgates', token);
    expect(second!.status).toBe('ACTIVE');
    expect(second!.tierId).toBe('starter');
  });

  test('uninstall of an unknown token is a no-op (idempotent)', async ({
    request,
  }) => {
    const token = uniqueUpgatesToken('life-unknown');
    const res = await postUninstall(request, buildLifecyclePayload({ token }));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ error: false });
  });
});
