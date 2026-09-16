-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('SALON_AND_BARBER', 'OTHER');

-- CreateEnum
CREATE TYPE "PrepaymentMode" AS ENUM ('NONE', 'PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "BookingState" AS ENUM ('PAYMENT_PENDING', 'CONFIRMED', 'REJECTED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'TELEBIRR_MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "BookingComponentType" AS ENUM ('SERVICE', 'VARIATION', 'ADD_ON');

-- CreateEnum
CREATE TYPE "SlotLockState" AS ENUM ('LOCKED', 'ALLOCATED', 'RELEASED');

-- CreateEnum
CREATE TYPE "SpecialDateKind" AS ENUM ('CLOSED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ScheduleVersionStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE', 'TRIAL', 'TRIAL_GRACE', 'ACTIVE', 'PAID_GRACE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionReviewState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionReminderKind" AS ENUM ('TRIAL_ENDING', 'SUBSCRIPTION_ENDING', 'SUBSCRIPTION_EXPIRED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'CUSTOMER', 'OWNER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "TelegramConnectionKind" AS ENUM ('BUSINESS_OWNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "TelegramConnectionState" AS ENUM ('PENDING_VERIFICATION', 'CONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "NotificationDeliveryState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTERED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('CUSTOMER_PROOF', 'SUBSCRIPTION_PROOF', 'LOGO', 'COVER', 'REPORT_PDF');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_category" (
    "code" VARCHAR(32) NOT NULL,
    "label" VARCHAR(128) NOT NULL,

    CONSTRAINT "business_category_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "business" (
    "id" UUID NOT NULL,
    "public_slug" VARCHAR(64) NOT NULL,
    "category_code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "logo_file_id" UUID,
    "cover_file_id" UUID,
    "description" VARCHAR(2000),
    "address" VARCHAR(400),
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "phone_public" VARCHAR(32),
    "deactivated_at" TIMESTAMPTZ(6),
    "active_schedule_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_owner" (
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_owner_pkey" PRIMARY KEY ("business_id","user_id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "business_id" UUID NOT NULL,
    "booking_interval_minutes" INTEGER NOT NULL,
    "prepayment_mode" "PrepaymentMode" NOT NULL DEFAULT 'NONE',
    "prepayment_percent" INTEGER,
    "prepayment_fixed_minor" BIGINT,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "pause_message" VARCHAR(400),
    "reopen_at" TIMESTAMPTZ(6),
    "pause_updated_at" TIMESTAMPTZ(6),
    "warning_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "base_price_minor" BIGINT NOT NULL,
    "base_duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_variation" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "price_delta_minor" BIGINT NOT NULL,
    "duration_delta_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_on" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "price_delta_minor" BIGINT NOT NULL,
    "duration_delta_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "add_on_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_version" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "ScheduleVersionStatus" NOT NULL DEFAULT 'PENDING',
    "name" VARCHAR(200),
    "applied_at" TIMESTAMPTZ(6),
    "applied_by" UUID,
    "reason" VARCHAR(2000),
    "auto_reason" VARCHAR(2000),
    "replaced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_period" (
    "id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "working_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_period" (
    "id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "day_of_week" SMALLINT,
    "start_minutes" INTEGER,
    "end_minutes" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_date" (
    "id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "SpecialDateKind" NOT NULL,
    "start_minutes" INTEGER,
    "end_minutes" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_date_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exception" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" SERIAL NOT NULL,
    "business_id" UUID NOT NULL,
    "status" "BookingState" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "customer_name" VARCHAR(160) NOT NULL,
    "customer_phone" VARCHAR(32) NOT NULL,
    "note" VARCHAR(800),
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_component" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID,
    "component_type" "BookingComponentType" NOT NULL,
    "name_snapshot" VARCHAR(160) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "BookingState",
    "to_status" "BookingState" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(800),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resubmission_verification" (
    "id" UUID NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "business_id" UUID NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "resubmission_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_lock" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "booking_id" INTEGER,
    "slot_date" DATE NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "state" "SlotLockState" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    "released_by" UUID,

    CONSTRAINT "slot_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "status" "PaymentState" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "prepaid_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proof" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "file_object_id" UUID,
    "submission_key" VARCHAR(128) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_by_proof_id" UUID,

    CONSTRAINT "payment_proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_status_history" (
    "id" SERIAL NOT NULL,
    "payment_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "PaymentState",
    "to_status" "PaymentState" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(800),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_connection" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "user_id" UUID,
    "chat_id" BIGINT NOT NULL,
    "kind" "TelegramConnectionKind" NOT NULL,
    "state" "TelegramConnectionState" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "telegram_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_update" (
    "update_id" BIGINT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_update_pkey" PRIMARY KEY ("update_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "type" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "recipient_type" VARCHAR(32) NOT NULL,
    "recipient_ref" VARCHAR(128) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "state" "NotificationDeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "payload_ref" VARCHAR(200),
    "sent_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "trial_started_at" TIMESTAMPTZ(6),
    "trial_ends_at" TIMESTAMPTZ(6),
    "trial_grace_ends_at" TIMESTAMPTZ(6),
    "period_ends_at" TIMESTAMPTZ(6),
    "paid_grace_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_proof" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "review_state" "SubscriptionReviewState" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" VARCHAR(800),
    "approved_until" TIMESTAMPTZ(6),
    "file_object_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_reminder" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "SubscriptionReminderKind" NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_status_history" (
    "id" SERIAL NOT NULL,
    "subscription_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "SubscriptionStatus",
    "to_status" "SubscriptionStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(800),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_object" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "category" "FileCategory" NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "uploaded_by" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_event" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "business_id" UUID,
    "type" VARCHAR(64) NOT NULL,
    "ip" VARCHAR(64),
    "device" VARCHAR(200),
    "browser" VARCHAR(200),
    "result" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" VARCHAR(32),
    "action" VARCHAR(64) NOT NULL,
    "business_id" UUID,
    "detail" VARCHAR(4000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_job" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "requester_user_id" UUID,
    "scope_ref" VARCHAR(400),
    "state" VARCHAR(32) NOT NULL,
    "file_object_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "business_public_slug_key" ON "business"("public_slug");

-- CreateIndex
CREATE INDEX "business_category_code_idx" ON "business"("category_code");

-- CreateIndex
CREATE INDEX "business_deactivated_at_idx" ON "business"("deactivated_at");

-- CreateIndex
CREATE INDEX "business_owner_user_id_idx" ON "business_owner"("user_id");

-- CreateIndex
CREATE INDEX "service_business_id_is_active_idx" ON "service"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "service_variation_service_id_is_active_idx" ON "service_variation"("service_id", "is_active");

-- CreateIndex
CREATE INDEX "service_variation_business_id_idx" ON "service_variation"("business_id");

-- CreateIndex
CREATE INDEX "add_on_service_id_is_active_idx" ON "add_on"("service_id", "is_active");

-- CreateIndex
CREATE INDEX "add_on_business_id_idx" ON "add_on"("business_id");

-- CreateIndex
CREATE INDEX "schedule_version_business_id_status_idx" ON "schedule_version"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_version_business_id_version_no_key" ON "schedule_version"("business_id", "version_no");

-- CreateIndex
CREATE INDEX "working_period_schedule_version_id_weekday_idx" ON "working_period"("schedule_version_id", "weekday");

-- CreateIndex
CREATE INDEX "working_period_business_id_idx" ON "working_period"("business_id");

-- CreateIndex
CREATE INDEX "blocked_period_schedule_version_id_idx" ON "blocked_period"("schedule_version_id");

-- CreateIndex
CREATE INDEX "blocked_period_business_id_idx" ON "blocked_period"("business_id");

-- CreateIndex
CREATE INDEX "special_date_business_id_idx" ON "special_date"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "special_date_schedule_version_id_date_key" ON "special_date"("schedule_version_id", "date");

-- CreateIndex
CREATE INDEX "schedule_exception_schedule_version_id_idx" ON "schedule_exception"("schedule_version_id");

-- CreateIndex
CREATE INDEX "schedule_exception_business_id_idx" ON "schedule_exception"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_exception_booking_id_schedule_version_id_key" ON "schedule_exception"("booking_id", "schedule_version_id");

-- CreateIndex
CREATE INDEX "booking_business_id_start_at_idx" ON "booking"("business_id", "start_at");

-- CreateIndex
CREATE INDEX "booking_business_id_status_idx" ON "booking"("business_id", "status");

-- CreateIndex
CREATE INDEX "booking_business_id_customer_phone_idx" ON "booking"("business_id", "customer_phone");

-- CreateIndex
CREATE INDEX "booking_component_booking_id_idx" ON "booking_component"("booking_id");

-- CreateIndex
CREATE INDEX "booking_component_business_id_idx" ON "booking_component"("business_id");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_occurred_at_idx" ON "booking_status_history"("booking_id", "occurred_at");

-- CreateIndex
CREATE INDEX "booking_status_history_business_id_occurred_at_idx" ON "booking_status_history"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "resubmission_verification_booking_id_idx" ON "resubmission_verification"("booking_id");

-- CreateIndex
CREATE INDEX "resubmission_verification_phone_used_at_idx" ON "resubmission_verification"("phone", "used_at");

-- CreateIndex
CREATE INDEX "slot_lock_business_id_slot_date_idx" ON "slot_lock"("business_id", "slot_date");

-- CreateIndex
CREATE INDEX "slot_lock_booking_id_idx" ON "slot_lock"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_booking_id_key" ON "payment"("booking_id");

-- CreateIndex
CREATE INDEX "payment_business_id_status_idx" ON "payment"("business_id", "status");

-- CreateIndex
CREATE INDEX "payment_business_id_created_at_idx" ON "payment"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proof_submission_key_key" ON "payment_proof"("submission_key");

-- CreateIndex
CREATE INDEX "payment_proof_payment_id_submitted_at_idx" ON "payment_proof"("payment_id", "submitted_at");

-- CreateIndex
CREATE INDEX "payment_proof_business_id_submitted_at_idx" ON "payment_proof"("business_id", "submitted_at");

-- CreateIndex
CREATE INDEX "payment_status_history_payment_id_occurred_at_idx" ON "payment_status_history"("payment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_status_history_business_id_occurred_at_idx" ON "payment_status_history"("business_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connection_chat_id_key" ON "telegram_connection"("chat_id");

-- CreateIndex
CREATE INDEX "telegram_connection_business_id_state_idx" ON "telegram_connection"("business_id", "state");

-- CreateIndex
CREATE INDEX "notification_business_id_created_at_idx" ON "notification"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_idempotency_key_key" ON "notification_delivery"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_delivery_state_next_attempt_at_idx" ON "notification_delivery"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_delivery_notification_id_idx" ON "notification_delivery"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_business_id_key" ON "subscription"("business_id");

-- CreateIndex
CREATE INDEX "subscription_proof_business_id_review_state_idx" ON "subscription_proof"("business_id", "review_state");

-- CreateIndex
CREATE INDEX "subscription_proof_review_state_created_at_idx" ON "subscription_proof"("review_state", "created_at");

-- CreateIndex
CREATE INDEX "subscription_reminder_subscription_id_idx" ON "subscription_reminder"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_reminder_business_id_kind_key" ON "subscription_reminder"("business_id", "kind");

-- CreateIndex
CREATE INDEX "subscription_status_history_subscription_id_occurred_at_idx" ON "subscription_status_history"("subscription_id", "occurred_at");

-- CreateIndex
CREATE INDEX "subscription_status_history_business_id_occurred_at_idx" ON "subscription_status_history"("business_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_object_storage_key_key" ON "file_object"("storage_key");

-- CreateIndex
CREATE INDEX "file_object_business_id_category_idx" ON "file_object"("business_id", "category");

-- CreateIndex
CREATE INDEX "security_event_user_id_created_at_idx" ON "security_event"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_event_business_id_created_at_idx" ON "security_event"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "security_event_type_created_at_idx" ON "security_event"("type", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_business_id_created_at_idx" ON "audit_event"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_created_at_idx" ON "audit_event"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_action_created_at_idx" ON "audit_event"("action", "created_at");

-- CreateIndex
CREATE INDEX "report_job_business_id_created_at_idx" ON "report_job"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "report_job_state_created_at_idx" ON "report_job"("state", "created_at");

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "business_category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_active_schedule_version_id_fkey" FOREIGN KEY ("active_schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_owner" ADD CONSTRAINT "business_owner_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_owner" ADD CONSTRAINT "business_owner_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_variation" ADD CONSTRAINT "service_variation_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_variation" ADD CONSTRAINT "service_variation_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on" ADD CONSTRAINT "add_on_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on" ADD CONSTRAINT "add_on_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_period" ADD CONSTRAINT "working_period_schedule_version_id_fkey" FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_period" ADD CONSTRAINT "working_period_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_schedule_version_id_fkey" FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_date" ADD CONSTRAINT "special_date_schedule_version_id_fkey" FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_date" ADD CONSTRAINT "special_date_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_schedule_version_id_fkey" FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_component" ADD CONSTRAINT "booking_component_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_component" ADD CONSTRAINT "booking_component_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_component" ADD CONSTRAINT "booking_component_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resubmission_verification" ADD CONSTRAINT "resubmission_verification_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resubmission_verification" ADD CONSTRAINT "resubmission_verification_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_replaced_by_proof_id_fkey" FOREIGN KEY ("replaced_by_proof_id") REFERENCES "payment_proof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_connection" ADD CONSTRAINT "telegram_connection_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_proof" ADD CONSTRAINT "subscription_proof_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_proof" ADD CONSTRAINT "subscription_proof_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_reminder" ADD CONSTRAINT "subscription_reminder_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_reminder" ADD CONSTRAINT "subscription_reminder_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_status_history" ADD CONSTRAINT "subscription_status_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_status_history" ADD CONSTRAINT "subscription_status_history_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-augmented guarantees (Prompt 40; architecture doc 07 §2/§3, doc 08):
--  1. Partial unique indexes (defense-in-depth — Prisma has no partial-index
--     support, so these live only in SQL).
--  2. CHECK constraints for DB-enforced invariants (Prisma cannot model these).
--  3. 'app' role grants (migrator owns DDL; runtime 'app' role operates under
--     RLS — doc 07 §1/§4). ALTER DEFAULT PRIVILEGES keeps future tables usable.
-- ===========================================================================

-- Only ONE active slot lock per exact slot identity (REQ-121; doc 07 §3).
-- Overlap of *different* windows is prevented at the application layer
-- (advisory lock + in-transaction overlap re-check, doc 08).
CREATE UNIQUE INDEX "uq_slot_lock_active"
  ON "slot_lock"("business_id", "slot_date", "start_at")
  WHERE "state" IN ('LOCKED', 'ALLOCATED');

-- At most one ACTIVE schedule version per business (doc 07 §2).
CREATE UNIQUE INDEX "uq_active_schedule_version"
  ON "schedule_version"("business_id")
  WHERE "status" = 'ACTIVE';

-- Case-insensitive uniqueness for slug (REQ-047) and email is achieved by
-- storing lowercase (citext is not representable in Prisma; documented).
ALTER TABLE "business" ADD CONSTRAINT "business_public_slug_lowercase" CHECK ("public_slug" = lower("public_slug"));
ALTER TABLE "user" ADD CONSTRAINT "user_email_lowercase" CHECK ("email" = lower("email"));

-- Minute precision + temporal sanity for user-facing scheduling times
-- (REQ-226: seconds not stored; doc 07 §3).
ALTER TABLE "booking" ADD CONSTRAINT "booking_start_minute_precision" CHECK (extract(second from "start_at") = 0 AND extract(millisecond from "start_at") = 0);
ALTER TABLE "booking" ADD CONSTRAINT "booking_end_minute_precision" CHECK (extract(second from "end_at") = 0 AND extract(millisecond from "end_at") = 0);
ALTER TABLE "booking" ADD CONSTRAINT "booking_start_before_end" CHECK ("start_at" < "end_at");
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_start_minute_precision" CHECK (extract(second from "start_at") = 0 AND extract(millisecond from "start_at") = 0);
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_end_minute_precision" CHECK (extract(second from "end_at") = 0 AND extract(millisecond from "end_at") = 0);
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_start_before_end" CHECK ("start_at" < "end_at");
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_released_correlation" CHECK (("state" = 'RELEASED') = ("released_at" IS NOT NULL));

-- Money is stored as exact integer minor units (doc 07; ADR-002): never negative.
ALTER TABLE "service" ADD CONSTRAINT "service_base_price_nonnegative" CHECK ("base_price_minor" >= 0);
ALTER TABLE "service" ADD CONSTRAINT "service_base_duration_positive" CHECK ("base_duration_minutes" > 0);
ALTER TABLE "booking_component" ADD CONSTRAINT "booking_component_unit_price_nonnegative" CHECK ("unit_price_minor" >= 0);
ALTER TABLE "booking_component" ADD CONSTRAINT "booking_component_duration_positive" CHECK ("duration_minutes" > 0);
ALTER TABLE "payment" ADD CONSTRAINT "payment_prepaid_nonnegative" CHECK ("prepaid_minor" >= 0);

-- Prepayment configuration consistency (REQ-111: percentage OR fixed, never both).
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_percent_range" CHECK ("prepayment_percent" IS NULL OR ("prepayment_percent" BETWEEN 1 AND 100));
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_fixed_nonnegative" CHECK ("prepayment_fixed_minor" IS NULL OR "prepayment_fixed_minor" >= 0);
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_prepayment_mode" CHECK (
  ("prepayment_mode" = 'NONE' AND "prepayment_percent" IS NULL AND "prepayment_fixed_minor" IS NULL)
  OR ("prepayment_mode" = 'PERCENTAGE' AND "prepayment_percent" IS NOT NULL AND "prepayment_fixed_minor" IS NULL)
  OR ("prepayment_mode" = 'FIXED' AND "prepayment_percent" IS NULL AND "prepayment_fixed_minor" IS NOT NULL)
);
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_booking_interval_positive" CHECK ("booking_interval_minutes" > 0);

-- Schedule shapes respect weekday/hour bounds (doc 07 §2).
ALTER TABLE "working_period" ADD CONSTRAINT "working_period_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "working_period" ADD CONSTRAINT "working_period_minutes_bounds" CHECK ("start_minutes" >= 0 AND "end_minutes" > "start_minutes" AND "end_minutes" <= 1440);
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_weekday_range" CHECK ("day_of_week" IS NULL OR ("day_of_week" BETWEEN 1 AND 7));
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_minutes_bounds" CHECK ("start_minutes" IS NULL OR ("start_minutes" >= 0 AND "end_minutes" IS NOT NULL AND "end_minutes" > "start_minutes" AND "end_minutes" <= 1440));
ALTER TABLE "special_date" ADD CONSTRAINT "special_date_minutes_bounds" CHECK ("start_minutes" IS NULL OR ("start_minutes" >= 0 AND "end_minutes" IS NOT NULL AND "end_minutes" > "start_minutes" AND "end_minutes" <= 1440));

-- Subscription proof bookkeeping (REQ-138: rejection reason required).
ALTER TABLE "subscription_proof" ADD CONSTRAINT "subscription_proof_rejection_reason" CHECK ("review_state" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);
ALTER TABLE "subscription_proof" ADD CONSTRAINT "subscription_proof_approved_until" CHECK ("review_state" = 'APPROVED' OR "approved_until" IS NULL);

-- History rows never record a no-op transition (REQ-173 append-only).
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_noop" CHECK ("from_status" IS NULL OR "from_status" <> "to_status");
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_noop" CHECK ("from_status" IS NULL OR "from_status" <> "to_status");

-- Attempt counters are never negative.
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_attempts_nonnegative" CHECK ("attempts" >= 0);
ALTER TABLE "resubmission_verification" ADD CONSTRAINT "resubmission_verification_attempts_nonnegative" CHECK ("attempts" >= 0);

-- Runtime 'app' role: DML on tables + sequences, plus defaults for future
-- tables (migrator remains the DDL owner and RLS-bypass role — doc 07 §1/§4).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "werefa_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "werefa_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "werefa_migrator" IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "werefa_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "werefa_migrator" IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO "werefa_app";
