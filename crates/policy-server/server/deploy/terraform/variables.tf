variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "GCP region for all regional resources."
  default     = "asia-northeast3"
}

variable "gke_deletion_protection" {
  type        = bool
  description = "Enable deletion protection for the production GKE Autopilot cluster. Set false only for disposable environments."
  default     = true
}

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier."
  default     = "db-custom-1-3840"
}

variable "db_availability_type" {
  type        = string
  description = "Cloud SQL availability type. REGIONAL is the production default; set ZONAL only for disposable environments."
  default     = "REGIONAL"

  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.db_availability_type)
    error_message = "db_availability_type must be REGIONAL or ZONAL."
  }
}

variable "db_deletion_protection" {
  type        = bool
  description = "Enable both Terraform and Cloud SQL deletion protection for the production database instance."
  default     = true
}

variable "db_max_connections" {
  type        = string
  description = "Postgres max_connections flag (string per Cloud SQL API)."
  default     = "100"
}

variable "db_backup_start_time" {
  type        = string
  description = "UTC start time for Cloud SQL automated backups, formatted HH:MM."
  default     = "17:00"
}

variable "db_retained_backups" {
  type        = number
  description = "Number of automated Cloud SQL backups to retain."
  default     = 14
}

variable "db_transaction_log_retention_days" {
  type        = number
  description = "Point-in-time recovery transaction log retention in days."
  default     = 7
}

variable "redis_memory_gb" {
  type        = number
  description = "Memorystore capacity in GiB."
  default     = 1
}

variable "redis_tier" {
  type        = string
  description = "Memorystore tier. STANDARD_HA is the production default; set BASIC only for disposable environments."
  default     = "STANDARD_HA"

  validation {
    condition     = contains(["STANDARD_HA", "BASIC"], var.redis_tier)
    error_message = "redis_tier must be STANDARD_HA or BASIC."
  }
}

variable "redis_auth_enabled" {
  type        = bool
  description = "Enable Memorystore AUTH and include the generated password in the REDIS_URL Terraform output."
  default     = true
}

variable "auth_rate_limit_per_minute" {
  type        = number
  description = "Cloud Armor per-source-IP requests per minute for /auth/* endpoints."
  default     = 120
}

variable "evaluate_rate_limit_per_minute" {
  type        = number
  description = "Cloud Armor per-source-IP requests per minute for /evaluate."
  default     = 60
}

variable "wallets_rate_limit_per_minute" {
  type        = number
  description = "Cloud Armor per-source-IP requests per minute for /wallets list/add traffic."
  default     = 60
}

variable "wallet_sync_rate_limit_per_minute" {
  type        = number
  description = "Cloud Armor per-source-IP requests per minute for /wallets/:address/sync."
  default     = 30
}
