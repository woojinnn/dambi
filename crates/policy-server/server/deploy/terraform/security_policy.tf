resource "google_compute_security_policy" "policy_server_edge" {
  name        = "dambi-policy-server-edge"
  description = "Edge controls for the public policy-server API backend."
  type        = "CLOUD_ARMOR"

  rule {
    priority    = 1000
    action      = "throttle"
    description = "Rate-limit public OAuth and refresh endpoints per source IP."

    match {
      expr {
        expression = "request.path.matches('^/auth/.*')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.auth_rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 1010
    action      = "throttle"
    description = "Rate-limit authenticated evaluation traffic per source IP."

    match {
      expr {
        expression = "request.path == '/evaluate'"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.evaluate_rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 1020
    action      = "throttle"
    description = "Rate-limit wallet list/add traffic per source IP."

    match {
      expr {
        expression = "request.path == '/wallets'"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.wallets_rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 1030
    action      = "throttle"
    description = "Rate-limit explicit wallet sync refreshes per source IP."

    match {
      expr {
        expression = "request.path.matches('^/wallets/[^/]+/sync$')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.wallet_sync_rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Default allow after targeted edge rate limits."

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
