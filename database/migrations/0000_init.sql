CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_user_id` int,
	`business_id` int,
	`action` varchar(80) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` int,
	`before` json,
	`after` json,
	`ip` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_holidays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`date` date NOT NULL,
	`reason` varchar(200),
	CONSTRAINT `branch_holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_holidays_branch_date_uq` UNIQUE(`branch_id`,`date`)
);
--> statement-breakpoint
CREATE TABLE `branch_hours` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`weekday` smallint NOT NULL,
	`open_time` time NOT NULL,
	`close_time` time NOT NULL,
	CONSTRAINT `branch_hours_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_hours_weekday` CHECK(`branch_hours`.`weekday` between 1 and 7),
	CONSTRAINT `branch_hours_order` CHECK(`branch_hours`.`close_time` > `branch_hours`.`open_time`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`city` varchar(80) NOT NULL DEFAULT '',
	`address` text,
	`phone` varchar(20),
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Beirut',
	`fee_amount` decimal(12,2) NOT NULL DEFAULT '0',
	`currency` enum('USD','LBP') NOT NULL DEFAULT 'USD',
	`fee_type` enum('deposit','full') NOT NULL DEFAULT 'deposit',
	`hold_minutes` int,
	`min_notice_minutes` int NOT NULL DEFAULT 60,
	`booking_window_days` int NOT NULL DEFAULT 30,
	`cancellation_cutoff_hours` int NOT NULL DEFAULT 24,
	`allow_reschedule` boolean NOT NULL DEFAULT true,
	`cancellation_policy_text` text,
	`display_token` varchar(64) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `branches_displayToken_unique` UNIQUE(`display_token`),
	CONSTRAINT `branches_id_business_uq` UNIQUE(`id`,`business_id`),
	CONSTRAINT `branches_fee_non_negative` CHECK(`branches`.`fee_amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`phone` varchar(20),
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`),
	CONSTRAINT `businesses_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`name` varchar(40) NOT NULL,
	`locked_until` datetime(3),
	`last_started_at` datetime(3),
	`last_finished_at` datetime(3),
	`last_error` text,
	CONSTRAINT `job_runs_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `line_locks` (
	`line_id` int NOT NULL,
	CONSTRAINT `line_locks_line_id` PRIMARY KEY(`line_id`)
);
--> statement-breakpoint
CREATE TABLE `operator_branches` (
	`user_id` int NOT NULL,
	`branch_id` int NOT NULL,
	CONSTRAINT `operator_branches_user_id_branch_id_pk` PRIMARY KEY(`user_id`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`code_hash` varchar(128) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`attempts` smallint NOT NULL DEFAULT 0,
	`consumed_at` datetime(3),
	`ip` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `otp_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` int NOT NULL DEFAULT 1,
	`whish_payment_url` text,
	`payment_instructions` text,
	`default_hold_minutes` int NOT NULL DEFAULT 30,
	`updated_by_id` int,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_settings_single_row` CHECK(`platform_settings`.`id` = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` varchar(128) NOT NULL,
	`sess` json NOT NULL,
	`expire` datetime(3) NOT NULL,
	CONSTRAINT `sessions_sid` PRIMARY KEY(`sid`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` enum('platform_admin','business_owner','branch_operator','customer') NOT NULL,
	`name` varchar(120) NOT NULL DEFAULT '',
	`phone` varchar(20),
	`email` varchar(160),
	`password_hash` varchar(100),
	`business_id` int,
	`is_active` boolean NOT NULL DEFAULT true,
	`phone_verified_at` datetime(3),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_business_matches_role` CHECK((`users`.`role` in ('business_owner', 'branch_operator')) = (`users`.`business_id` is not null))
);
--> statement-breakpoint
CREATE TABLE `appointment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appointment_id` int NOT NULL,
	`type` varchar(40) NOT NULL,
	`actor_user_id` int,
	`data` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `appointment_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointment_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`line_id` int NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`local_date` date NOT NULL,
	`local_time` time NOT NULL,
	`duration_minutes` smallint NOT NULL,
	`capacity` smallint NOT NULL DEFAULT 1,
	`reserved_count` smallint NOT NULL DEFAULT 0,
	`is_open` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `appointment_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `slots_line_start_uq` UNIQUE(`line_id`,`starts_at`),
	CONSTRAINT `slots_capacity_positive` CHECK(`appointment_slots`.`capacity` >= 1),
	CONSTRAINT `slots_reserved_non_negative` CHECK(`appointment_slots`.`reserved_count` >= 0)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(12) NOT NULL,
	`slot_id` int NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`line_id` int NOT NULL,
	`customer_id` int NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`local_date` date NOT NULL,
	`local_time` time NOT NULL,
	`status` enum('held','confirmed','checked_in','completed','cancelled','no_show','expired') NOT NULL DEFAULT 'held',
	`hold_expires_at` datetime(3),
	`amount_due` decimal(12,2) NOT NULL,
	`currency` enum('USD','LBP') NOT NULL,
	`fee_type` enum('deposit','full') NOT NULL,
	`payment_status` enum('not_required','unpaid','awaiting_verification','confirmed','rejected') NOT NULL,
	`payment_confirmed_by_id` int,
	`payment_confirmed_at` datetime(3),
	`customer_note` text,
	`cancel_reason` text,
	`cancelled_by_id` int,
	`cancelled_at` datetime(3),
	`confirmed_at` datetime(3),
	`checked_in_at` datetime(3),
	`completed_at` datetime(3),
	`no_show_at` datetime(3),
	`expired_at` datetime(3),
	`reminder_sent_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`active_flag` tinyint GENERATED ALWAYS AS ((case when status in ('held', 'confirmed', 'checked_in') then 1 end)) STORED,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appointments_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `appointments_one_active_per_day` UNIQUE(`customer_id`,`line_id`,`local_date`,`active_flag`)
);
--> statement-breakpoint
CREATE TABLE `line_pauses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`line_id` int NOT NULL,
	`paused_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`resumed_at` datetime(3),
	`paused_by_id` int,
	`reason` varchar(200),
	CONSTRAINT `line_pauses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`code_prefix` varchar(3) NOT NULL DEFAULT 'A',
	`avg_minutes_per_customer` int NOT NULL DEFAULT 10,
	`counters_count` smallint NOT NULL DEFAULT 1,
	`queue_policy` enum('fifo','booked_first','interleave') NOT NULL DEFAULT 'interleave',
	`interleave_ratio` smallint NOT NULL DEFAULT 2,
	`late_grace_minutes` int NOT NULL DEFAULT 10,
	`checkin_open_minutes` int NOT NULL DEFAULT 60,
	`allow_remote_join` boolean NOT NULL DEFAULT true,
	`default_alert_lead_minutes` int NOT NULL DEFAULT 15,
	`alert_ahead_threshold` smallint NOT NULL DEFAULT 2,
	`is_open` boolean NOT NULL DEFAULT true,
	`is_paused` boolean NOT NULL DEFAULT false,
	`display_token` varchar(64) NOT NULL,
	`sort_order` smallint NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `lines_displayToken_unique` UNIQUE(`display_token`),
	CONSTRAINT `lines_id_branch_business_uq` UNIQUE(`id`,`branch_id`,`business_id`),
	CONSTRAINT `lines_avg_minutes` CHECK(`lines`.`avg_minutes_per_customer` between 1 and 240),
	CONSTRAINT `lines_counters` CHECK(`lines`.`counters_count` between 1 and 50),
	CONSTRAINT `lines_ratio` CHECK(`lines`.`interleave_ratio` between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`appointment_id` int,
	`ticket_id` int,
	`author_id` int NOT NULL,
	`kind` enum('customer','internal','shared') NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `notes_one_target` CHECK((`notes`.`appointment_id` is not null) + (`notes`.`ticket_id` is not null) = 1)
);
--> statement-breakpoint
CREATE TABLE `payment_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appointment_id` int NOT NULL,
	`customer_id` int NOT NULL,
	`transaction_ref` varchar(80) NOT NULL,
	`proof_path` varchar(255),
	`proof_mime` varchar(60),
	`proof_size` int,
	`status` enum('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
	`reviewed_by_id` int,
	`reviewed_at` datetime(3),
	`review_note` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`pending_flag` tinyint GENERATED ALWAYS AS ((case when status = 'pending' then 1 end)) STORED,
	CONSTRAINT `payment_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_submissions_one_pending` UNIQUE(`appointment_id`,`pending_flag`)
);
--> statement-breakpoint
CREATE TABLE `queue_counters` (
	`line_id` int NOT NULL,
	`service_date` date NOT NULL,
	`last_number` int NOT NULL DEFAULT 0,
	CONSTRAINT `queue_counters_line_id_service_date_pk` PRIMARY KEY(`line_id`,`service_date`)
);
--> statement-breakpoint
CREATE TABLE `queue_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`line_id` int NOT NULL,
	`service_date` date NOT NULL,
	`number` int NOT NULL,
	`display_code` varchar(12) NOT NULL,
	`source` enum('walk_in','appointment') NOT NULL,
	`appointment_id` int,
	`customer_id` int,
	`guest_name` varchar(120),
	`phone` varchar(20),
	`priority_group` enum('appointment','walk_in') NOT NULL,
	`sort_at` datetime(3) NOT NULL,
	`status` enum('waiting','called','completed','skipped','cancelled','expired') NOT NULL DEFAULT 'waiting',
	`joined_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`first_called_at` datetime(3),
	`last_called_at` datetime(3),
	`recall_count` smallint NOT NULL DEFAULT 0,
	`counter_label` varchar(40),
	`completed_at` datetime(3),
	`closed_at` datetime(3),
	`tracking_token` varchar(64) NOT NULL,
	`alert_lead_minutes` smallint,
	`approach_alerted_at` datetime(3),
	`estimate_low_min` int,
	`estimate_high_min` int,
	`estimate_method` varchar(12),
	`actual_wait_seconds` int,
	`created_by_id` int,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`active_flag` tinyint GENERATED ALWAYS AS ((case when status in ('waiting', 'called') then 1 end)) STORED,
	CONSTRAINT `queue_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `queue_tickets_trackingToken_unique` UNIQUE(`tracking_token`),
	CONSTRAINT `tickets_line_day_number_uq` UNIQUE(`line_id`,`service_date`,`number`),
	CONSTRAINT `tickets_one_active_per_appointment` UNIQUE(`appointment_id`,`active_flag`),
	CONSTRAINT `tickets_one_active_per_customer` UNIQUE(`line_id`,`customer_id`,`active_flag`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appointment_id` int NOT NULL,
	`business_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`line_id` int NOT NULL,
	`customer_id` int NOT NULL,
	`rating` smallint NOT NULL,
	`comment` text,
	`owner_reply` text,
	`replied_by_id` int,
	`replied_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_appointmentId_unique` UNIQUE(`appointment_id`),
	CONSTRAINT `reviews_rating_range` CHECK(`reviews`.`rating` between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` enum('sms','push') NOT NULL,
	`kind` enum('otp','hold_created','appointment_confirmed','payment_submitted','payment_rejected','hold_expired','appointment_cancelled','reminder','ticket_created','turn_approaching','your_turn') NOT NULL,
	`user_id` int,
	`to_phone` varchar(20),
	`title` varchar(200),
	`body` text NOT NULL,
	`secret_body` text,
	`link` varchar(500),
	`fallback_phone` varchar(20),
	`status` enum('queued','sending','sent','delivered','failed') NOT NULL DEFAULT 'queued',
	`attempts` smallint NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3),
	`provider` varchar(20),
	`provider_message_id` varchar(120),
	`last_error` text,
	`appointment_id` int,
	`ticket_id` int,
	`sent_at` datetime(3),
	`delivered_at` datetime(3),
	`failed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token` varchar(400) NOT NULL,
	`user_agent` varchar(300),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revoked_at` datetime(3),
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_holidays` ADD CONSTRAINT `branch_holidays_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_hours` ADD CONSTRAINT `branch_hours_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operator_branches` ADD CONSTRAINT `operator_branches_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operator_branches` ADD CONSTRAINT `operator_branches_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD CONSTRAINT `platform_settings_updated_by_id_users_id_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_slots` ADD CONSTRAINT `slots_line_fk` FOREIGN KEY (`line_id`,`branch_id`,`business_id`) REFERENCES `lines`(`id`,`branch_id`,`business_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_slot_id_appointment_slots_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `appointment_slots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_payment_confirmed_by_id_users_id_fk` FOREIGN KEY (`payment_confirmed_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_cancelled_by_id_users_id_fk` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_line_fk` FOREIGN KEY (`line_id`,`branch_id`,`business_id`) REFERENCES `lines`(`id`,`branch_id`,`business_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `line_pauses` ADD CONSTRAINT `line_pauses_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `line_pauses` ADD CONSTRAINT `line_pauses_paused_by_id_users_id_fk` FOREIGN KEY (`paused_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lines` ADD CONSTRAINT `lines_branch_fk` FOREIGN KEY (`branch_id`,`business_id`) REFERENCES `branches`(`id`,`business_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_ticket_id_queue_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `queue_tickets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_submissions` ADD CONSTRAINT `payment_submissions_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_submissions` ADD CONSTRAINT `payment_submissions_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_submissions` ADD CONSTRAINT `payment_submissions_reviewed_by_id_users_id_fk` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_counters` ADD CONSTRAINT `queue_counters_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_tickets` ADD CONSTRAINT `queue_tickets_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_tickets` ADD CONSTRAINT `queue_tickets_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_tickets` ADD CONSTRAINT `queue_tickets_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_tickets` ADD CONSTRAINT `tickets_line_fk` FOREIGN KEY (`line_id`,`branch_id`,`business_id`) REFERENCES `lines`(`id`,`branch_id`,`business_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_customer_id_users_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_replied_by_id_users_id_fk` FOREIGN KEY (`replied_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_ticket_id_queue_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `queue_tickets`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_tokens` ADD CONSTRAINT `push_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_business_idx` ON `audit_logs` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `branch_hours_branch_idx` ON `branch_hours` (`branch_id`);--> statement-breakpoint
CREATE INDEX `branches_business_idx` ON `branches` (`business_id`);--> statement-breakpoint
CREATE INDEX `otp_codes_phone_idx` ON `otp_codes` (`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_expire_idx` ON `sessions` (`expire`);--> statement-breakpoint
CREATE INDEX `users_business_idx` ON `users` (`business_id`);--> statement-breakpoint
CREATE INDEX `appointment_events_appointment_idx` ON `appointment_events` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `slots_line_day_idx` ON `appointment_slots` (`line_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `appointments_branch_day_idx` ON `appointments` (`branch_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `appointments_status_hold_idx` ON `appointments` (`status`,`hold_expires_at`);--> statement-breakpoint
CREATE INDEX `appointments_customer_idx` ON `appointments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `line_pauses_line_idx` ON `line_pauses` (`line_id`,`paused_at`);--> statement-breakpoint
CREATE INDEX `lines_branch_idx` ON `lines` (`branch_id`);--> statement-breakpoint
CREATE INDEX `notes_appointment_idx` ON `notes` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `notes_ticket_idx` ON `notes` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `payment_submissions_status_idx` ON `payment_submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_line_status_idx` ON `queue_tickets` (`line_id`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_line_day_idx` ON `queue_tickets` (`line_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `tickets_customer_idx` ON `queue_tickets` (`customer_id`);--> statement-breakpoint
CREATE INDEX `reviews_branch_idx` ON `reviews` (`branch_id`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notifications_ticket_idx` ON `notifications` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `notifications_appointment_idx` ON `notifications` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_provider_msg_idx` ON `notifications` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `push_tokens_user_idx` ON `push_tokens` (`user_id`);