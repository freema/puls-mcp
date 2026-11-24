/* eslint-disable no-console */
/**
 * LIVE ověření Upgates write sady proti REÁLNÉMU dev eshopu (dev eshop).
 *
 * PROČ: mock + zelené typecheck/unit/E2E NESTAČÍ — neodhalí reálné API tvary
 * (cena `price_original` vs computed `price_with_vat`, delete param `codes`, …).
 * Každá nová Upgates write feature se ověřuje tímto skriptem PŘED flipnutím
 * capability flagu na `true`.
 *
 * POUŽITÍ (z rootu repa):
 *   pnpm --filter @puls/upgates-client build
 *   node --env-file=.env packages/upgates-client/scripts/live-verify.mjs
 *
 * Vyžaduje env (v .env): UPGATES_DEV_API_LOGIN, UPGATES_DEV_API_KEY, UPGATES_DEV_API_URL.
 * Vytváří test entity (prefix PULS-VERIFY-, skryté) a na konci je VŠECHNY maže.
 * Exit code 0 = vše prošlo, 1 = aspoň jeden krok selhal.
 *
 * Import je RELATIVNÍ (`../dist/index.js`) → přenositelné na libovolném stroji
 * (resolvuje se vůči umístění tohoto souboru, ne vůči cwd).
 */
import { upgatesConnector } from '../dist/index.js';

const { UPGATES_DEV_API_LOGIN, UPGATES_DEV_API_KEY, UPGATES_DEV_API_URL } = process.env;
if (!UPGATES_DEV_API_LOGIN || !UPGATES_DEV_API_KEY || !UPGATES_DEV_API_URL) {
  console.error('Chybí UPGATES_DEV_API_LOGIN / UPGATES_DEV_API_KEY / UPGATES_DEV_API_URL (spusť s `node --env-file=.env`).');
  process.exit(1);
}

const C = upgatesConnector;
const W = C.writes;
const db = null;
const shop = {
  id: 'live-verify', platform: 'upgates', platformAccountId: 'dev-eshop', domain: 'dev-eshop',
  name: 'dev-eshop', adminEmail: 'live-verify@local', status: 'ACTIVE',
  oauthAccessToken: 'x', webhookSignatureKey: 'x',
  apiBaseUrl: UPGATES_DEV_API_URL,
  platformApiLogin: UPGATES_DEV_API_LOGIN,
  platformApiKey: UPGATES_DEV_API_KEY,
  mcpEndpointSecret: 'x', memoryEnabled: false,
  installedAt: new Date(), uninstalledAt: null, createdAt: new Date(), updatedAt: new Date(),
};
console.info = () => {}; // utlum rate-limit logy connectoru

const stamp = String(Date.now()).slice(-7);
const PCODE = `PULS-VERIFY-${stamp}`;
const CCODE = `PULS-VERIFY-CAT-${stamp}`;
const results = [];
const pass = (n, d) => { results.push({ n, ok: true }); console.log(`✅ ${n}${d ? ': ' + d : ''}`); };
const fail = (n, e) => { results.push({ n, ok: false, e }); console.log(`❌ ${n}: ${e}`); };
const step = async (n, fn) => { try { pass(n, await fn()); } catch (e) { fail(n, e.message); } };

const getProd = async (code) => (await C.products.get(shop, db, code)).data;

await step('create_product (full)', async () => {
  await W.createProduct(shop, db, { product: { code: PCODE, name: 'Puls Verify Produkt', stock: 7, patch: {
    description: 'Live verify — bude smazán.', priceWithVat: 123.45, visibility: 'hidden',
    ean: '1234567890123', weight: 0.5, categories: [{ code: 'K00036', main: true }],
  } } });
  const p = await getProd(PCODE);
  if (Number(p.price) <= 0) throw new Error(`cena se nezapsala (price=${p.price})`);
  // REGRESE GUARD: produkt MUSÍ reálně přistát v kategorii (jinak je neviditelný).
  if (!Array.isArray(p.categories) || p.categories.length === 0) {
    throw new Error('kategorie NEPŘISTÁLA — produkt by byl ve storefrontu neviditelný');
  }
  return `price=${p.price} ${p.currency ?? ''} ean=${p.ean} cats=${JSON.stringify(p.categories)}`;
});

// Guard: bez kategorie MUSÍ create selhat (produkt bez kategorie = neviditelný).
await step('create_product BEZ kategorie → musí selhat', async () => {
  const noCatCode = `PULS-VERIFY-NOCAT-${stamp}`;
  let threw = false;
  try {
    await W.createProduct(shop, db, { product: { code: noCatCode, name: 'Bez kategorie', patch: { priceWithVat: 10, visibility: 'hidden' } } });
  } catch { threw = true; }
  // úklid pro případ, že by se přece jen vytvořil
  await W.deleteProduct(shop, db, { code: noCatCode }).catch(() => {});
  if (!threw) throw new Error('create bez kategorie NEselhal (měl by)');
  return 'správně odmítnuto';
});

// Guard: neplatný kód kategorie → create selže a NEZANECHÁ osiřelý produkt.
await step('create_product s NEPLATNÝM kódem kategorie → musí selhat + rollback', async () => {
  const badCode = `PULS-VERIFY-BADCAT-${stamp}`;
  let threw = false;
  try {
    await W.createProduct(shop, db, { product: { code: badCode, name: 'Neplatná kat.', patch: { priceWithVat: 10, visibility: 'hidden', categories: [{ code: 'NEEXISTUJE-XYZ', main: true }] } } });
  } catch { threw = true; }
  // ověř, že osiřelý produkt opravdu neexistuje (rollback proběhl)
  const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
  const chk = await fetch(`${UPGATES_DEV_API_URL}/products/${badCode}`, { headers: { Authorization: auth } });
  const body = await chk.json().catch(() => null);
  const exists = (body?.products?.length ?? 0) > 0;
  await W.deleteProduct(shop, db, { code: badCode }).catch(() => {});
  if (!threw) throw new Error('create s neplatným kódem NEselhal');
  if (exists) throw new Error('osiřelý produkt zůstal v eshopu (rollback selhal)');
  return 'odmítnuto + rollback OK';
});

await step('update_product (price+image)', async () => {
  await W.updateProduct(shop, db, { guid: PCODE, patch: { priceWithVat: 99.9, addImageUrls: ['https://picsum.photos/seed/pulsverify/500/500'] } });
  const p = await getProd(PCODE);
  if (Number(p.price) <= 0) throw new Error(`cena po update=${p.price}`);
  return `price=${p.price} (obrázek se stahuje async přes images-queue)`;
});

await step('set_product_discount', async () => {
  await W.updateProduct(shop, db, { guid: PCODE, patch: { productDiscountPercent: 10 } });
  return 'productDiscountPercent=10 zapsáno';
});

await step('parameters (inline create + read-back)', async () => {
  await W.updateProduct(shop, db, { guid: PCODE, patch: { parameters: [{ name: 'Barva', value: 'Modrá' }] } });
  const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
  const r = await fetch(`${UPGATES_DEV_API_URL}/products/${PCODE}/parameters`, { headers: { Authorization: auth } });
  const j = await r.json();
  const params = j?.products?.[0]?.parameters ?? j?.parameters ?? [];
  if (!JSON.stringify(params).includes('Barva')) throw new Error('parametr Barva se nenačetl zpět');
  return JSON.stringify(params).slice(0, 200);
});

let voucherCodes = [];
await step('create_voucher (percent)', async () => {
  const v = await W.createVoucher(shop, db, { discountType: 'percent', discountValue: 15, validUntil: '2026-12-31' });
  voucherCodes = v.data.codes ?? [];
  if (!voucherCodes.length) throw new Error('nevrátil žádný kód');
  return `codes=${JSON.stringify(voucherCodes)} ${v.data.currency}`;
});
await step('delete_voucher (cleanup)', async () => {
  if (!voucherCodes.length) throw new Error('skip — žádné kódy');
  const d = await W.deleteVoucher(shop, db, { codes: voucherCodes });
  if (!d.data.results.some((r) => r.deleted)) throw new Error('nesmazáno');
  return 'smazáno';
});

await step('create_category + read-back', async () => {
  await W.createCategory(shop, db, { category: { code: CCODE, name: 'Puls Verify Kategorie', parentCode: 'K00036', active: true } });
  const cats = await C.catalog.categories(shop, db);
  if (!cats.data.find((c) => c.code === CCODE || c.guid === CCODE)) throw new Error('kategorie nenalezena v seznamu');
  return 'vytvořena a načtena zpět';
});
await step('delete_category (cleanup)', async () => {
  const d = await W.deleteCategory(shop, db, { guid: CCODE });
  if (!d.data.deleted) throw new Error('nesmazáno');
  return 'smazáno';
});

await step('pricelist create+list+delete', async () => {
  const name = `PULS-VERIFY-PL-${stamp}`;
  const cr = await W.createPricelist(shop, db, { name, percent: 5 });
  const found = (await W.listPricelists(shop, db)).data.find((p) => p.name === name);
  if (!found) throw new Error('ceník nenalezen po vytvoření');
  const d = await W.deletePricelist(shop, db, { id: found.id });
  if (!d.data.deleted) throw new Error('ceník nesmazán');
  return `id=${cr.data.id} percent=${found.percent} → smazán`;
});

await step('delete_product (cleanup + revert path)', async () => {
  const d = await W.deleteProduct(shop, db, { code: PCODE });
  if (!d.data.deleted) throw new Error('produkt nesmazán');
  return 'smazán';
});

console.log('\n===== SUMMARY =====');
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
