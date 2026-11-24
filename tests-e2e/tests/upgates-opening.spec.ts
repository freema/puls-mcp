import { expect, test } from '@playwright/test';
import {
  buildLifecyclePayload,
  postOpening,
  uniqueUpgatesToken,
} from '../helpers/upgates';

test.describe('POST /api/upgates/opening', () => {
  test('valid signed payload returns an iframe url to the embed page', async ({
    request,
  }) => {
    const token = uniqueUpgatesToken('open');
    const res = await postOpening(
      request,
      buildLifecyclePayload({ token, lang: 'cs' })
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('iframe');
    expect(body.url).toContain(`/embed/upgates/${token}`);
  });

  test('embed page renders the activation guide and real support contact', async ({
    request,
    page,
  }) => {
    const token = uniqueUpgatesToken('embed');
    const res = await postOpening(
      request,
      buildLifecyclePayload({ token, lang: 'cs' })
    );
    const { url } = await res.json();

    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Reálný kontakt na podporu (žádná fake data).
    await expect(page.getByText('support@example.com')).toBeVisible();
    // Tlačítko propojení AI asistenta.
    await expect(page.getByRole('link', { name: /propojit|přihlásit/i })).toBeVisible();
  });

  test('invalid signature yields 400', async ({ request }) => {
    const token = uniqueUpgatesToken('open-bad');
    const payload = buildLifecyclePayload({ token });
    payload.signature_v2 = `BBBB${payload.signature_v2.slice(4)}`;

    const res = await postOpening(request, payload);
    expect(res.status()).toBe(400);
  });
});
