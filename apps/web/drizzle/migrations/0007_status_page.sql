CREATE TABLE IF NOT EXISTS "health_pings" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "component" text NOT NULL,
    "status" text NOT NULL,
    "latency_ms" integer,
    "error" text,
    "checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_pings_component_time_idx" ON "health_pings" ("component","checked_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_daily" (
    "day" date NOT NULL,
    "component" text NOT NULL,
    "uptime_pct" numeric(5,2) NOT NULL,
    "total_checks" integer NOT NULL,
    "down_checks" integer NOT NULL,
    PRIMARY KEY ("day","component")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
    "id" text PRIMARY KEY NOT NULL,
    "component" text NOT NULL,
    "title" text NOT NULL,
    "status" text NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "resolved_at" timestamp,
    "updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_by" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_active_idx" ON "incidents" ("status") WHERE status != 'resolved';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_started_idx" ON "incidents" ("started_at" DESC);
