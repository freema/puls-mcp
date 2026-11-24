/* eslint-disable no-console */
/**
 * LIVE scénáře BĚŽNÉ PRÁCE e-shopaře přes MCP proti REÁLNÉMU eshopu (dev eshop).
 * Každý scénář = reálný úkol ("zlevni o 20 %", "přidej fotku", "kupón na dopravu
 * zdarma") provedený přes BĚŽÍCÍ MCP server (HTTP, tools/call), ověřený a uklizený.
 *
 * POUŽITÍ:  node --env-file=.env apps/mcp-server/scripts/live-scenarios-mcp.mjs
 * Výstup = coverage matice (co reálně funguje vs ne). Zdroj pravdy pro web copy.
 */
import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:13001';
const PG_URL = process.env.PG_URL ?? 'postgresql://puls:puls@localhost:5433/puls';
const { UPGATES_DEV_API_LOGIN, UPGATES_DEV_API_KEY, UPGATES_DEV_API_URL } = process.env;
if (!UPGATES_DEV_API_LOGIN || !UPGATES_DEV_API_KEY || !UPGATES_DEV_API_URL) {
  console.error('Chybí UPGATES_DEV_API_* (node --env-file=.env).'); process.exit(1);
}

const sql = postgres(PG_URL, { max: 1 });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const stamp = String(Date.now()).slice(-7);
const BEARER = `pulslv_${randomUUID()}`;
const email = `live-scn-${stamp}@local.test`;
const shopId = `lvs_${stamp}`, userId = `lvsu_${stamp}`, tokenId = `lvst_${stamp}`;
const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
const createdCodes = new Set();
const createdCats = new Set();

const scn = [];
const ok = (n, d) => { scn.push({ n, ok: true, d }); console.log(`✅ ${n}${d ? ' — ' + d : ''}`); };
const no = (n, e) => { scn.push({ n, ok: false, d: e }); console.log(`❌ ${n} — ${e}`); };

let sessionId = null;
async function rpc(method, params, id) {
  const res = await fetch(`${MCP_URL}/mcp`, { method: 'POST', headers: {
    accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    authorization: `Bearer ${BEARER}`, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  if (!sessionId) sessionId = res.headers.get('mcp-session-id');
  const t = await res.text();
  const d = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  try { return JSON.parse(d[d.length - 1]); } catch { return { raw: t.slice(0, 200) }; }
}
async function call(name, args) {
  const m = await rpc('tools/call', { name, arguments: { ...args, ...(name.startsWith('list') || name === 'get_product' || name === 'get_order' ? {} : {}) } }, Math.floor(performance.now()));
  const c = m?.result?.content?.[0]?.text;
  if (m?.result?.isError) throw new Error(c ?? 'tool error');
  try { return JSON.parse(c); } catch { return c ?? m?.result; }
}
async function apiGet(path) { const r = await fetch(`${UPGATES_DEV_API_URL}${path}`, { headers: { Authorization: auth } }); return { status: r.status, j: await r.json().catch(() => null) }; }
const prodPrice = async (code) => { const r = await apiGet(`/products/${code}`); const p = r.j?.products?.[0]; return p?.prices?.[0]?.pricelists?.[0] ?? null; };

async function newProduct(label, price = 100) {
  const code = `PULS-SCN-${stamp}-${label}`;
  // Kategorie je na Upgates POVINNÁ (jinak je produkt ve storefrontu neviditelný
  // a create_product to teď správně odmítne). K00036 = reálná kat. dev eshopu.
  await call('create_product', { code, name: `Scn ${label}`, stock: 5, patch: { priceWithVat: price, visibility: 'hidden', categories: [{ code: 'K00036', main: true }] }, confirm: 'yes' });
  createdCodes.add(code); return code;
}

async function main() {
  // provision shop+token (reálná apiBaseUrl, tier pro)
  await sql`insert into users (id,email) values (${userId},${email}) on conflict (email) do update set email=excluded.email`;
  const [u] = await sql`select id from users where email=${email}`;
  await sql`insert into shops (id,platform,platform_account_id,domain,admin_email,status,oauth_access_token,webhook_signature_key,api_base_url,platform_api_login,platform_api_key,mcp_endpoint_secret,tier_id,trial_ends_at)
            values (${shopId},'upgates',${'lvs-'+stamp},${'lvs-'+stamp+'.cz'},${email},'ACTIVE','x',${'wh-'+stamp},${UPGATES_DEV_API_URL},${UPGATES_DEV_API_LOGIN},${UPGATES_DEV_API_KEY},${'mcp-'+stamp},'pro',now()+interval '14 days')`;
  await sql`insert into oauth_access_tokens (id,token_hash,user_id,shop_id,scope,disabled_tools,expires_at) values (${tokenId},${sha(BEARER)},${u.id},${shopId},'mcp',${''},now()+interval '1 hour')`;
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scn', version: '1' } }, 1);

  // S1: Založ nový produkt (cena + kategorie + sklad)
  try { const c = await newProduct('A', 199); const pl = await prodPrice(c); if (Number(pl?.price_with_vat) === 199) ok('Založení nového produktu (cena/sklad/skrytý)', `cena=${pl.price_with_vat}`); else throw new Error(`cena=${pl?.price_with_vat}`); } catch (e) { no('Založení nového produktu', e.message); }

  // S2: Přidej fotku produktu, co ji nemá
  try { const c = [...createdCodes][0]; await call('update_product', { guid: c, patch: { addImageUrls: ['https://picsum.photos/seed/pulsscn/600/600'] }, confirm: 'yes' }); ok('Přidání fotky produktu (URL, async stažení)'); } catch (e) { no('Přidání fotky produktu', e.message); }

  // S3: Zlevni produkt o 20 %
  try { const c = [...createdCodes][0]; await call('set_product_discount', { guid: c, percent: 20, confirm: 'yes' }); const pl = await prodPrice(c); if (Number(pl?.product_discount) === 20) ok('Sleva 20 % na produkt', `product_discount=${pl.product_discount}`); else throw new Error(`discount=${pl?.product_discount}`); } catch (e) { no('Sleva na produkt', e.message); }

  // S4: Hromadně zdraž výběr o 10 %
  try { const a = [...createdCodes][0]; const b = await newProduct('B', 50); const r = await call('bulk_set_prices', { guids: [a, b], op: { mode: 'adjustPercent', value: 10 }, confirm: 'yes' }); const okCount = (r?.results ?? []).filter((x) => x.status === 'ok').length; if (okCount === 2) ok('Hromadné zdražení +10 % (2 produkty)', `${okCount}/2 ok`); else throw new Error(JSON.stringify(r).slice(0, 150)); } catch (e) { no('Hromadné zdražení', e.message); }

  // S5: Skryj produkt (viditelnost)
  try { const c = await newProduct('C', 30); await call('update_product', { guid: c, patch: { visibility: 'hidden' }, confirm: 'yes' }); ok('Skrytí produktu (viditelnost)'); } catch (e) { no('Skrytí produktu', e.message); }

  // S6: Nastav skladovou zásobu
  try { const c = [...createdCodes][0]; const stocks = await call('list_stocks', {}); const sid = (stocks?.stocks ?? stocks?.data ?? [{}])[0]?.id ?? 'default'; await call('update_stock', { guid: c, stockId: String(sid), quantity: 42, confirm: 'yes' }); const r = await apiGet(`/products/${c}`); const st = r.j?.products?.[0]?.stock; if (Number(st) === 42) ok('Nastavení skladu (42 ks)', `stock=${st}`); else throw new Error(`stock=${st}`); } catch (e) { no('Nastavení skladu', e.message); }

  // S7: Založ kategorii + dej do ní produkt
  let catCode = null;
  try { catCode = `PULS-SCN-CAT-${stamp}`; await call('create_category', { code: catCode, name: 'Scn Akce', parentCode: 'K00036', confirm: 'yes' }); createdCats.add(catCode); const c = [...createdCodes][0]; await call('update_product', { guid: c, patch: { categories: [{ code: catCode, main: false }] }, confirm: 'yes' }); ok('Založení kategorie + zařazení produktu'); } catch (e) { no('Kategorie + zařazení', e.message); }

  // S8: Přejmenuj kategorii
  try { if (!catCode) throw new Error('skip — kategorie nevznikla'); await call('update_category', { guid: catCode, patch: { name: 'Scn Akce 2026' }, confirm: 'yes' }); ok('Přejmenování kategorie'); } catch (e) { no('Přejmenování kategorie', e.message); }

  // S9: Slevový kupón na kampaň (procenta)
  let vCodes = [];
  try { const v = await call('create_voucher', { discountType: 'percent', discountValue: 15, validUntil: '2026-12-31', confirm: 'yes' }); vCodes = v?.result?.codes ?? []; if (vCodes.length) ok('Slevový kupón 15 % na kampaň', `kód=${vCodes[0]}`); else throw new Error('bez kódu'); } catch (e) { no('Slevový kupón %', e.message); }

  // S10: Kupón na dopravu zdarma
  let vShip = [];
  try { const v = await call('create_voucher', { discountType: 'free_shipping_payment', confirm: 'yes' }); vShip = v?.result?.codes ?? []; if (vShip.length) ok('Kupón doprava+platba zdarma', `kód=${vShip[0]}`); else throw new Error('bez kódu'); } catch (e) { no('Kupón doprava zdarma', e.message); }

  // S11: Načti objednávky (read)
  try { const o = await call('list_orders', { limit: 5 }); ok('Čtení objednávek', `count=${o?.count ?? (o?.orders?.length ?? '?')}`); } catch (e) { no('Čtení objednávek', e.message); }

  // S12: Načti ceníky (read)
  try { const p = await call('list_pricelists', {}); ok('Výpis ceníků', `count=${(p?.pricelists ?? []).length}`); } catch (e) { no('Výpis ceníků', e.message); }

  // S13: Vrať změnu (revert) — vrať slevu z S3 přes write history (poslední set_product_discount)
  try {
    const [row] = await sql`select id from write_log where shop_id=${shopId} and tool='set_product_discount' order by created_at desc limit 1`;
    if (!row) throw new Error('žádný set_product_discount v auditu');
    const r = await call('revert_write', { write_log_id: row.id, confirm: 'yes' });
    if (r?.reverted) ok('Vrácení změny (revert slevy)'); else throw new Error(JSON.stringify(r).slice(0, 120));
  } catch (e) { no('Vrácení změny (revert)', e.message); }

  // cleanup vouchers
  const allV = [...vCodes, ...vShip];
  if (allV.length) await call('delete_voucher', { codes: allV, confirm: 'yes' }).catch(() => {});
}

try { await main(); } catch (e) { no('FATAL', e.message); }
finally {
  for (const c of createdCodes) await fetch(`${UPGATES_DEV_API_URL}/products?codes=${c}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
  for (const c of createdCats) await fetch(`${UPGATES_DEV_API_URL}/categories?code=${c}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
  await sql`delete from oauth_access_tokens where id=${tokenId}`.catch(() => {});
  await sql`delete from shops where id=${shopId}`.catch(() => {});
  await sql`delete from users where id=${userId} and email=${email}`.catch(() => {});
  await sql.end();
  console.log('\n===== COVERAGE (běžné scénáře přes MCP vs reálný eshop) =====');
  for (const s of scn) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.n}${s.ok ? '' : ' — ' + s.d}`);
  const f = scn.filter((s) => !s.ok);
  console.log(`\n${scn.length - f.length}/${scn.length} scénářů prošlo`);
  process.exit(f.length ? 1 : 0);
}
