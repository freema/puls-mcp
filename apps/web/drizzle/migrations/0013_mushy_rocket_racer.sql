CREATE TABLE "write_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"tool" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "write_idempotency" ADD CONSTRAINT "write_idempotency_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "write_idempotency_shop_key_idx" ON "write_idempotency" USING btree ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "write_idempotency_shop_created_idx" ON "write_idempotency" USING btree ("shop_id","created_at" DESC NULLS LAST);