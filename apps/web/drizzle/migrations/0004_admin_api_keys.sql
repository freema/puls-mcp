CREATE TABLE IF NOT EXISTS "admin_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "admin_api_keys" ADD CONSTRAINT "admin_api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
