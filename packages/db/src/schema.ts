import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const shopStatusEnum = pgEnum('shop_status', [
  'ACTIVE',
  'PAUSED',
  'UNINSTALLED',
]);

/** E-commerce platforma, ke které je shop připojen. Discriminator pro výběr connectoru. */
export const platformEnum = pgEnum('platform', ['shoptet', 'upgates']);

// ============================================
// Platform identity — JEDINÝ zdroj pravdy pro identitu platformy.
// Odvozeno z `platformEnum`, takže TS union nemůže driftovat od DB enumu.
// Místo holých string literálů ('shoptet'/'upgates') importuj odsud.
// Až vznikne `@puls/platform-core`, re-exportuje tyto
// symboly odsud — `@puls/db` zůstává Drizzle zdrojem pravdy.
// ============================================

/** Kanonický seznam platforem (readonly tuple), odvozený z pgEnum. */
export const PLATFORMS = platformEnum.enumValues;

/** Platform discriminator union — `'shoptet' | 'upgates'`. */
export type PlatformId = (typeof platformEnum.enumValues)[number];

/**
 * Pojmenované identifikátory platforem. Používej `PLATFORM.SHOPTET` /
 * `PLATFORM.UPGATES` místo magických stringů — autocomplete + jedno místo,
 * kde platformy přibývají. Vázáno na `PlatformId` přes `satisfies`.
 */
export const PLATFORM = {
  SHOPTET: 'shoptet',
  UPGATES: 'upgates',
} as const satisfies Record<string, PlatformId>;

/** Runtime guard — zúží libovolný string na `PlatformId`. */
export function isPlatform(value: unknown): value is PlatformId {
  return (
    typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
  );
}

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  /** Google OIDC subject (`sub`); links OAuth account to this user */
  googleSub: text('google_sub').unique(),
  /** BCP 47 short tag: 'cs' | 'sk' | 'hu' | 'en'. Null = no preference. */
  preferredLocale: text('preferred_locale'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const shops = pgTable(
  'shops',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /** Platform discriminator — určuje, který connector shop obsluhuje. */
    platform: platformEnum('platform').notNull().default('upgates'),

    /**
     * Identita účtu na dané platformě jako string. Shoptet = project.id
     * (číslo → text), Upgates = login/token z aktivačního payloadu doplňku.
     */
    platformAccountId: text('platform_account_id').notNull(),

    domain: text('domain').notNull().unique(),
    name: text('name'),
    adminEmail: text('admin_email'),
    status: shopStatusEnum('status').notNull().default('ACTIVE'),

    /** Install-level token (Shoptet OAuth token). Pro Upgates může zůstat placeholder. */
    oauthAccessToken: text('oauth_access_token').notNull(),
    /** Shoptet: HMAC-SHA1 webhook key. Upgates webhook auth jiný → nullable. */
    webhookSignatureKey: text('webhook_signature_key'),

    /** Generický base URL platformního API (Shoptet i dynamický Upgates apiUrl). */
    apiBaseUrl: text('api_base_url'),

    /** Upgates API login (apiUser z installation payloadu). Null pro Shoptet. */
    platformApiLogin: text('platform_api_login'),
    /** Upgates API key (apiKey z installation payloadu). Null pro Shoptet. */
    platformApiKey: text('platform_api_key'),

    mcpEndpointSecret: text('mcp_endpoint_secret').notNull().unique(),
    memoryEnabled: boolean('memory_enabled').notNull().default(false),
    /** Aktuální tier shopu. FK na pricing_tiers. */
    tierId: text('tier_id').notNull().default('trial'),
    /** Konec zkušebního období; null pokud shop není v trial tieru. */
    trialEndsAt: timestamp('trial_ends_at'),
    /** Kdy byl aktuální tier přiřazen. */
    tierAssignedAt: timestamp('tier_assigned_at').notNull().defaultNow(),
    installedAt: timestamp('installed_at').notNull().defaultNow(),
    uninstalledAt: timestamp('uninstalled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    /** Identita unikátní per platforma (ne globálně) — numerické ID smí kolidovat napříč platformami. */
    platformAccountUniq: uniqueIndex('uniq_shops_platform_account').on(
      t.platform,
      t.platformAccountId
    ),
  })
);

export const webhookNotifications = pgTable(
  'webhook_notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    shopId: text('shop_id').references(() => shops.id, {
      onDelete: 'set null',
    }),
    /** Platforma webhooku (denormalizováno — webhook může dorazit i pro neznámý/smazaný shop). */
    platform: platformEnum('platform').notNull().default('upgates'),
    event: text('event').notNull(),
    eventInstance: text('event_instance').notNull(),
    payload: jsonb('payload').notNull(),
    processed: boolean('processed').notNull().default(false),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (t) => ({
    /** Idempotency per platforma — stejná hodnota event_instance na dvou platformách nekoliduje. */
    uniqEventInstance: uniqueIndex('uniq_event_instance').on(
      t.platform,
      t.event,
      t.eventInstance
    ),
  })
);

export const apiTokenCache = pgTable('api_token_cache', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  shopId: text('shop_id')
    .notNull()
    .unique()
    .references(() => shops.id, { onDelete: 'cascade' }),
  accessToken: text('access_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================
// MCP OAuth 2.1 (RFC 6749 / 7591 / 7636 / 8414 / 9728)
// ============================================

/** Dynamic-client-registered MCP clients (Claude, Cursor, Inspector, …). */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  clientName: text('client_name').notNull(),
  /** JSON array of redirect URIs. */
  redirectUris: text('redirect_uris').notNull(),
  clientUri: text('client_uri'),
  logoUri: text('logo_uri'),
  scope: text('scope'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Short-lived state between /oauth/authorize and consent UI. */
export const oauthPendingSessions = pgTable('oauth_pending_sessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  mcpState: text('mcp_state').notNull().unique(),
  clientId: text('client_id'),
  clientState: text('client_state'),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Authorization codes issued after consent; SHA-256 hashed. */
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  /** SHA-256 hex of the actual code returned to the client. */
  codeHash: text('code_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  state: text('state'),
  scope: text('scope'),
  /** CSV of disabled tool category ids ("orders,customers"). Null = all enabled. */
  disabledTools: text('disabled_tools'),
  used: boolean('used').notNull().default(false),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Persistent log of every MCP tool invocation. */
export const mcpToolCalls = pgTable(
  'mcp_tool_calls',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    /** "ok" | "error" */
    status: text('status').notNull(),
    /** Wall-clock duration of the tool body, in ms. */
    durationMs: integer('duration_ms'),
    /** Sanitized input args (no secrets). */
    args: jsonb('args'),
    /** Error message when status="error", null otherwise. */
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  }
);

// ============================================
// Per-shop memory: lets the LLM remember preferences and learned context
// across MCP sessions. Compiled blob lives in shop_memory; individual
// items live in shop_memory_items for audit + targeted edits.
// ============================================

export const shopMemory = pgTable('shop_memory', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  shopId: text('shop_id')
    .notNull()
    .unique()
    .references(() => shops.id, { onDelete: 'cascade' }),
  /** Pre-rendered system context shown once per session. */
  systemContext: text('system_context'),
  /** Pre-rendered per-tool context blocks: { [toolName]: string }. */
  toolContexts: jsonb('tool_contexts').notNull().default({}),
  /** Bumped on every items mutation; drives in-memory cache invalidation. */
  promptVersion: integer('prompt_version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const memoryCategoryEnum = pgEnum('memory_category', [
  'preference',
  'context',
  'learned',
  'instruction',
]);

export const memorySourceEnum = pgEnum('memory_source', [
  'user',
  'ai_learned',
]);

export const shopMemoryItems = pgTable('shop_memory_items', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  category: memoryCategoryEnum('category').notNull().default('context'),
  source: memorySourceEnum('source').notNull().default('user'),
  label: text('label'),
  content: text('content').notNull(),
  /** Tool names this item should attach to. Null = global. */
  appliesToTools: jsonb('applies_to_tools'),
  priority: integer('priority').notNull().default(0),
  /** 0..1; null for user-set items. */
  confidence: integer('confidence'),
  usageCount: integer('usage_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Bearer access tokens; SHA-256 hashed. */
export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  /** SHA-256 hex of the actual bearer token. */
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  oauthClientId: text('oauth_client_id').references(() => oauthClients.id, {
    onDelete: 'set null',
  }),
  scope: text('scope'),
  /** CSV of disabled tool category ids; copied from the auth code at exchange time. */
  disabledTools: text('disabled_tools'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================
// Pricing tiers — spravované z administrace; ceník nahrazuje hardcoded data.
// ============================================

export const pricingTiers = pgTable('pricing_tiers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  priceMonthly: integer('price_monthly').notNull(),
  priceYearly: integer('price_yearly'),
  yearlyDiscountPct: integer('yearly_discount_pct').notNull().default(4),
  currency: text('currency').notNull().default('CZK'),

  callsPerDay: integer('calls_per_day').notNull(),
  /** -1 = bez limitu */
  maxMemoryItems: integer('max_memory_items').notNull(),
  activityRetentionDays: integer('activity_retention_days').notNull(),
  maxShopsPerAccount: integer('max_shops_per_account').notNull(),
  maxConcurrentSessions: integer('max_concurrent_sessions').notNull(),
  /** 'community' | 'email_48h' | 'priority_24h' */
  supportSla: text('support_sla').notNull(),

  /** Tool names odemčené tímto tierem (dnes prázdné, future-proof gate). */
  unlocksTools: jsonb('unlocks_tools').notNull().default([]),

  isTrial: boolean('is_trial').notNull().default(false),
  trialDays: integer('trial_days'),
  isAssignableOnInstall: boolean('is_assignable_on_install').notNull().default(false),

  features: jsonb('features').notNull().default([]),
  isPublic: boolean('is_public').notNull().default(true),
  isHighlighted: boolean('is_highlighted').notNull().default(false),
  badge: text('badge'),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Audit log všech tier přiřazení. Slouží pro:
 * 1) Anti-freeride: unique partial index na (platform, platform_account_id)
 *    WHERE tier_id = 'trial' blokuje druhé použití trialu pro stejný e-shop
 *    napříč instalacemi — izolovaně per platforma (numerický `42` na Shoptetu
 *    a string `42` na Upgates se nepotlučou).
 * 2) Účetní stopu při změnách plánu.
 */
export const tierAssignments = pgTable(
  'tier_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    shopId: text('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    /** Platforma — drží se i po smazání shopu. */
    platform: platformEnum('platform').notNull().default('upgates'),
    /** Duplikováno z shops.platformAccountId — drží se i po smazání shopu. */
    platformAccountId: text('platform_account_id').notNull(),
    tierId: text('tier_id').notNull(),
    /** 'install' | 'reinstall_no_trial' | 'upgrade' | 'downgrade' | 'admin_override' | 'trial_expired' | 'trial_extended' */
    reason: text('reason').notNull(),
    changedBy: text('changed_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    platformAccountTrialIdx: uniqueIndex(
      'idx_tier_assignments_platform_account_trial'
    )
      .on(t.platform, t.platformAccountId)
      .where(sql`tier_id = 'trial'`),
  })
);

/**
 * Audit log VŠECH provedených write akcí. AI zapisuje OKAMŽITĚ (synchronně v MCP
 * handleru); každý zápis se sem zaloguje s BEFORE/AFTER stavem cílového objektu.
 * Revert (MCP nástroj `revert_write` nebo tlačítko v dashboardu) obnoví `before`
 * stav a přepne status na 'reverted'. Žádná fronta, žádné schvalování.
 *
 * Statuses:
 *   applied  — zápis proběhl (happy path), lze revertovat
 *   reverted — zápis byl vrácen (before stav obnoven), revert už nejde
 *   failed   — zápis selhal (API chyba), revert nejde (nic se nezměnilo)
 */
export const writeLogStatusEnum = pgEnum('write_log_status', [
  'applied',
  'reverted',
  'failed',
]);

export const writeLog = pgTable(
  'write_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** Název MCP nástroje, např. 'update_product'. */
    tool: text('tool').notNull(),
    /** Vstupní argumenty nástroje (raw). */
    args: jsonb('args').notNull(),
    /** Stav cílového objektu PŘED zápisem (GET); null pokud objekt neexistoval (např. create_voucher). */
    before: jsonb('before'),
    /** Stav/výsledek PO zápisu. */
    after: jsonb('after'),
    status: writeLogStatusEnum('status').notNull().default('applied'),
    /** Výsledek z connectoru po provedení zápisu. */
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    revertedAt: timestamp('reverted_at'),
  },
  (table) => [
    index('write_log_shop_created_idx').on(
      table.shopId,
      table.createdAt.desc()
    ),
    index('write_log_status_idx').on(table.status, table.createdAt.desc()),
  ]
);

export type WriteLogRow = typeof writeLog.$inferSelect;
export type WriteLogInsert = typeof writeLog.$inferInsert;
export type WriteLogStatus = (typeof writeLogStatusEnum.enumValues)[number];

/**
 * Idempotence write nástrojů. Klíč = fingerprint nad VSTUPEM tool callu
 * (shop + tool + kanonické args bez `confirm`) — schválně nad vstupem, ne nad
 * resolved hodnotami, aby retry relativní operace (`adjustPercent`) měl stejný
 * klíč jako původní volání. Při retry v okně vrací uložený `result` místo
 * dalšího zápisu (chrání ceny/sklad před tichým dvojím zápisem po „connection
 * lost"). Záznam se UPSERTuje, takže záměrný repeat po expiraci okna se
 * zacachuje nově. Žije odděleně od `write_log` (ten zůstává per-item audit).
 */
export const writeIdempotency = pgTable(
  'write_idempotency',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** SHA-256 fingerprint nad (shopId, tool, kanonické args). */
    idempotencyKey: text('idempotency_key').notNull(),
    tool: text('tool').notNull(),
    /** Uložený úspěšný výsledek nástroje (payload toolOk, ne ToolTextContent obálka). */
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('write_idempotency_shop_key_idx').on(
      table.shopId,
      table.idempotencyKey
    ),
    index('write_idempotency_shop_created_idx').on(
      table.shopId,
      table.createdAt.desc()
    ),
  ]
);

export type WriteIdempotencyRow = typeof writeIdempotency.$inferSelect;

/**
 * Long-lived API keys for the public Admin API. Plain key is shown once
 * at creation; only the SHA-256 hash is stored. `keyPrefix` is the
 * leading non-secret slice used in UI lists.
 */
export const adminApiKeys = pgTable('admin_api_keys', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  label: text('label').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================
// Status page — health pings, daily rollup, incidents.
// Public /status read; admin CRUD pro incidenty.
// ============================================

export type HealthComponent = 'web' | 'mcp' | 'shoptet_api' | 'upgates_api';
export type HealthStatus = 'up' | 'down' | 'degraded';

export const healthPings = pgTable('health_pings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 'web' | 'mcp' | 'shoptet_api' | 'upgates_api' (string ne enum kvůli flex přidávání). */
  component: text('component').notNull(),
  /** 'up' | 'down' | 'degraded' */
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  checkedAt: timestamp('checked_at').notNull().defaultNow(),
});

/**
 * Per-day per-component rollup. Public /status čte odsud pro 30d historii
 * (tečkový strip), nikdy ne přímo z `health_pings`.
 */
export const healthDaily = pgTable(
  'health_daily',
  {
    day: date('day').notNull(),
    component: text('component').notNull(),
    /** 0.00 – 100.00 */
    uptimePct: numeric('uptime_pct', { precision: 5, scale: 2 }).notNull(),
    totalChecks: integer('total_checks').notNull(),
    downChecks: integer('down_checks').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.day, t.component] }),
  })
);

export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved';

// ============================================
// Prompt galerie — public-readable, login-gated use, admin-managed.
// ============================================

export const promptCategories = pgTable('prompt_categories', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** lucide-react icon name */
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const prompts = pgTable('prompts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  /** 1-věta hook pro card */
  summary: text('summary').notNull(),
  /** Markdown body — vlastní prompt */
  body: text('body').notNull(),
  categoryId: text('category_id').references(() => promptCategories.id, {
    onDelete: 'set null',
  }),
  /** ["list_orders", ...] */
  requiredTools: jsonb('required_tools').notNull().default([]),
  /** ["orders","write",...] consent kategorie */
  requiredConsent: jsonb('required_consent').notNull().default([]),
  /** Null = dostupné všem (i trial) */
  minTier: text('min_tier').references(() => pricingTiers.id, {
    onDelete: 'set null',
  }),
  /** 'easy' | 'medium' | 'advanced' */
  difficulty: text('difficulty').notNull().default('easy'),
  estMinutes: integer('est_minutes'),
  isPublished: boolean('is_published').notNull().default(false),
  isFeatured: boolean('is_featured').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  views: integer('views').notNull().default(0),
  uses: integer('uses').notNull().default(0),
  authorId: text('author_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  archivedAt: timestamp('archived_at'),
});

export const promptUses = pgTable('prompt_uses', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  promptId: text('prompt_id')
    .notNull()
    .references(() => prompts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: text('shop_id').references(() => shops.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const incidents = pgTable('incidents', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  /** komponenta nebo 'multi' */
  component: text('component').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  /** [{ ts, status, message }] markdown timeline */
  updates: jsonb('updates').notNull().default([]),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================
// Feedback loop — uživatel (přes AI klienta) pošle feedback nástrojem
// `submit_feedback`; admin ho čte v /admin/feedback a staví z něj další featury.
// Není to zápis do e-shopu, jen do našeho systému → vždy dostupné (i v trialu).
// ============================================

/** Druh feedbacku — co AI z konverzace s uživatelem zachytila. */
export const feedbackTypeEnum = pgEnum('feedback_type', [
  'feature_request',
  'bug',
  'praise',
  'missing_tool',
  'other',
]);

/** Tón feedbacku (pomáhá adminovi prioritizovat). */
export const feedbackSentimentEnum = pgEnum('feedback_sentiment', [
  'positive',
  'neutral',
  'negative',
]);

/** Triage pipeline, ze které stavíme roadmapu. */
export const feedbackStatusEnum = pgEnum('feedback_status', [
  'new',
  'triaged',
  'planned',
  'done',
  'declined',
]);

export const feedback = pgTable(
  'feedback',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    /** Shop, ze kterého feedback přišel. Set-null aby feedback přežil odinstalaci. */
    shopId: text('shop_id').references(() => shops.id, {
      onDelete: 'set null',
    }),
    /** Denormalizovaná doména shopu — drží atribuci i po smazání shopu. */
    shopDomain: text('shop_domain'),
    type: feedbackTypeEnum('type').notNull().default('other'),
    sentiment: feedbackSentimentEnum('sentiment'),
    /** Vlastní text feedbacku (AI shrnuje záměr uživatele jeho slovy). */
    message: text('message').notNull(),
    /** Co uživatel dělal / kontext, proč to vzniklo. */
    context: text('context'),
    /** Jméno MCP klienta (Claude, Cursor, …), pokud ho server zná. */
    source: text('source'),
    status: feedbackStatusEnum('status').notNull().default('new'),
    /** Interní poznámka admina při triage. */
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('feedback_status_created_idx').on(t.status, t.createdAt.desc()),
    index('feedback_shop_created_idx').on(t.shopId, t.createdAt.desc()),
  ]
);

export type FeedbackRow = typeof feedback.$inferSelect;
export type FeedbackInsert = typeof feedback.$inferInsert;
export type FeedbackType = (typeof feedbackTypeEnum.enumValues)[number];
export type FeedbackStatus = (typeof feedbackStatusEnum.enumValues)[number];
export type FeedbackSentiment = (typeof feedbackSentimentEnum.enumValues)[number];
