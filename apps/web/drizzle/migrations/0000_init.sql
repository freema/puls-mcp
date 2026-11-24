CREATE TYPE "public"."shop_status" AS ENUM('ACTIVE', 'PAUSED', 'UNINSTALLED');--> statement-breakpoint
CREATE TABLE "api_token_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"access_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_cache_shop_id_unique" UNIQUE("shop_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"oauth_client_id" text,
	"scope" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"client_id" text,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"state" text,
	"scope" text,
	"used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"client_uri" text,
	"logo_uri" text,
	"scope" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_pending_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"mcp_state" text NOT NULL,
	"client_id" text,
	"client_state" text,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"scope" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_pending_sessions_mcp_state_unique" UNIQUE("mcp_state")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"eshop_id" integer NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"admin_email" text,
	"status" "shop_status" DEFAULT 'ACTIVE' NOT NULL,
	"oauth_access_token" text NOT NULL,
	"webhook_signature_key" text NOT NULL,
	"shoptet_api_base_url" text,
	"mcp_endpoint_secret" text NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shops_eshop_id_unique" UNIQUE("eshop_id"),
	CONSTRAINT "shops_domain_unique" UNIQUE("domain"),
	CONSTRAINT "shops_mcp_endpoint_secret_unique" UNIQUE("mcp_endpoint_secret")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"google_sub" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "webhook_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text,
	"event" text NOT NULL,
	"event_instance" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "api_token_cache" ADD CONSTRAINT "api_token_cache_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_notifications" ADD CONSTRAINT "webhook_notifications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_event_instance" ON "webhook_notifications" USING btree ("event","event_instance");