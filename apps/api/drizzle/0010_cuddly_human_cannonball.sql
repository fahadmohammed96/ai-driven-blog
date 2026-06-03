CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_email" text NOT NULL,
	"customer_name" text,
	"channel" text DEFAULT 'email' NOT NULL,
	"request" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"proposal" text,
	"deposit_cents" integer,
	"currency" text DEFAULT 'eur' NOT NULL,
	"payment_ref" text,
	"portal_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "leads_portal_token_unique" UNIQUE("portal_token")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leads"
	USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);