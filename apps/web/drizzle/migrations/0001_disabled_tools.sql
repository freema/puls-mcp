ALTER TABLE "oauth_authorization_codes" ADD COLUMN IF NOT EXISTS "disabled_tools" text;
--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN IF NOT EXISTS "disabled_tools" text;
