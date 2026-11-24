CREATE TYPE "public"."write_log_status" AS ENUM('applied', 'reverted', 'failed');--> statement-breakpoint
CREATE TABLE "write_log" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"status" "write_log_status" DEFAULT 'applied' NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reverted_at" timestamp
);
--> statement-breakpoint
DROP TABLE "pending_writes" CASCADE;--> statement-breakpoint
ALTER TABLE "write_log" ADD CONSTRAINT "write_log_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "write_log_shop_created_idx" ON "write_log" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "write_log_status_idx" ON "write_log" USING btree ("status","created_at" DESC NULLS LAST);