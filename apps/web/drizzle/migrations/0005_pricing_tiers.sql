CREATE TABLE IF NOT EXISTS "pricing_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"price_monthly" integer NOT NULL,
	"price_yearly" integer,
	"yearly_discount_pct" integer DEFAULT 4 NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"calls_per_day" integer NOT NULL,
	"max_memory_items" integer NOT NULL,
	"activity_retention_days" integer NOT NULL,
	"max_shops_per_account" integer NOT NULL,
	"max_concurrent_sessions" integer NOT NULL,
	"support_sla" text NOT NULL,
	"unlocks_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"trial_days" integer,
	"is_assignable_on_install" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_highlighted" boolean DEFAULT false NOT NULL,
	"badge" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tier_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text,
	"eshop_id" integer NOT NULL,
	"tier_id" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tier_assignments" ADD CONSTRAINT "tier_assignments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tier_assignments_eshop_tier" ON "tier_assignments" ("eshop_id", "tier_id") WHERE tier_id = 'trial';
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tier_id" text DEFAULT 'trial' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tier_assigned_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
INSERT INTO "pricing_tiers" (
	"id", "name", "tagline", "price_monthly", "price_yearly", "yearly_discount_pct",
	"calls_per_day", "max_memory_items", "activity_retention_days",
	"max_shops_per_account", "max_concurrent_sessions", "support_sla",
	"is_trial", "trial_days", "is_assignable_on_install",
	"features", "is_public", "is_highlighted", "badge", "sort_order"
) VALUES
(
	'trial', 'Trial', '14 dní zdarma po instalaci, jednorázově na e-shop.',
	0, NULL, 4,
	200, 20, 7, 1, 1, 'community',
	true, 14, true,
	'["Plný přístup ke všem nástrojům","200 volání / den","20 paměťových položek","7denní historie volání","Community podpora"]'::jsonb,
	false, false, NULL, 0
),
(
	'starter', 'Starter', 'Pro malé e-shopy s občasným AI použitím.',
	249, 2868, 4,
	500, 50, 7, 1, 2, 'community',
	false, NULL, false,
	'["Plný přístup ke všem nástrojům","500 volání / den","50 paměťových položek","7denní historie","Community podpora"]'::jsonb,
	true, false, NULL, 1
),
(
	'pro', 'Pro', 'Pro e-shopy s denní AI prací.',
	499, 5748, 4,
	2000, 500, 30, 3, 5, 'email_48h',
	false, NULL, false,
	'["Plný přístup ke všem nástrojům","2 000 volání / den","500 paměťových položek","30denní historie","Až 3 e-shopy / účet","Email podpora do 48 h"]'::jsonb,
	true, true, 'Nejoblíbenější', 2
),
(
	'business', 'Business', 'Pro agentury a větší e-shopy.',
	990, 11412, 4,
	10000, -1, 90, 10, 20, 'priority_24h',
	false, NULL, false,
	'["Plný přístup ke všem nástrojům","10 000 volání / den","Neomezená paměť","90denní historie","Až 10 e-shopů / účet","Priority support do 24 h"]'::jsonb,
	true, false, NULL, 3
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_tier_id_pricing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pricing_tiers"("id") ON DELETE no action ON UPDATE no action;
