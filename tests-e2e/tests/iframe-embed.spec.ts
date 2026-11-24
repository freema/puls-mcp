import { expect, test } from '@playwright/test';
import { seedBrowserSession } from '../helpers/session';
import { seedUpgatesShop } from '../helpers/upgates-seed';

test('settings iframe embed renders authenticated content', async ({
  page,
  context,
}) => {
  const dbUrl = process.env.DATABASE_URL!;
  const base = process.env.BASE_URL_WEB!;

  const seeded = await seedUpgatesShop({
    databaseUrl: dbUrl,
    adminEmail: 'owner@example.test',
  });
  const shopId = seeded.shopId;
  expect(shopId).toBeTruthy();

  const { token } = await seedBrowserSession({
    databaseUrl: dbUrl,
    email: 'owner@example.test',
  });

  await context.addCookies([
    {
      name: 'puls_session',
      value: token,
      url: base,
      httpOnly: true,
      sameSite: 'Lax' as const,
    },
  ]);

  await page.goto(`${base}/dashboard/${shopId}`);
  await expect(page.getByText(/Vaše MCP endpoint URL/i)).toBeVisible();

  // POZOR (load/order race v plné single-worker suite): vnější dashboard stránka
  // je React Router app, která se po SSR teprve hydratuje. Ve `task e2e` běží web
  // v dev módu (Vite, NODE_ENV=development) — hydratace stahuje desítky ES modulů
  // a pod zátěží celé suite doběhne výrazně později než v izolovaném běhu. Pokud
  // `document.body.innerHTML = ''` níže proběhne DŘÍV než React dohydratuje, React
  // reconciluje proti vyprázdněnému <body> a injektovaný <iframe> z DOMu zase
  // vyhodí → `iframe[title="embed"]` zmizí a assert 30 s čeká marně. Proto před
  // manipulací s DOM počkáme, až se síťová aktivita stránky ustálí (dev module
  // graph + hydratace doběhnou).
  await page.waitForLoadState('networkidle');

  await page.evaluate(
    ({
      shopId: sid,
      baseUrl,
    }: {
      shopId: string;
      baseUrl: string;
    }) => {
      document.body.style.margin = '0';
      document.body.style.background = '#09090b';
      document.body.innerHTML = '';
      const iframe = document.createElement('iframe');
      iframe.title = 'embed';
      iframe.src = `${baseUrl}/settings/${sid}`;
      iframe.width = '900';
      iframe.height = '700';
      document.body.appendChild(iframe);
    },
    { shopId, baseUrl: base }
  );

  // Počkej, až injektovaný <iframe> existuje v DOM vnější stránky (po hydrataci
  // už ho React nesmí odstranit), pak teprve sahej dovnitř na jeho frame.
  await expect(page.locator('iframe[title="embed"]')).toBeAttached();

  const frame = page.frameLocator('iframe[title="embed"]');
  await expect(frame.getByTestId('settings-embed-root')).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame.getByTestId('open-full-dashboard')).toBeVisible();
});
