resource "google_redis_instance" "dambi" {
  name               = "dambi-redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  authorized_network = google_compute_network.vpc.id
  redis_version      = "REDIS_7_0"
  auth_enabled       = var.redis_auth_enabled

  depends_on = [google_service_networking_connection.psa]
}
