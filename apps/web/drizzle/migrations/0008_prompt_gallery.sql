CREATE TABLE IF NOT EXISTS "prompt_categories" (
    "id" text PRIMARY KEY NOT NULL,
    "slug" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "icon" text,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "prompt_categories_slug_unique" UNIQUE ("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompts" (
    "id" text PRIMARY KEY NOT NULL,
    "slug" text NOT NULL,
    "title" text NOT NULL,
    "summary" text NOT NULL,
    "body" text NOT NULL,
    "category_id" text,
    "required_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "required_consent" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "min_tier" text,
    "difficulty" text DEFAULT 'easy' NOT NULL,
    "est_minutes" integer,
    "is_published" boolean DEFAULT false NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "views" integer DEFAULT 0 NOT NULL,
    "uses" integer DEFAULT 0 NOT NULL,
    "author_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "archived_at" timestamp,
    CONSTRAINT "prompts_slug_unique" UNIQUE ("slug")
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "prompts"
        ADD CONSTRAINT "prompts_category_id_prompt_categories_id_fk"
        FOREIGN KEY ("category_id") REFERENCES "prompt_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "prompts"
        ADD CONSTRAINT "prompts_min_tier_pricing_tiers_id_fk"
        FOREIGN KEY ("min_tier") REFERENCES "pricing_tiers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_published_idx" ON "prompts" ("is_published","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_category_idx" ON "prompts" ("category_id","is_published");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_uses" (
    "id" text PRIMARY KEY NOT NULL,
    "prompt_id" text NOT NULL,
    "user_id" text NOT NULL,
    "shop_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "prompt_uses"
        ADD CONSTRAINT "prompt_uses_prompt_id_prompts_id_fk"
        FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "prompt_uses"
        ADD CONSTRAINT "prompt_uses_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "prompt_uses"
        ADD CONSTRAINT "prompt_uses_shop_id_shops_id_fk"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_uses_prompt_idx" ON "prompt_uses" ("prompt_id","created_at" DESC);
--> statement-breakpoint
INSERT INTO "prompt_categories" ("id", "slug", "name", "description", "icon", "sort_order") VALUES
('cat_sales', 'sales', 'Prodej', 'Objednávky, sales reporty, top produkty.', 'TrendingUp', 1),
('cat_catalog', 'catalog', 'Katalog', 'Produkty, sklad, ceny, popisky.', 'Package', 2),
('cat_customers', 'customer-care', 'Zákaznická péče', 'Zákazníci, fakturace, retence.', 'Users', 3),
('cat_reporting', 'reporting', 'Reporting', 'Obraty, AOV, kategorie, trendy.', 'BarChart3', 4),
('cat_marketing', 'marketing', 'Marketing', 'Cross-sell, segmentace, akce.', 'Megaphone', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "prompts" (
    "id", "slug", "title", "summary", "body", "category_id",
    "required_tools", "required_consent", "min_tier",
    "difficulty", "est_minutes", "is_published", "is_featured", "sort_order"
) VALUES
('prm_sales_week', 'sales-za-posledni-tyden', 'Sales za poslední týden',
 'Souhrn objednávek, obratu a top produktů za posledních 7 dní.',
 E'Spočítej za posledních 7 dní:\n\n- celkový počet objednávek\n- celkový obrat (s DPH)\n- průměrnou hodnotu objednávky (AOV)\n- top 5 produktů podle obratu\n\nPoužij `shoptet_sales_summary` a `shoptet_list_orders`. Výsledky podej v markdown tabulce.',
 'cat_sales',
 '["shoptet_sales_summary","shoptet_list_orders"]'::jsonb,
 '["orders","insights"]'::jsonb,
 NULL, 'easy', 5, true, true, 1),

('prm_top_products_month', 'top-10-produktu-tento-mesic', 'Top 10 produktů tento měsíc',
 'Žebříček nejprodávanějších produktů v aktuálním kalendářním měsíci.',
 E'Najdi top 10 produktů tento měsíc podle obratu (s DPH). U každého ukaž:\n\n- název\n- počet prodaných kusů\n- celkový obrat\n\nDoporuč 1–2 produkty na akci na základě skladových zásob.',
 'cat_sales',
 '["shoptet_sales_summary","shoptet_list_orders"]'::jsonb,
 '["orders","products","insights"]'::jsonb,
 NULL, 'easy', 5, true, false, 2),

('prm_low_stock', 'najdi-produkty-pod-skladem-5-ks', 'Najdi produkty pod skladem 5 ks',
 'Seznam aktivních produktů s nízkými zásobami pro doobjednání.',
 E'Najdi všechny aktivní produkty (visible=true), které mají na hlavním skladu méně než 5 ks. Seřaď podle obratu za posledních 30 dní (sestupně) — chci vidět, které doobjednat jako první.',
 'cat_catalog',
 '["shoptet_list_products","shoptet_list_stocks"]'::jsonb,
 '["products"]'::jsonb,
 NULL, 'medium', 8, true, false, 1),

('prm_no_description', 'produkty-bez-popisu', 'Produkty bez popisu',
 'Aktivní produkty s prázdným nebo příliš krátkým popisem.',
 E'Najdi aktivní produkty (visible=true) s popisem kratším než 100 znaků (nebo prázdným). Vrať seznam jako CSV: code, název, délka popisu, URL v adminu Shoptetu.',
 'cat_catalog',
 '["shoptet_list_products","shoptet_get_product"]'::jsonb,
 '["products"]'::jsonb,
 'starter', 'easy', 5, true, false, 2),

('prm_unpaid_invoices', 'zakaznici-s-np-fakturou-starsi-14-dni', 'Zákazníci s nezaplacenou fakturou starší 14 dní',
 'Připomenutí zákazníkům, kteří nezaplatili fakturu déle než 14 dní.',
 E'Najdi objednávky se statusem "vystavená faktura" / "neuhrazeno", kterým je víc než 14 dní. Pro každého zákazníka shrň: jméno, e-mail, kód objednávky, částka, počet dní po splatnosti. Připrav text upomínky v češtině (slušný tón).',
 'cat_customers',
 '["shoptet_list_orders","shoptet_get_customer"]'::jsonb,
 '["orders","customers"]'::jsonb,
 NULL, 'medium', 8, true, true, 1),

('prm_vip_customers', 'vip-zakaznici-za-posledni-kvartal', 'VIP zákazníci za poslední kvartál',
 'Top zákazníci podle utracené částky za poslední 3 měsíce.',
 E'Vyber TOP 20 zákazníků za posledních 90 dní podle součtu objednávek (s DPH). Vrať jméno, e-mail, počet objednávek, celkový obrat. Navrhni krátký personalizovaný děkovací e-mail (CZ).',
 'cat_customers',
 '["shoptet_list_orders","shoptet_list_customers"]'::jsonb,
 '["orders","customers","insights"]'::jsonb,
 'starter', 'medium', 10, true, false, 2),

('prm_monthly_revenue', 'mesicni-obrat-per-kategorie', 'Měsíční obrat per kategorie',
 'Rozpad obratu po hlavních kategoriích za aktuální měsíc.',
 E'Spočítej obrat za aktuální měsíc rozpadlý po hlavních kategoriích. Vrať tabulku: kategorie, počet objednávek, obrat, podíl na celkovém obratu (%).',
 'cat_reporting',
 '["shoptet_sales_summary","shoptet_list_categories"]'::jsonb,
 '["orders","catalog","insights"]'::jsonb,
 NULL, 'easy', 5, true, false, 1),

('prm_aov_trend', 'aov-trend-poslednich-90-dni', 'AOV trend posledních 90 dní',
 'Vývoj průměrné hodnoty objednávky (AOV) po týdnech.',
 E'Spočítej AOV (average order value) po týdnech za posledních 90 dní. Vrať tabulku týden / počet objednávek / AOV / meziměsíční změna v %.',
 'cat_reporting',
 '["shoptet_sales_summary"]'::jsonb,
 '["orders","insights"]'::jsonb,
 'pro', 'medium', 10, true, false, 2),

('prm_cross_sell', 'kdo-si-naposledy-koupil-x', 'Kdo si naposledy koupil produkt X',
 'Seznam zákazníků pro cross-sell kampaň podle dříve nakoupeného produktu.',
 E'Najdi všechny zákazníky, kteří v posledních 6 měsících nakoupili konkrétní produkt (zadám ti `code` nebo `guid`). Vrať jméno, e-mail, datum poslední objednávky a navrhni produkt na cross-sell na základě sortimentu.',
 'cat_marketing',
 '["shoptet_list_orders","shoptet_get_product","shoptet_list_customers"]'::jsonb,
 '["orders","customers","products"]'::jsonb,
 'starter', 'medium', 12, true, false, 1)
ON CONFLICT ("id") DO NOTHING;
