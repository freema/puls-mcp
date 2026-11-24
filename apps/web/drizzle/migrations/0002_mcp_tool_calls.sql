CREATE TABLE IF NOT EXISTS "mcp_tool_calls" (
    "id" text PRIMARY KEY NOT NULL,
    "shop_id" text NOT NULL,
    "tool" text NOT NULL,
    "status" text NOT NULL,
    "duration_ms" integer,
    "args" jsonb,
    "error_message" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "mcp_tool_calls"
        ADD CONSTRAINT "mcp_tool_calls_shop_id_shops_id_fk"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tool_calls_created_at_idx" ON "mcp_tool_calls" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tool_calls_shop_created_idx" ON "mcp_tool_calls" ("shop_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tool_calls_tool_idx" ON "mcp_tool_calls" ("tool");
