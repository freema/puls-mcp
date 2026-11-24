import { expect, test } from '@playwright/test';
import pg from 'pg';

/**
 * DB-vrstvový test anti-freeride trial gatingu per platforma (task 04, sekce 4.3).
 *
 * Po migraci 0010 je partial unique index `idx_tier_assignments_platform_account_trial`
 * na `(platform, platform_account_id) WHERE tier_id = 'trial'`. Trial se tedy
 * blokuje per platforma — string `42` na Shoptetu a string `42` na Upgates
 * se NEpotlučou, ale dvojí trial pro tutéž (platform, account) ano.
 *
 * Test je ZÁMĚRNĚ čistě DB-vrstvový (raw `pg`, žádný install flow): ověřuje
 * pouze chování partial unique indexu. Nepoužívá sdílený install helper —
 * Shoptet Prism mock vrací pevné `project.id=123`, takže každý install se přes
 * upsert v `persistInstall` slévá do JEDNOHO sdíleného shop řádku (account "123").
 * Spoléhat na to, že je takový shop čerstvě 'trial', je závislé na pořadí testů
 * (jiný spec ho přepne na 'business'/'starter' a re-install tier nerotuje). Proto
 * tu používáme VLASTNÍ unikátní `platform_account_id` per běh — test je tak
 * deterministický a izolovaný od ostatních specs.
 *
 * Ověřuje:
 *  1. Vložení (platform='shoptet', account=X, tier_id='trial') projde.
 *  2. (platform='upgates', account=X, tier_id='trial') se STEJNÝM X → projde
 *     (jiná platforma; partial unique nedrží napříč platformami).
 *  3. Druhý pokus o trial pro (shoptet, X) → unique violation (anti-freeride
 *     pro Shoptet pořád drží).
 */
test.describe('anti-freeride trial gating per platform', () => {
  test('trial unique drží per (platform, account), ne globálně na account', async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL missing');

    // Unikátní account id per běh → izolace od sdíleného mock shopu "123"
    // i od ostatních specs běžících proti téže DB.
    const accountId = `af_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // 1) (shoptet, X, trial) → projde (první trial pro tento účet).
      await client.query(
        `insert into tier_assignments (id, platform, platform_account_id, tier_id, reason)
         values ($1, 'shoptet', $2, 'trial', 'install')`,
        [`ta_sho_${accountId}`, accountId]
      );

      const shoptetTrial = await client.query<{ count: string }>(
        `select count(*)::text as count
           from tier_assignments
          where platform = 'shoptet'
            and platform_account_id = $1
            and tier_id = 'trial'`,
        [accountId]
      );
      expect(Number(shoptetTrial.rows[0]?.count)).toBe(1);

      // 2) (upgates, X, trial) se STEJNÝM X → projde (jiná platforma).
      await client.query(
        `insert into tier_assignments (id, platform, platform_account_id, tier_id, reason)
         values ($1, 'upgates', $2, 'trial', 'install')`,
        [`ta_upg_${accountId}`, accountId]
      );

      // 3) Druhý (shoptet, X, trial) → unique violation (anti-freeride drží).
      let shoptetTrialRejected = false;
      try {
        await client.query(
          `insert into tier_assignments (id, platform, platform_account_id, tier_id, reason)
           values ($1, 'shoptet', $2, 'trial', 'install')`,
          [`ta_sho2_${accountId}`, accountId]
        );
      } catch (err) {
        // 23505 = unique_violation
        shoptetTrialRejected = (err as { code?: string }).code === '23505';
      }
      expect(shoptetTrialRejected).toBe(true);
    } finally {
      await client.end();
    }
  });
});
