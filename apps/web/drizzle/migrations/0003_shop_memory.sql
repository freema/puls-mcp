CREATE TYPE "public"."memory_category" AS ENUM('preference', 'context', 'learned', 'instruction');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('user', 'ai_learned');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"system_context" text,
	"tool_contexts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shop_memory_shop_id_unique" UNIQUE("shop_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_memory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"category" "memory_category" DEFAULT 'context' NOT NULL,
	"source" "memory_source" DEFAULT 'user' NOT NULL,
	"label" text,
	"content" text NOT NULL,
	"applies_to_tools" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "memory_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_memory" ADD CONSTRAINT "shop_memory_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_memory_items" ADD CONSTRAINT "shop_memory_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
