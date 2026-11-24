CREATE TYPE "public"."feedback_sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'planned', 'done', 'declined');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('feature_request', 'bug', 'praise', 'missing_tool', 'other');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text,
	"shop_domain" text,
	"type" "feedback_type" DEFAULT 'other' NOT NULL,
	"sentiment" "feedback_sentiment",
	"message" text NOT NULL,
	"context" text,
	"source" text,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "platform" SET DEFAULT 'upgates';--> statement-breakpoint
ALTER TABLE "tier_assignments" ALTER COLUMN "platform" SET DEFAULT 'upgates';--> statement-breakpoint
ALTER TABLE "webhook_notifications" ALTER COLUMN "platform" SET DEFAULT 'upgates';--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_created_idx" ON "feedback" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_shop_created_idx" ON "feedback" USING btree ("shop_id","created_at" DESC NULLS LAST);