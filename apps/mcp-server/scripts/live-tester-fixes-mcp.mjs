/* eslint-disable no-console */
/**
 * LIVE ověření oprav z tester feedbacku (2026-06-09) přes PLNÝ MCP řetězec
 * proti REÁLNÉMU eshopu (dev eshop):
 *
 *  1. update_product patch.stock — dřív tichý no-op (Zod strip), teď zapíše.
 *  2. Neznámé pole v patchi — hlasitá chyba místo tichého stripu.
 *  3. get_product na neexistující code — "not found" místo prázdného objektu.
 *  4. list_stocks — syntetický default sklad (place of prázdna).
 *  5. update_stock BEZ stockId — default "default" funguje.
 *  6. create_voucher s vlastním kódem — note, když platforma kód ignoruje.
 *  7. create_category bez rodiče — chyba s akčním hintem.
 *  8. low_stock — vidí product-level stock (dřív prázdno).
 *
 * Testovací entity jsou skryté (visibility hidden / active false) a na konci
 * se VŠECHNY uklidí. POUŽITÍ:
 *   node --env-file=.env apps/mcp-server/scripts/live-tester-fixes-mcp.mjs
 */
import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';

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
const BEARER = `pulsfix_${randomUUID()}`;
const email = `live-fix-${stamp}@local.test`;
const shopId = `lvf_${stamp}`;
const userId = `lvfu_${stamp}`;
const tokenId = `lvft_${stamp}`;
const PCODE = `PULS-FIX-${stamp}`;
const KCODE = `PULS-FIX-KAT-${stamp}`;

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
const isToolError = (msg) => msg?.result?.isError === true || !!msg?.error;
const errText = (msg) =>
  msg?.error?.message ?? msg?.result?.content?.[0]?.text ?? JSON.stringify(msg).slice(0, 300);
let callId = 10;
const call = (name, args) => rpc('tools/call', { name, arguments: args }, callId++);

async function main() {
  // --- provision: shop + bearer token přímo v DB (bypass OAuth consent) -----
  await sql`insert into users (id, email) values (${userId}, ${email})
            on conflict (email) do update set email = excluded.email`;
  const [u] = await sql`select id from users where email = ${email}`;
  await sql`insert into shops (id, platform, platform_account_id, domain, admin_email,
              status, oauth_access_token, webhook_signature_key, api_base_url,
              platform_api_login, platform_api_key, mcp_endpoint_secret, tier_id, trial_ends_at)
            values (${shopId}, 'upgates', ${'lvf-' + stamp}, ${'lvf-' + stamp + '.upgates.cz'}, ${email},
              'ACTIVE', 'upgates-no-oauth', ${'wh-' + stamp}, ${UPGATES_DEV_API_URL},
              ${UPGATES_DEV_API_LOGIN}, ${UPGATES_DEV_API_KEY}, ${'mcp-' + stamp}, 'pro', now() + interval '14 days')`;
  await sql`insert into oauth_access_tokens (id, token_hash, user_id, shop_id, scope, disabled_tools, expires_at)
            values (${tokenId}, ${sha(BEARER)}, ${u.id}, ${shopId}, ${'mcp'}, ${''}, now() + interval '1 hour')`;
  pass('provision shop+token');

  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'live-tester-fixes', version: '1.0' },
  }, 1);
  if (init?.result?.serverInfo) pass('MCP initialize');
  else { fail('MCP initialize', JSON.stringify(init).slice(0, 200)); return; }
  await rpc('notifications/initialized', {}, undefined);

  let createLogId = null;
  let voucherCodes = [];

  // --- 1) create_product (skrytý) -------------------------------------------
  {
    const msg = await call('create_product', {
      code: PCODE,
      name: `Puls fix-test ${stamp}`,
      patch: { priceWithVat: 199, visibility: 'hidden' },
      stock: 10,
      confirm: 'yes',
    });
    const p = payload(msg);
    if (!isToolError(msg) && p?.write_log_id) {
      createLogId = p.write_log_id;
      pass('create_product (hidden, stock 10)', `write_log ${createLogId}`);
    } else { fail('create_product', errText(msg)); }
  }

  // --- 2) HLAVNÍ FIX: update_product patch {priceWithVat, stock} ------------
  {
    const msg = await call('update_product', {
      guid: PCODE,
      patch: { priceWithVat: 249, stock: 3 },
      confirm: 'yes',
    });
    if (isToolError(msg)) fail('update_product price+stock', errText(msg));
    else {
      const read = payload(await call('get_product', { guid: PCODE }));
      const prod = read?.data ?? read;
      const stockOk = Number(prod?.stock) === 3;
      const priceOk = Number(prod?.priceOriginal ?? prod?.price) === 249;
      if (stockOk && priceOk) pass('update_product patch.stock zapsal', `stock=3, price=249`);
      else fail('update_product patch.stock', `read-back stock=${prod?.stock} price=${prod?.price}/orig=${prod?.priceOriginal}`);
    }
  }

  // --- 3) neznámé pole v patchi = hlasitá chyba ------------------------------
  {
    const msg = await call('update_product', {
      guid: PCODE,
      patch: { stok: 1 },
      confirm: 'yes',
    });
    if (isToolError(msg) && /stok|unrecognized/i.test(errText(msg))) {
      pass('unknown patch field rejected loudly');
    } else { fail('unknown patch field', errText(msg)); }
  }

  // --- 4) get_product na neexistující code -----------------------------------
  {
    const msg = await call('get_product', { guid: `PULS-NEEXISTUJE-${stamp}` });
    if (isToolError(msg) && /not found/i.test(errText(msg))) {
      pass('get_product not-found je explicitní chyba');
    } else { fail('get_product not-found', errText(msg)); }
  }

  // --- 5) list_stocks → syntetický default ----------------------------------
  {
    const p = payload(await call('list_stocks', {}));
    const warehouses = p?.warehouses ?? [];
    if (warehouses.some((w) => w.id === 'default')) {
      pass('list_stocks vrací default sklad', JSON.stringify(warehouses));
    } else { fail('list_stocks default', JSON.stringify(p).slice(0, 200)); }
  }

  // --- 6) update_stock BEZ stockId (default) ---------------------------------
  {
    const msg = await call('update_stock', { guid: PCODE, quantity: 5, confirm: 'yes' });
    if (isToolError(msg)) fail('update_stock bez stockId', errText(msg));
    else {
      const read = payload(await call('get_product', { guid: PCODE }));
      const prod = read?.data ?? read;
      if (Number(prod?.stock) === 5) pass('update_stock bez stockId zapsal', 'stock=5');
      else fail('update_stock bez stockId', `read-back stock=${prod?.stock}`);
    }
  }

  // --- 7) create_voucher s vlastním kódem → note -----------------------------
  {
    const msg = await call('create_voucher', {
      code: `PULSFIX${stamp}`,
      discountType: 'percent',
      discountValue: 5,
      active: false,
      confirm: 'yes',
    });
    const p = payload(msg);
    const data = p?.result ?? p;
    voucherCodes = data?.codes ?? [];
    if (isToolError(msg)) fail('create_voucher', errText(msg));
    else if (voucherCodes.length === 0) fail('create_voucher', 'žádné codes v odpovědi');
    else if (!voucherCodes.includes(`PULSFIX${stamp}`)) {
      if (data?.note && /generated its own/i.test(data.note)) {
        pass('create_voucher: kód ignorován + note', `${voucherCodes.join(',')}`);
      } else { fail('create_voucher note', `codes=${voucherCodes.join(',')} note=${data?.note}`); }
    } else {
      pass('create_voucher: platforma kód PŘIJALA (note netřeba)', voucherCodes.join(','));
    }
  }

  // --- 8) create_category bez rodiče → akční hint ----------------------------
  {
    const msg = await call('create_category', {
      code: KCODE,
      name: `Puls fix kat ${stamp}`,
      active: false,
      confirm: 'yes',
    });
    if (isToolError(msg) && /requires a parent category.*list_categories/is.test(errText(msg))) {
      pass('create_category bez rodiče → hint');
    } else if (!isToolError(msg)) {
      // Kdyby to kupodivu prošlo, ukliď a označ jako informativní pass.
      await call('delete_category', { guid: KCODE, confirm: 'yes' });
      pass('create_category bez rodiče PROŠLO (root povolen?)', 'uklizeno');
    } else { fail('create_category hint', errText(msg)); }
  }

  // --- 9) low_stock vidí product-level stock ---------------------------------
  {
    const p = payload(await call('low_stock', { threshold: 5, limit: 50 }));
    const flagged = p?.flagged ?? [];
    if ((p?.products_with_stock_data ?? 0) > 0 && flagged.some((f) => f.guid === PCODE)) {
      pass('low_stock vidí product-level stock', `flagged ${PCODE} (stock 5 ≤ 5)`);
    } else { fail('low_stock', JSON.stringify({ with: p?.products_with_stock_data, flagged: flagged.length }).slice(0, 200)); }
  }

  // --- ÚKLID ------------------------------------------------------------------
  {
    if (voucherCodes.length > 0) {
      const msg = await call('delete_voucher', { codes: voucherCodes, confirm: 'yes' });
      if (!isToolError(msg)) pass('cleanup: voucher smazán');
      else fail('cleanup voucher', errText(msg));
    }
    if (createLogId) {
      const msg = await call('revert_write', { write_log_id: createLogId, confirm: 'yes' });
      if (!isToolError(msg)) pass('cleanup: produkt revertnut (smazán)');
      else fail('cleanup product', errText(msg));
      // Read-back: produkt už nesmí existovat (a chyba musí být "not found").
      const verify = await call('get_product', { guid: PCODE });
      if (isToolError(verify) && /not found/i.test(errText(verify))) {
        pass('cleanup verifikace: get_product → not found');
      } else { fail('cleanup verifikace', errText(verify)); }
    }
  }

  console.log('\n--- SOUHRN ---');
  const okCount = results.filter((r) => r.ok).length;
  console.log(`${okCount}/${results.length} OK`);
  if (okCount !== results.length) process.exitCode = 1;
}

try {
  await main();
} finally {
  // DB úklid: testovací shop/user/token (write_log/idempotency mají FK cascade).
  await sql`delete from oauth_access_tokens where id = ${tokenId}`;
  await sql`delete from shops where id = ${shopId}`;
  await sql`delete from users where id = ${userId}`;
  await sql.end();
}
