-- 0011_prompt_tools_neutral
-- Multi-platform follow-up (tasks/upgates/05): MCP nástroje přešly z `shoptet_*`
-- na platformně neutrální jména (`list_orders`, `sales_summary`, …).
-- Prompt gallery seedovaná v 0008 ale drží stará jména v `required_tools`
-- i v textech promptů zobrazovaných zákazníkům na /prompts/:slug.
-- Data-only migrace: strhne prefix `shoptet_` v required_tools a v body/summary.

UPDATE "prompts"
SET "required_tools" = (
    SELECT COALESCE(
        jsonb_agg(
            CASE
                WHEN elem LIKE 'shoptet\_%' ESCAPE '\'
                    THEN to_jsonb(substring(elem FROM 9))
                ELSE to_jsonb(elem)
            END
            ORDER BY ord
        ),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text("required_tools") WITH ORDINALITY AS t(elem, ord)
)
WHERE "required_tools"::text ~ 'shoptet_';
--> statement-breakpoint
UPDATE "prompts"
SET "body" = regexp_replace("body", 'shoptet_([a-z_]+)', '\1', 'g')
WHERE "body" ~ 'shoptet_[a-z_]+';
--> statement-breakpoint
UPDATE "prompts"
SET "summary" = regexp_replace("summary", 'shoptet_([a-z_]+)', '\1', 'g')
WHERE "summary" ~ 'shoptet_[a-z_]+';
