/* eslint-disable no-console */
/**
 * LIVE ověření PLNÉHO MCP řetězce proti REÁLNÉMU eshopu (dev eshop):
 *   MCP HTTP nástroj → OAuth token → connector → REÁLNÉ Upgates API → write_log → revert_write
 *
 * Na rozdíl od `packages/upgates-client/scripts/live-verify.mjs` (jen connector =
 * wrapper nad API) tohle volá BĚŽÍCÍ mcp-server přes HTTP přesně jako reálný AI
 * klient — vč. tier gate, confirm guard, write_log auditu a revert_write.
 *
 * PŘEDPOKLADY:
 *  - běží compose stack (mcp na MCP_URL, postgres na PG_URL),
 *  - shop má v `api_base_url` REÁLNOU Upgates URL (ne mock) → connector trefí reálné API,
 *  - env: UPGATES_DEV_API_LOGIN/KEY/URL (creds shopu), volitelně MCP_URL, PG_URL.
 *
 * POUŽITÍ (z rootu):
 *   node --env-file=.env apps/mcp-server/scripts/live-verify-mcp.mjs
 *
 * Provisionuje dočasný shop+token, otestuje, a VŠE uklidí (entity v eshopu i DB řádky).
 * `postgres` se resolvuje z apps/mcp-server/node_modules (skript je uvnitř tohoto app).
 */
import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:13001';
const PG_URL = process.env.PG_URL ?? 'postgresql://puls:puls@localhost:5433/puls';
const { UPGATES_DEV_API_LOGIN, UPGATES_DEV_API_KEY, UPGATES_DEV_API_URL } = process.env;
if (!UPGATES_DEV_API_LOGIN || !UPGATES_DEV_API_KEY || !UPGATES_DEV_API_URL) {
  console.error('Chybí UPGATES_DEV_API_* (spusť s `node --env-file=.env`).');
  process.exit(1);
}

const sql = postgres(PG_URL, { max: 1 });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const stamp = String(Date.now()).slice(-7);
const BEARER = `pulslv_${randomUUID()}`;
const email = `live-verify-${stamp}@local.test`;
const shopId = `lv_${stamp}`;
const userId = `lvu_${stamp}`;
const tokenId = `lvt_${stamp}`;
const PCODE = `PULS-MCP-${stamp}`;

const results = [];
const pass = (n, d) => { results.push({ n, ok: true }); console.log(`✅ ${n}${d ? ': ' + d : ''}`); };
const fail = (n, e) => { results.push({ n, ok: false, e }); console.log(`❌ ${n}: ${e}`); };

// ---- MCP HTTP (streamable, JSON-RPC over SSE) ----
let sessionId = null;
async function rpc(method, params, id) {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get('mcp-session-id');
  const text = await res.text();
  // SSE: vyzobni poslední `data:` JSON
  const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  const last = dataLines[dataLines.length - 1];
  let msg; try { msg = JSON.parse(last); } catch { msg = { raw: text.slice(0, 300) }; }
  return { http: res.status, msg };
}
function toolPayload(rpcMsg) {
  const c = rpcMsg?.result?.content?.[0]?.text;
  if (!c) return rpcMsg?.result ?? rpcMsg;
  try { return JSON.parse(c); } catch { return c; }
}

async function main() {
  // 1) Provision user + shop (REÁLNÉ creds, REÁLNÁ apiBaseUrl) + token (tier pro)
  await sql`insert into users (id, email) values (${userId}, ${email})
            on conflict (email) do update set email = excluded.email`;
  const [u] = await sql`select id from users where email = ${email}`;
  await sql`insert into shops (id, platform, platform_account_id, domain, admin_email,
              status, oauth_access_token, webhook_signature_key, api_base_url,
              platform_api_login, platform_api_key, mcp_endpoint_secret, tier_id, trial_ends_at)
            values (${shopId}, 'upgates', ${'lv-' + stamp}, ${'lv-' + stamp + '.upgates.cz'}, ${email},
              'ACTIVE', 'upgates-no-oauth', ${'wh-' + stamp}, ${UPGATES_DEV_API_URL},
              ${UPGATES_DEV_API_LOGIN}, ${UPGATES_DEV_API_KEY}, ${'mcp-' + stamp}, 'pro', now() + interval '14 days')`;
  await sql`insert into oauth_access_tokens (id, token_hash, user_id, shop_id, scope, disabled_tools, expires_at)
            values (${tokenId}, ${sha(BEARER)}, ${u.id}, ${shopId}, ${'mcp'}, ${''}, now() + interval '1 hour')`;
  pass('provision shop+token (tier pro, reálná apiBaseUrl)');

  // 2) initialize + tools/list — je create_product registrovaný přes reálný MCP?
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live-verify-mcp', version: '1' } }, 1);
  const list = await rpc('tools/list', {}, 2);
  const names = (list.msg?.result?.tools ?? []).map((t) => t.name);
  if (names.includes('create_product') && names.includes('revert_write') && !names.includes('update_order_status')) {
    pass('tools/list', `create_product+revert_write přítomny, update_order_status skryt (${names.length} nástrojů)`);
  } else {
    fail('tools/list', `nečekaná sada: ${JSON.stringify(names)}`);
  }

  // 3) create_product přes MCP → REÁLNÝ eshop + write_log
  let writeLogId = null;
  const cr = await rpc('tools/call', { name: 'create_product', arguments: {
    code: PCODE, name: 'Puls MCP Verify', stock: 3,
    patch: { priceWithVat: 222.5, visibility: 'hidden', ean: '9990000000123', categories: [{ code: 'K00036', main: true }] },
    confirm: 'yes',
  } }, 3);
  const crp = toolPayload(cr.msg);
  writeLogId = crp?.write_log_id ?? null;
  if (crp?.ok && writeLogId) pass('create_product (MCP→reálné API)', `write_log_id=${writeLogId} price=${crp?.result?.price}`);
  else fail('create_product (MCP→reálné API)', JSON.stringify(crp).slice(0, 300));

  // REGRESE GUARD: produkt MUSÍ reálně přistát v kategorii (jinak neviditelný).
  const createdCats = crp?.result?.categories ?? [];
  if (Array.isArray(createdCats) && createdCats.length > 0) {
    pass('create_product kategorie přistála', JSON.stringify(createdCats));
  } else {
    fail('create_product kategorie přistála', `categories=${JSON.stringify(createdCats)} (produkt by byl neviditelný)`);
  }

  // 4) write_log audit v DB (before/after/status)
  if (writeLogId) {
    const [row] = await sql`select tool, status, before, after from write_log where id = ${writeLogId}`;
    if (row && row.status === 'applied' && row.tool === 'create_product') pass('write_log audit', `status=${row.status} after.guid=${row.after?.guid}`);
    else fail('write_log audit', JSON.stringify(row).slice(0, 200));
  }

  // 5) revert_write přes MCP → smaže produkt v REÁLNÉM eshopu
  if (writeLogId) {
    const rv = await rpc('tools/call', { name: 'revert_write', arguments: { write_log_id: writeLogId, confirm: 'yes' } }, 4);
    const rvp = toolPayload(rv.msg);
    if (rvp?.ok && rvp?.reverted) pass('revert_write (MCP)', 'reverted=true');
    else fail('revert_write (MCP)', JSON.stringify(rvp).slice(0, 300));
    const [row2] = await sql`select status from write_log where id = ${writeLogId}`;
    if (row2?.status === 'reverted') pass('write_log status po revertu', 'reverted'); else fail('write_log status po revertu', JSON.stringify(row2));
  }

  // 6) Ověř v REÁLNÉM eshopu, že produkt po revertu NEEXISTUJE
  const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
  const chk = await fetch(`${UPGATES_DEV_API_URL}/products/${PCODE}`, { headers: { Authorization: auth } });
  // Upgates na neexistující kód vrací 200 + prázdný seznam (NE 404).
  const body = await chk.json().catch(() => null);
  const gone = chk.status === 404 || (body?.products?.length ?? 0) === 0 || body?.number_of_items === 0;
  if (gone) pass('produkt po revertu smazán (reálné API: prázdný výsledek)');
  else fail('produkt po revertu smazán', `HTTP ${chk.status} stále existuje`);
}

try {
  await main();
} catch (e) {
  fail('FATAL', e.message);
} finally {
  // cleanup eshop (kdyby revert selhal) + DB řádky
  try {
    const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
    await fetch(`${UPGATES_DEV_API_URL}/products?codes=${PCODE}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
  } catch {}
  await sql`delete from oauth_access_tokens where id = ${tokenId}`.catch(() => {});
  await sql`delete from shops where id = ${shopId}`.catch(() => {});
  await sql`delete from users where id = ${userId} and email = ${email}`.catch(() => {});
  await sql.end();
  console.log('\n===== SUMMARY (MCP path vs reálný eshop) =====');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : ' — ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
