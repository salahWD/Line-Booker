CREATE TYPE "public"."appointment_status" AS ENUM('held', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'expired');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'LBP');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('deposit', 'full');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('customer', 'internal', 'shared');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('otp', 'hold_created', 'appointment_confirmed', 'payment_submitted', 'payment_rejected', 'hold_expired', 'appointment_cancelled', 'reminder', 'ticket_created', 'turn_approaching', 'your_turn');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('not_required', 'unpaid', 'awaiting_verification', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."priority_group" AS ENUM('appointment', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."queue_policy" AS ENUM('fifo', 'booked_first', 'interleave');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('platform_admin', 'business_owner', 'branch_operator', 'customer');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ticket_source" AS ENUM('walk_in', 'appointment');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('waiting', 'called', 'completed', 'skipped', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_user_id" integer,
	"business_id" integer,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" integer,
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branch_holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"branch_id" integer NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	CONSTRAINT "branch_holidays_branch_date_uq" UNIQUE("branch_id","date")
);
--> statement-breakpoint
CREATE TABLE "branch_hours" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branch_hours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"branch_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	CONSTRAINT "branch_hours_weekday" CHECK ("branch_hours"."weekday" between 1 and 7),
	CONSTRAINT "branch_hours_order" CHECK ("branch_hours"."close_time" > "branch_hours"."open_time")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"address" text,
	"phone" varchar(20),
	"timezone" varchar(64) DEFAULT 'Asia/Beirut' NOT NULL,
	"fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"fee_type" "fee_type" DEFAULT 'deposit' NOT NULL,
	"hold_minutes" integer,
	"min_notice_minutes" integer DEFAULT 60 NOT NULL,
	"booking_window_days" integer DEFAULT 30 NOT NULL,
	"cancellation_cutoff_hours" integer DEFAULT 24 NOT NULL,
	"allow_reschedule" boolean DEFAULT true NOT NULL,
	"cancellation_policy_text" text,
	"display_token" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_slug_unique" UNIQUE("slug"),
	CONSTRAINT "branches_displayToken_unique" UNIQUE("display_token"),
	CONSTRAINT "branches_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "branches_fee_non_negative" CHECK ("branches"."fee_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "businesses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" varchar(80) NOT NULL,
	"phone" varchar(20),
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "operator_branches" (
	"user_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	CONSTRAINT "operator_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "otp_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"phone" varchar(20) NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"whish_payment_url" text,
	"payment_instructions" text,
	"default_hold_minutes" integer DEFAULT 30 NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role" "user_role" NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" varchar(20),
	"email" varchar(160),
	"password_hash" text,
	"business_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_business_matches_role" CHECK (("users"."role" in ('business_owner', 'branch_operator')) = ("users"."business_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "appointment_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"appointment_id" integer NOT NULL,
	"type" varchar(40) NOT NULL,
	"actor_user_id" integer,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointment_slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"local_time" time NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"capacity" smallint DEFAULT 1 NOT NULL,
	"reserved_count" smallint DEFAULT 0 NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_line_start_uq" UNIQUE("line_id","starts_at"),
	CONSTRAINT "slots_capacity_positive" CHECK ("appointment_slots"."capacity" >= 1),
	CONSTRAINT "slots_reserved_non_negative" CHECK ("appointment_slots"."reserved_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reference" varchar(12) NOT NULL,
	"slot_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"local_time" time NOT NULL,
	"status" "appointment_status" DEFAULT 'held' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"amount_due" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"payment_status" "payment_status" NOT NULL,
	"payment_confirmed_by_id" integer,
	"payment_confirmed_at" timestamp with time zone,
	"customer_note" text,
	"cancel_reason" text,
	"cancelled_by_id" integer,
	"cancelled_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "line_pauses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "line_pauses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"line_id" integer NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_at" timestamp with time zone,
	"paused_by_id" integer,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"code_prefix" varchar(3) DEFAULT 'A' NOT NULL,
	"avg_minutes_per_customer" integer DEFAULT 10 NOT NULL,
	"counters_count" smallint DEFAULT 1 NOT NULL,
	"queue_policy" "queue_policy" DEFAULT 'interleave' NOT NULL,
	"interleave_ratio" smallint DEFAULT 2 NOT NULL,
	"late_grace_minutes" integer DEFAULT 10 NOT NULL,
	"checkin_open_minutes" integer DEFAULT 60 NOT NULL,
	"allow_remote_join" boolean DEFAULT true NOT NULL,
	"default_alert_lead_minutes" integer DEFAULT 15 NOT NULL,
	"alert_ahead_threshold" smallint DEFAULT 2 NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"display_token" varchar(64) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lines_displayToken_unique" UNIQUE("display_token"),
	CONSTRAINT "lines_id_branch_business_uq" UNIQUE("id","branch_id","business_id"),
	CONSTRAINT "lines_avg_minutes" CHECK ("lines"."avg_minutes_per_customer" between 1 and 240),
	CONSTRAINT "lines_counters" CHECK ("lines"."counters_count" between 1 and 50),
	CONSTRAINT "lines_ratio" CHECK ("lines"."interleave_ratio" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"appointment_id" integer,
	"ticket_id" integer,
	"author_id" integer NOT NULL,
	"kind" "note_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_one_target" CHECK (num_nonnulls("notes"."appointment_id", "notes"."ticket_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"appointment_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"transaction_ref" varchar(80) NOT NULL,
	"proof_path" text,
	"proof_mime" varchar(60),
	"proof_size" integer,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_counters" (
	"line_id" integer NOT NULL,
	"service_date" date NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "queue_counters_line_id_service_date_pk" PRIMARY KEY("line_id","service_date")
);
--> statement-breakpoint
CREATE TABLE "queue_tickets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "queue_tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"service_date" date NOT NULL,
	"number" integer NOT NULL,
	"display_code" varchar(12) NOT NULL,
	"source" "ticket_source" NOT NULL,
	"appointment_id" integer,
	"customer_id" integer,
	"guest_name" text,
	"phone" varchar(20),
	"priority_group" "priority_group" NOT NULL,
	"sort_at" timestamp with time zone NOT NULL,
	"status" "ticket_status" DEFAULT 'waiting' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_called_at" timestamp with time zone,
	"last_called_at" timestamp with time zone,
	"recall_count" smallint DEFAULT 0 NOT NULL,
	"counter_label" varchar(40),
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"tracking_token" varchar(64) NOT NULL,
	"alert_lead_minutes" smallint,
	"approach_alerted_at" timestamp with time zone,
	"estimate_low_min" integer,
	"estimate_high_min" integer,
	"estimate_method" varchar(12),
	"actual_wait_seconds" integer,
	"created_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_tickets_trackingToken_unique" UNIQUE("tracking_token"),
	CONSTRAINT "tickets_line_day_number_uq" UNIQUE("line_id","service_date","number")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"appointment_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"owner_reply" text,
	"replied_by_id" integer,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_appointmentId_unique" UNIQUE("appointment_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" "notification_channel" NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"user_id" integer,
	"to_phone" varchar(20),
	"title" text,
	"body" text NOT NULL,
	"secret_body" text,
	"link" text,
	"fallback_phone" varchar(20),
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider" varchar(20),
	"provider_message_id" varchar(120),
	"last_error" text,
	"appointment_id" integer,
	"ticket_id" integer,
	"enqueued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_holidays" ADD CONSTRAINT "branch_holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_branches" ADD CONSTRAINT "operator_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_branches" ADD CONSTRAINT "operator_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_line_id_branch_id_business_id_lines_id_branch_id_business_id_fk" FOREIGN KEY ("line_id","branch_id","business_id") REFERENCES "public"."lines"("id","branch_id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_appointment_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."appointment_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_payment_confirmed_by_id_users_id_fk" FOREIGN KEY ("payment_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_line_id_branch_id_business_id_lines_id_branch_id_business_id_fk" FOREIGN KEY ("line_id","branch_id","business_id") REFERENCES "public"."lines"("id","branch_id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_pauses" ADD CONSTRAINT "line_pauses_line_id_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_pauses" ADD CONSTRAINT "line_pauses_paused_by_id_users_id_fk" FOREIGN KEY ("paused_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_branch_id_business_id_branches_id_business_id_fk" FOREIGN KEY ("branch_id","business_id") REFERENCES "public"."branches"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_ticket_id_queue_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."queue_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_counters" ADD CONSTRAINT "queue_counters_line_id_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_line_id_branch_id_business_id_lines_id_branch_id_business_id_fk" FOREIGN KEY ("line_id","branch_id","business_id") REFERENCES "public"."lines"("id","branch_id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_line_id_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_replied_by_id_users_id_fk" FOREIGN KEY ("replied_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_queue_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."queue_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_business_id_created_at_index" ON "audit_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_index" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "branch_hours_branch_id_index" ON "branch_hours" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "branches_business_id_index" ON "branches" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_created_at_index" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "users_business_id_index" ON "users" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "appointment_events_appointment_id_index" ON "appointment_events" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_slots_line_id_local_date_index" ON "appointment_slots" USING btree ("line_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_one_active_per_day" ON "appointments" USING btree ("customer_id","line_id","local_date") WHERE "appointments"."status" in ('held', 'confirmed', 'checked_in');--> statement-breakpoint
CREATE INDEX "appointments_branch_id_local_date_index" ON "appointments" USING btree ("branch_id","local_date");--> statement-breakpoint
CREATE INDEX "appointments_status_hold_expires_at_index" ON "appointments" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_id_index" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "line_pauses_line_id_paused_at_index" ON "line_pauses" USING btree ("line_id","paused_at");--> statement-breakpoint
CREATE INDEX "lines_branch_id_index" ON "lines" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "notes_appointment_id_index" ON "notes" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "notes_ticket_id_index" ON "notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_one_pending" ON "payment_submissions" USING btree ("appointment_id") WHERE "payment_submissions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_submissions_status_created_at_index" ON "payment_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_active_per_appointment" ON "queue_tickets" USING btree ("appointment_id") WHERE "queue_tickets"."status" in ('waiting', 'called') and "queue_tickets"."appointment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_active_per_customer" ON "queue_tickets" USING btree ("line_id","customer_id") WHERE "queue_tickets"."status" in ('waiting', 'called') and "queue_tickets"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "queue_tickets_line_id_status_index" ON "queue_tickets" USING btree ("line_id","status");--> statement-breakpoint
CREATE INDEX "queue_tickets_line_id_service_date_index" ON "queue_tickets" USING btree ("line_id","service_date");--> statement-breakpoint
CREATE INDEX "queue_tickets_customer_id_index" ON "queue_tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reviews_branch_id_index" ON "reviews" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "notifications_status_created_at_index" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_ticket_id_index" ON "notifications" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "notifications_appointment_id_index" ON "notifications" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_index" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "push_tokens_user_id_index" ON "push_tokens" USING btree ("user_id");