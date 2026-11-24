CREATE TABLE IF NOT EXISTS "pending_writes" (
    "id" text PRIMARY KEY NOT NULL,
    "shop_id" text NOT NULL,
    "tool" text NOT NULL,
    "args" jsonb NOT NULL,
    "preview" jsonb,
    "status" text DEFAULT 'pending' NOT NULL,
    "requested_by_session" text,
    "reviewed_by" text,
    "reviewed_at" timestamp,
    "executed_at" timestamp,
    "result" jsonb,
    "error" text,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "pending_writes"
        ADD CONSTRAINT "pending_writes_shop_id_shops_id_fk"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_writes_shop_status_idx" ON "pending_writes" ("shop_id","status","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_writes_status_idx" ON "pending_writes" ("status","created_at" DESC);
