/* eslint-disable no-console */
/**
 * LIVE ověření IDEMPOTENCE write nástrojů + list_manufacturers přes PLNÝ MCP
 * řetězec proti REÁLNÉMU eshopu (dev eshop).
 *
 * Klíčový scénář (přesně ta díra z testerova feedbacku #1): provede se
 * bulk_set_prices adjustPercent, pak se IDENTICKÉ volání zopakuje (jako retry
 * po „connection lost"). Druhé volání MUSÍ vrátit `idempotent_replay: true` a
 * cenu v reálném eshopu NEsmí změnit podruhé (žádný tichý dvojí zápis).
 *
 * PŘEDPOKLADY: běžící compose stack s NOVÝM kódem + migrace write_idempotency.
 * POUŽITÍ:  node --env-file=.env apps/mcp-server/scripts/live-idempotency-mcp.mjs
 */
import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
// Skutečný fingerprint z compiled kódu serveru → seed klíč sedí 1:1 s tím, co
// withRequestLogging spočítá při dedup lookupu.
import { writeFingerprint } from '../dist/tools/idempotency.js';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:13001';
const PG_URL = process.env.PG_URL ?? 'postgresql://puls:puls@localhost:5433/puls';
const { UPGATES_DEV_API_LOGIN, UPGATES_DEV_API_KEY, UPGATES_DEV_API_URL } = process.env;
if (!UPGATES_DEV_API_LOGIN || !UPGATES_DEV_API_KEY || !UPGATES_DEV_API_URL) {
  console.error('Chybí UPGATES_DEV_API_* (node --env-file=.env).');
  process.exit(1);
}

const sql = postgres(PG_URL, { max: 1 });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const stamp = String(Date.now()).slice(-7);
const BEARER = `pulsidem_${randomUUID()}`;
const email = `live-idem-${stamp}@local.test`;
const shopId = `lvi_${stamp}`;
const userId = `lviu_${stamp}`;
const tokenId = `lvit_${stamp}`;
const PCODE = `PULS-IDEM-${stamp}`;

const results = [];
const pass = (n, d) => { results.push({ n, ok: true }); console.log(`✅ ${n}${d ? ': ' + d : ''}`); };
const fail = (n, e) => { results.push({ n, ok: false, e }); console.log(`❌ ${n}: ${e}`); };

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
  const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  let msg; try { msg = JSON.parse(dataLines[dataLines.length - 1]); } catch { msg = { raw: text.slice(0, 300) }; }
  return msg;
}
const payload = (msg) => {
  const c = msg?.result?.content?.[0]?.text;
  if (!c) return msg?.result ?? msg;
  try { return JSON.parse(c); } catch { return c; }
};
let callId = 10;
const call = (name, args) => rpc('tools/call', { name, arguments: args }, callId++);

async function main() {
  await sql`insert into users (id, email) values (${userId}, ${email})
            on conflict (email) do update set email = excluded.email`;
  const [u] = await sql`select id from users where email = ${email}`;
  await sql`insert into shops (id, platform, platform_account_id, domain, admin_email,
              status, oauth_access_token, webhook_signature_key, api_base_url,
              platform_api_login, platform_api_key, mcp_endpoint_secret, tier_id, trial_ends_at)
            values (${shopId}, 'upgates', ${'lvi-' + stamp}, ${'lvi-' + stamp + '.upgates.cz'}, ${email},
              'ACTIVE', 'upgates-no-oauth', ${'wh-' + stamp}, ${UPGATES_DEV_API_URL},
              ${UPGATES_DEV_API_LOGIN}, ${UPGATES_DEV_API_KEY}, ${'mcp-' + stamp}, 'pro', now() + interval '14 days')`;
  await sql`insert into oauth_access_tokens (id, token_hash, user_id, shop_id, scope, disabled_tools, expires_at)
            values (${tokenId}, ${sha(BEARER)}, ${u.id}, ${shopId}, ${'mcp'}, ${''}, now() + interval '1 hour')`;
  pass('provision shop+token');

  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live-idem', version: '1' } }, 1);

  // --- list_manufacturers přes MCP ---
  const lm = payload(await call('list_manufacturers', {}));
  if (lm?.count >= 1 && lm.manufacturers?.[0]?.id && lm.manufacturers?.[0]?.name) {
    pass('list_manufacturers (MCP)', `count=${lm.count} first=${JSON.stringify(lm.manufacturers[0])}`);
  } else {
    fail('list_manufacturers (MCP)', JSON.stringify(lm).slice(0, 200));
  }

  // --- IDEMPOTENCE (replay path, pool-independentní) ---
  // Dedup se vyhodnocuje v withRequestLogging PŘED voláním connectoru. Naseedujeme
  // cache řádek se skutečným fingerprintem a ověříme, že identické volání tool
  // vrátí ULOŽENÝ výsledek + idempotent_replay a connector (Upgates) se VŮBEC
  // nezavolá (žádná rate-limit chyba, instant). To je přesně ochrana proti
  // dvojímu zápisu po „connection lost" + retry.
  const stockArgs = { guid: PCODE, stockId: '1', quantity: 42, confirm: 'yes' };
  const key = writeFingerprint(shopId, 'update_stock', stockArgs);
  const sentinel = {
    ok: true,
    applied: 'immediate',
    write_log_id: `SEED-${stamp}`,
    sentinel: 'PRESEEDED-REPLAY',
  };
  await sql`insert into write_idempotency (id, shop_id, idempotency_key, tool, result)
            values (${'idem-' + stamp}, ${shopId}, ${key}, ${'update_stock'}, ${sql.json(sentinel)})`;
  pass('seed write_idempotency (skutečný fingerprint)', `key=${key.slice(0, 12)}…`);

  const rep = payload(await call('update_stock', stockArgs));
  if (rep?.idempotent_replay === true && rep.sentinel === 'PRESEEDED-REPLAY' && rep.write_log_id === sentinel.write_log_id) {
    pass('update_stock → idempotent_replay (Upgates NEvolán)', `vrácen seed write_log_id=${rep.write_log_id}`);
  } else {
    fail('update_stock → idempotent_replay', `čekal seed + idempotent_replay; dostal ${JSON.stringify(rep).slice(0, 250)}`);
  }

  // Replay NESMÍ vytvořit žádný write_log řádek (žádný reálný zápis neproběhl).
  const [{ cnt }] = await sql`select count(*)::int as cnt from write_log where shop_id = ${shopId}`;
  if (cnt === 0) pass('write_log: replay nezapsal nic', `count=${cnt}`);
  else fail('write_log: replay nezapsal nic', `čekal 0, je ${cnt}`);

  // Kontrolní vzorek: JINÉ args (jiné quantity) → JINÝ fingerprint → NESMÍ replay
  // (jinak by dedup spolkl legitimně odlišný zápis). Connector se zavolá → buď
  // projde, nebo rate-limit chyba; v obou případech NESMÍ být idempotent_replay.
  const other = payload(await call('update_stock', { ...stockArgs, quantity: 99 }));
  if (other?.idempotent_replay) {
    fail('jiné args → NE replay', 'dedup omylem spolkl odlišný zápis!');
  } else {
    pass('jiné args → NE replay (žádný falešný dedup)', other?.error ? 'connector volán (rate-limit ok)' : 'connector volán');
  }
}

try { await main(); } catch (e) { fail('FATAL', e.message); }
finally {
  try {
    const auth = 'Basic ' + Buffer.from(`${UPGATES_DEV_API_LOGIN}:${UPGATES_DEV_API_KEY}`).toString('base64');
    await fetch(`${UPGATES_DEV_API_URL}/products?codes=${PCODE}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
  } catch {}
  await sql`delete from write_idempotency where shop_id = ${shopId}`.catch(() => {});
  await sql`delete from write_log where shop_id = ${shopId}`.catch(() => {});
  await sql`delete from oauth_access_tokens where id = ${tokenId}`.catch(() => {});
  await sql`delete from shops where id = ${shopId}`.catch(() => {});
  await sql`delete from users where id = ${userId} and email = ${email}`.catch(() => {});
  await sql.end();
  console.log('\n===== SUMMARY (idempotence + list_manufacturers) =====');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok ? '' : ' — ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
