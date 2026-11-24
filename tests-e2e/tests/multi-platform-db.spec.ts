import { expect, test } from '@playwright/test';
import pg from 'pg';
import { installShopViaApi } from '../helpers/install';

/**
 * DB-vrstvový smoke test multi-platform schématu (task 04, sekce 4.2).
 *
 * Ověřuje, že migrace `0010_multi_platform` unese OBĚ platformy a že identity
 * constrainty drží přesně tak, jak schéma předepisuje — nezávisle na aplikačním
 * connectoru ani Upgates install flow (ten je task 03/05). Upgates řádek se
 * proto vkládá přímo přes `pg` jako raw schema smoke test.
 *
 * Ověřuje:
 *  1. Shoptet install (přes API) → řádek s platform='shoptet' a neprázdným
 *     platform_account_id.
 *  2. Upgates řádek se STEJNÝM platform_account_id, ale platform='upgates' →
 *     vloží se bez konfliktu (unique je per (platform, platform_account_id),
 *     ne globální na účet → numerické ID smí kolidovat napříč platformami).
 *  3. Duplicitní (platform, platform_account_id) → insert selže (nový unique
 *     index uniq_shops_platform_account).
 *  4. api_base_url uložitelný (dynamický Upgates apiUrl), webhook_signature_key
 *     smí být NULL pro Upgates řádek (uvolnění NOT NULL).
 *  5. platform_api_login / platform_api_key uložitelné (Basic-auth credentials
 *     z aktivačního payloadu).
 */
test.describe('multi-platform DB schema', () => {
  test('schéma unese Shoptet i Upgates shop pod stejným account-id', async () => {
    const baseUrl = process.env.BASE_URL_WEB;
    if (!baseUrl) throw new Error('BASE_URL_WEB missing');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL missing');

    // 1) Shoptet install přes API.
    const { shopId: shoptetShopId } = await installShopViaApi({
      baseUrl,
      databaseUrl: dbUrl,
    });

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const shoptetRow = await client.query<{
        platform: string;
        platformAccountId: string;
      }>(
        `select platform, platform_account_id as "platformAccountId"
           from shops where id = $1`,
        [shoptetShopId]
      );
      expect(shoptetRow.rows[0]?.platform).toBe('shoptet');
      const accountId = shoptetRow.rows[0]?.platformAccountId;
      expect(accountId).toBeTruthy();

      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const upgatesShopId = `upg_${suffix}`;
      const upgatesDomain = `db-smoke-${suffix}.upgates.cz`;
      const apiBaseUrl = 'http://mock-upgates:4011';

      // 2) Upgates řádek se STEJNÝM platform_account_id jako Shoptet shop, ale
      //    platform='upgates'. webhook_signature_key = NULL (Upgates ho nepoužívá),
      //    api_base_url + platform_api_login/key naplněné.
      await client.query(
        `insert into shops (
           id, platform, platform_account_id, domain,
           status, oauth_access_token, webhook_signature_key, api_base_url,
           platform_api_login, platform_api_key, mcp_endpoint_secret,
           tier_id, trial_ends_at
         ) values (
           $1, 'upgates', $2, $3,
           'ACTIVE', 'upgates-no-oauth', NULL, $4,
           'mock-api-user', 'mock-api-key', $5,
           'trial', now() + interval '14 days'
         )`,
        [
          upgatesShopId,
          accountId, // stejné jako Shoptet → nesmí kolidovat (jiná platforma)
          upgatesDomain,
          apiBaseUrl,
          `mcp-${suffix}`,
        ]
      );

      // Ověř, že Upgates řádek je tam s NULL signature key + uloženými credentials.
      const upgatesRow = await client.query<{
        webhookSignatureKey: string | null;
        apiBaseUrl: string | null;
        platformApiLogin: string | null;
        platformApiKey: string | null;
      }>(
        `select webhook_signature_key as "webhookSignatureKey",
                api_base_url          as "apiBaseUrl",
                platform_api_login    as "platformApiLogin",
                platform_api_key      as "platformApiKey"
           from shops where id = $1`,
        [upgatesShopId]
      );
      expect(upgatesRow.rows[0]?.webhookSignatureKey).toBeNull();
      expect(upgatesRow.rows[0]?.apiBaseUrl).toBe(apiBaseUrl);
      expect(upgatesRow.rows[0]?.platformApiLogin).toBe('mock-api-user');
      expect(upgatesRow.rows[0]?.platformApiKey).toBe('mock-api-key');

      // Potvrď, že obě platformy sdílí jeden platform_account_id (kolize povolena).
      const collision = await client.query<{ count: string }>(
        `select count(*)::text as count
           from shops where platform_account_id = $1`,
        [accountId]
      );
      expect(Number(collision.rows[0]?.count)).toBe(2);

      // 3) Duplicitní (upgates, stejný account_id) → unique violation.
      let duplicateRejected = false;
      try {
        await client.query(
          `insert into shops (
             id, platform, platform_account_id, domain,
             status, oauth_access_token, webhook_signature_key, api_base_url,
             mcp_endpoint_secret, tier_id
           ) values (
             $1, 'upgates', $2, $3,
             'ACTIVE', 'upgates-no-oauth', NULL, $4,
             $5, 'trial'
           )`,
          [
            `upg_dup_${suffix}`,
            accountId,
            `dup-${upgatesDomain}`,
            apiBaseUrl,
            `mcp-dup-${suffix}`,
          ]
        );
      } catch (err) {
        // 23505 = unique_violation
        duplicateRejected = (err as { code?: string }).code === '23505';
      }
      expect(duplicateRejected).toBe(true);
    } finally {
      await client.end();
    }
  });
});
