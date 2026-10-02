CREATE TYPE "public"."actor_type" AS ENUM('user', 'import', 'system');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"diver_id" uuid NOT NULL,
	"manufacturer" text NOT NULL,
	"product" text,
	"serial_number" text NOT NULL,
	"firmware" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dive" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"diver_id" uuid NOT NULL,
	"number" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"utc_offset_seconds" integer,
	"duration_seconds" real NOT NULL,
	"max_depth_m" real,
	"avg_depth_m" real,
	"primary_recording_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "diver" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "diver_management" (
	"user_id" text NOT NULL,
	"diver_id" uuid NOT NULL,
	"is_own" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diver_management_user_id_diver_id_pk" PRIMARY KEY("user_id","diver_id")
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recording_id" uuid NOT NULL,
	"candidate_dive_ids" uuid[] NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"upload_name" text NOT NULL,
	"upload_sha256" text NOT NULL,
	"upload_storage_key" text,
	"outcome" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_original" (
	"import_id" uuid NOT NULL,
	"original_id" uuid NOT NULL,
	CONSTRAINT "import_original_import_id_original_id_pk" PRIMARY KEY("import_id","original_id")
);
--> statement-breakpoint
CREATE TABLE "original" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"file_name" text,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dive_id" uuid,
	"device_id" uuid,
	"original_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"recording_key" text NOT NULL,
	"parser" text NOT NULL,
	"parser_version" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"utc_offset_seconds" integer,
	"duration_seconds" real NOT NULL,
	"max_depth_m" real,
	"avg_depth_m" real,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recording_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recording_id" uuid NOT NULL,
	"offset_ms" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"cause" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample_series" (
	"recording_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"offsets_ms" integer[] NOT NULL,
	"values" real[] NOT NULL,
	CONSTRAINT "sample_series_recording_id_channel_pk" PRIMARY KEY("recording_id","channel")
);
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive" ADD CONSTRAINT "dive_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diver_management" ADD CONSTRAINT "diver_management_diver_id_diver_id_fk" FOREIGN KEY ("diver_id") REFERENCES "public"."diver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_original" ADD CONSTRAINT "import_original_import_id_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_original" ADD CONSTRAINT "import_original_original_id_original_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."original"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_dive_id_dive_id_fk" FOREIGN KEY ("dive_id") REFERENCES "public"."dive"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_original_id_original_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."original"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_import_id_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_event" ADD CONSTRAINT "recording_event_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_series" ADD CONSTRAINT "sample_series_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_serial_uq" ON "device" USING btree ("manufacturer","serial_number") WHERE "device"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "device_diver_idx" ON "device" USING btree ("diver_id");--> statement-breakpoint
CREATE INDEX "dive_diver_start_idx" ON "dive" USING btree ("diver_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "diver_management_own_uq" ON "diver_management" USING btree ("user_id") WHERE "diver_management"."is_own";--> statement-breakpoint
CREATE INDEX "import_user_idx" ON "import" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "original_user_sha_uq" ON "original" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_key_uq" ON "recording" USING btree ("recording_key") WHERE "recording"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "recording_dive_idx" ON "recording" USING btree ("dive_id");--> statement-breakpoint
CREATE INDEX "recording_original_idx" ON "recording" USING btree ("original_id");--> statement-breakpoint
CREATE INDEX "recording_event_recording_idx" ON "recording_event" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "revision_entity_idx" ON "revision" USING btree ("entity_type","entity_id");