resource "random_password" "db" {
  length  = 24
  special = false # alphanumeric → safe inside a postgres:// URL without escaping
}

resource "google_sql_database_instance" "dambi" {
  name                = "dambi-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  # Private IP requires the peering to exist first.
  depends_on = [google_service_networking_connection.psa]

  settings {
    tier                        = var.db_tier
    edition                     = "ENTERPRISE" # db-custom-* tiers require ENTERPRISE (not ENTERPRISE_PLUS)
    availability_type           = var.db_availability_type
    deletion_protection_enabled = var.db_deletion_protection

    ip_configuration {
      ipv4_enabled    = false # no public IP
      private_network = google_compute_network.vpc.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = var.db_backup_start_time
      transaction_log_retention_days = var.db_transaction_log_retention_days

      backup_retention_settings {
        retained_backups = var.db_retained_backups
        retention_unit   = "COUNT"
      }
    }

    database_flags {
      name  = "max_connections"
      value = var.db_max_connections
    }
  }
}

resource "google_sql_database" "dambi" {
  name     = "dambi"
  instance = google_sql_database_instance.dambi.name
}

resource "google_sql_user" "dambi" {
  name     = "dambi"
  instance = google_sql_database_instance.dambi.name
  password = random_password.db.result
}
