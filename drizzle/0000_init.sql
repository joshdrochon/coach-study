CREATE TABLE "api_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"usd" real NOT NULL,
	"trace_id" text
);
--> statement-breakpoint
CREATE TABLE "auth_lockouts" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"results" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_states" (
	"item_id" text PRIMARY KEY NOT NULL,
	"card" jsonb NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"reps" integer NOT NULL,
	"lapses" integer NOT NULL,
	"event_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" numeric(14, 6) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"item_id" text,
	"practice_id" uuid,
	"gate_id" text,
	"note" text DEFAULT '' NOT NULL,
	"regrade" jsonb,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"flag_id" uuid
);
--> statement-breakpoint
CREATE TABLE "eval_case_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"flag_id" uuid,
	"item_id" text NOT NULL,
	"card" jsonb NOT NULL,
	"words" text NOT NULL,
	"words_from" text NOT NULL,
	"entry" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"first_result" text NOT NULL,
	"opus_model" text NOT NULL,
	"opus_result" text NOT NULL,
	"opus_reason" text NOT NULL,
	"opus_trace_id" text,
	"answered_at" timestamp with time zone NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected" text,
	"expected_reason" text,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set" text NOT NULL,
	"grader" text NOT NULL,
	"strategy" text NOT NULL,
	"rubric" text NOT NULL,
	"commit" text NOT NULL,
	"cases" integer NOT NULL,
	"agreement" real NOT NULL,
	"false_passes" integer NOT NULL,
	"categories" jsonb NOT NULL,
	"cost_usd" real NOT NULL,
	"passed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_results" (
	"practice_id" uuid NOT NULL,
	"gate_id" text NOT NULL,
	"verdict" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_flags" (
	"item_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"seq" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"cards_left" integer NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "practice_phases" (
	"practice_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"coaching_sha" text NOT NULL,
	"silence_ms" integer NOT NULL,
	"gates" jsonb NOT NULL,
	"answer" jsonb,
	"trace_id" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"scene_kind" text NOT NULL,
	"scene" jsonb NOT NULL,
	"transcript" jsonb NOT NULL,
	"self_review" jsonb,
	"grade" jsonb,
	"passed" boolean,
	"graded_by" text,
	"trace_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"title" text DEFAULT 'Starter' NOT NULL,
	"practice_sessions_done" integer DEFAULT 0 NOT NULL,
	"practice_classes_done" integer DEFAULT 0 NOT NULL,
	"avatar_jpeg_base64" text,
	"first_run_at" timestamp with time zone,
	"welcomed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_epoch" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"item_id" text NOT NULL,
	"mode" text NOT NULL,
	"result" text NOT NULL,
	"rating" integer NOT NULL,
	"proposed_rating" integer NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"answer_text" text DEFAULT '' NOT NULL,
	"answer_ms" integer NOT NULL,
	"hint_used" boolean DEFAULT false NOT NULL,
	"hint_imposed" boolean DEFAULT false NOT NULL,
	"format" text DEFAULT 'free' NOT NULL,
	"graded_by" text NOT NULL,
	"trace_id" text,
	"reviewed_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_date" date NOT NULL,
	"went_well" text NOT NULL,
	"to_work_on" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_ms" integer,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"steps" jsonb NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tts_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"voice_key" text NOT NULL,
	"chars" integer NOT NULL,
	"audio" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"user_agent" text NOT NULL,
	"sentences_total" integer NOT NULL,
	"sentences_heard" integer NOT NULL,
	"key_terms_total" integer NOT NULL,
	"key_terms_missed" integer NOT NULL,
	"error_rate" real NOT NULL,
	"read_aloud_worked" boolean NOT NULL,
	"stalls" integer NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_spend_scope_day" ON "api_spend" USING btree ("scope","day");--> statement-breakpoint
CREATE INDEX "card_states_due" ON "card_states" USING btree ("due");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_flag_id" ON "disputes" USING btree ("flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_drafts_dispute" ON "eval_case_drafts" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "eval_case_drafts_status" ON "eval_case_drafts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_set_time" ON "eval_runs" USING btree ("set","run_at");--> statement-breakpoint
CREATE INDEX "gate_results_gate" ON "gate_results" USING btree ("gate_id");--> statement-breakpoint
CREATE INDEX "gate_results_practice" ON "gate_results" USING btree ("practice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nudges_day_seq" ON "nudges" USING btree ("day","seq");--> statement-breakpoint
CREATE INDEX "nudges_created" ON "nudges" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "practice_phases_started" ON "practice_phases" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "practices_done" ON "practices" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "review_events_item" ON "review_events" USING btree ("item_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_events_received" ON "review_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "traces_started" ON "traces" USING btree ("started_at");