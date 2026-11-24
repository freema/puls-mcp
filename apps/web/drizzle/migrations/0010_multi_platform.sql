-- 0010_multi_platform.sql
-- Multi-platform refactor (Shoptet -> + Upgates): platform discriminator,
-- generalizace identity shopu na (platform, platform_account_id), idempotency
-- a anti-freeride per platforma. Big-bang: legacy eshop_id sloupce se dropují
-- (pre-produkce). Backfill existujících Shoptet řádků proběhne PŘED dropem.

-- 1) platform enum
CREATE TYPE "public"."platform" AS ENUM('shoptet', 'upgates');
--> statement-breakpoint

-- 2) shops: nové sloupce (platform s defaultem kvůli backfillu existujících řádků)
ALTER TABLE "shops" ADD COLUMN "platform" "public"."platform" DEFAULT 'shoptet' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "platform_account_id" text;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "api_base_url" text;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "platform_api_login" text;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "platform_api_key" text;
--> statement-breakpoint

-- 3) BACKFILL existujících Shoptet řádků (před dropem legacy sloupců)
UPDATE "shops" SET
  "platform_account_id" = "eshop_id"::text,
  "api_base_url"        = "shoptet_api_base_url";
--> statement-breakpoint

-- 4) NOT NULL na platform_account_id až po backfillu
ALTER TABLE "shops" ALTER COLUMN "platform_account_id" SET NOT NULL;
--> statement-breakpoint

-- 5) drop legacy unique + legacy sloupce (žádná legacy cesta)
ALTER TABLE "shops" DROP CONSTRAINT IF EXISTS "shops_eshop_id_unique";
--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "eshop_id";
--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "shoptet_api_base_url";
--> statement-breakpoint

-- 6) webhook_signature_key nově nullable (Upgates ho nepoužívá)
ALTER TABLE "shops" ALTER COLUMN "webhook_signature_key" DROP NOT NULL;
--> statement-breakpoint

-- 7) nový unique identity (platform, platform_account_id)
CREATE UNIQUE INDEX "uniq_shops_platform_account" ON "shops" USING btree ("platform","platform_account_id");
--> statement-breakpoint

-- 8) tier_assignments: platform-aware + anti-freeride per platforma
ALTER TABLE "tier_assignments" ADD COLUMN "platform" "public"."platform" DEFAULT 'shoptet' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tier_assignments" ADD COLUMN "platform_account_id" text;
--> statement-breakpoint
UPDATE "tier_assignments" SET "platform_account_id" = "eshop_id"::text;
--> statement-breakpoint
ALTER TABLE "tier_assignments" ALTER COLUMN "platform_account_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tier_assignments_eshop_tier";
--> statement-breakpoint
ALTER TABLE "tier_assignments" DROP COLUMN "eshop_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tier_assignments_platform_account_trial" ON "tier_assignments" USING btree ("platform","platform_account_id") WHERE tier_id = 'trial';
--> statement-breakpoint

-- 9) webhook_notifications: platform + idempotency per platforma
ALTER TABLE "webhook_notifications" ADD COLUMN "platform" "public"."platform" DEFAULT 'shoptet' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_event_instance";
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_event_instance" ON "webhook_notifications" USING btree ("platform","event","event_instance");
