locals {
  app_name = "wayfinder"
  labels = { app = local.app_name, managed-by = "terraform" }
}
resource "google_project_service" "apis" {
  for_each = toset(["compute.googleapis.com", "dns.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com", "servicenetworking.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com", "cloudresourcemanager.googleapis.com", "artifactregistry.googleapis.com"])
  project = var.project_id
  service = each.value
  disable_on_destroy = false
}
resource "google_artifact_registry_repository" "images" {
  location      = var.artifact_registry_region
  repository_id = "wayfinder"
  description   = "Wayfinder frontend and backend release images"
  format        = "DOCKER"
  docker_config {
    immutable_tags = true
  }
  depends_on    = [google_project_service.apis]
}
resource "google_compute_network" "vpc" {
  name = "${local.app_name}-vpc"
  auto_create_subnetworks = false
  routing_mode = "GLOBAL"
  depends_on = [google_project_service.apis]
}
resource "google_compute_subnetwork" "app" {
  name = "${local.app_name}-app-${var.region}"
  region = var.region
  network = google_compute_network.vpc.id
  ip_cidr_range = "10.20.0.0/20"
  private_ip_google_access = true
}
resource "google_compute_global_address" "private_services" {
  name = "${local.app_name}-private-services"
  purpose = "VPC_PEERING"
  address_type = "INTERNAL"
  prefix_length = 16
  network = google_compute_network.vpc.id
}
resource "google_service_networking_connection" "private_vpc" {
  network = google_compute_network.vpc.id
  service = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on = [google_project_service.apis]
}
resource "google_compute_router" "router" {
  name = "${local.app_name}-router"
  region = var.region
  network = google_compute_network.vpc.id
}
resource "google_compute_router_nat" "nat" {
  name = "${local.app_name}-nat"
  router = google_compute_router.router.name
  region = var.region
  nat_ip_allocate_option = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  subnetwork { name = google_compute_subnetwork.app.id
  source_ip_ranges_to_nat = ["ALL_IP_RANGES"] }
  log_config { enable = true
  filter = "ERRORS_ONLY" }
}
resource "google_compute_firewall" "health_check" {
  name = "${local.app_name}-allow-lb-health-checks"
  network = google_compute_network.vpc.name
  direction = "INGRESS"
  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  target_tags = ["${local.app_name}-game"]
  allow { protocol = "tcp"
  ports = ["8080"] }
}
resource "google_compute_firewall" "iap_ssh" {
  name = "${local.app_name}-iap-ssh"
  network = google_compute_network.vpc.name
  direction = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags = ["${local.app_name}-game"]
  allow { protocol = "tcp"
  ports = ["22"] }
}
resource "google_sql_database_instance" "postgres" {
  name = "${local.app_name}-postgres"
  region = var.region
  database_version = "POSTGRES_16"
  deletion_protection = true
  settings {
    tier = "db-custom-2-7680"
    availability_type = "REGIONAL"
    disk_type = "PD_SSD"
    disk_size = 20
    disk_autoresize = true
    ip_configuration { ipv4_enabled = false
  private_network = google_compute_network.vpc.id
  enable_private_path_for_google_cloud_services = true }
    backup_configuration { enabled = true
  point_in_time_recovery_enabled = true
  transaction_log_retention_days = 7 }
    database_flags { name = "log_min_duration_statement"
  value = "500" }
    user_labels = local.labels
  }
  depends_on = [google_service_networking_connection.private_vpc]
}
resource "google_sql_database" "game" { name = "wayfinder"
  instance = google_sql_database_instance.postgres.name }
resource "google_sql_user" "game" { name = "wayfinder_app"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password }
resource "google_redis_instance" "game" {
  name = "${local.app_name}-redis"
  region = var.region
  tier = "STANDARD_HA"
  memory_size_gb = 1
  authorized_network = google_compute_network.vpc.id
  connect_mode = "PRIVATE_SERVICE_ACCESS"
  redis_version = "REDIS_7_0"
  auth_enabled = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  depends_on = [google_service_networking_connection.private_vpc]
}
resource "google_secret_manager_secret" "db_password" {
  secret_id = "wayfinder-db-password"
  replication { auto {} }
  depends_on = [google_project_service.apis]
}
resource "google_secret_manager_secret_version" "db_password" { secret = google_secret_manager_secret.db_password.id
  secret_data = var.db_password }
resource "google_secret_manager_secret" "jwt" { secret_id = "wayfinder-jwt-secret"
  replication { auto {} }
  depends_on = [google_project_service.apis] }
resource "google_secret_manager_secret_version" "jwt" { secret = google_secret_manager_secret.jwt.id
  secret_data = var.jwt_secret }
resource "google_secret_manager_secret" "redis_auth" { secret_id = "wayfinder-redis-auth"
  replication { auto {} }
  depends_on = [google_project_service.apis] }
resource "google_secret_manager_secret_version" "redis_auth" { secret = google_secret_manager_secret.redis_auth.id
  secret_data = google_redis_instance.game.auth_string }
resource "google_secret_manager_secret" "redis_ca" { secret_id = "wayfinder-redis-ca"
  replication { auto {} }
  depends_on = [google_project_service.apis] }
resource "google_secret_manager_secret_version" "redis_ca" { secret = google_secret_manager_secret.redis_ca.id
  secret_data = google_redis_instance.game.server_ca_certs[0].cert }
resource "google_service_account" "game" { account_id = "wayfinder-game"
  display_name = "Wayfinder game VM service account" }
resource "google_secret_manager_secret_iam_member" "game_db_secret" { secret_id = google_secret_manager_secret.db_password.id
  role = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_secret_manager_secret_iam_member" "game_jwt_secret" { secret_id = google_secret_manager_secret.jwt.id
  role = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_secret_manager_secret_iam_member" "game_redis_auth_secret" { secret_id = google_secret_manager_secret.redis_auth.id
  role = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_secret_manager_secret_iam_member" "game_redis_ca_secret" { secret_id = google_secret_manager_secret.redis_ca.id
  role = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_project_iam_member" "game_cloud_sql_client" { project = var.project_id
  role = "roles/cloudsql.client"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_project_iam_member" "game_logging" { project = var.project_id
  role = "roles/logging.logWriter"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_project_iam_member" "game_monitoring" { project = var.project_id
  role = "roles/monitoring.metricWriter"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_artifact_registry_repository_iam_member" "game_artifact_reader" { location = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.repository_id
  role = "roles/artifactregistry.reader"
  member = "serviceAccount:${google_service_account.game.email}" }
resource "google_compute_instance_template" "game" {
  name_prefix = "${local.app_name}-game-"
  machine_type = "e2-standard-2"
  tags = ["${local.app_name}-game"]
  disk { source_image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
  auto_delete = true
  boot = true
  disk_size_gb = 20 }
  network_interface { subnetwork = google_compute_subnetwork.app.id }
  service_account { email = google_service_account.game.email
  scopes = ["https://www.googleapis.com/auth/cloud-platform"] }
  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    backend_image = var.backend_image, frontend_image = var.frontend_image,
    db_host = google_sql_database_instance.postgres.private_ip_address,
    db_password_secret = google_secret_manager_secret.db_password.secret_id,
    jwt_secret_name = google_secret_manager_secret.jwt.secret_id,
    redis_host = google_redis_instance.game.host, redis_port = google_redis_instance.game.port,
    redis_auth_secret = google_secret_manager_secret.redis_auth.secret_id,
    redis_ca_secret = google_secret_manager_secret.redis_ca.secret_id, db_name = google_sql_database.game.name,
    sql_instance_connection_name = google_sql_database_instance.postgres.connection_name, domain = var.domain,
    artifact_registry_region = var.artifact_registry_region
  })
  lifecycle { create_before_destroy = true }
  depends_on = [google_secret_manager_secret_iam_member.game_db_secret, google_secret_manager_secret_iam_member.game_jwt_secret, google_secret_manager_secret_iam_member.game_redis_auth_secret, google_secret_manager_secret_iam_member.game_redis_ca_secret, google_artifact_registry_repository_iam_member.game_artifact_reader, google_redis_instance.game, google_secret_manager_secret_version.redis_auth, google_secret_manager_secret_version.redis_ca]
}
resource "google_compute_instance_group_manager" "game" {
  name = "${local.app_name}-game-mig"
  zone = var.zone
  base_instance_name = "${local.app_name}-game"
  target_size = var.min_replicas
  version { instance_template = google_compute_instance_template.game.id
  name = "primary" }
  named_port { name = "http"
  port = 8080 }
  auto_healing_policies { health_check = google_compute_health_check.game.id
  initial_delay_sec = 240 }
}
resource "google_compute_autoscaler" "game" {
  name = "${local.app_name}-game-autoscaler"
  zone = var.zone
  target = google_compute_instance_group_manager.game.id
  autoscaling_policy { min_replicas = var.min_replicas
  max_replicas = var.max_replicas
  cooldown_period = 120
  cpu_utilization { target = 0.65 } }
}
resource "google_compute_health_check" "game" {
  name = "${local.app_name}-health"
  check_interval_sec = 10
  timeout_sec = 5
  healthy_threshold = 2
  unhealthy_threshold = 3
  http_health_check { port = 8080
  request_path = "/health" }
}
resource "google_compute_global_address" "lb" { name = "${local.app_name}-https-ip" }
resource "google_compute_security_policy" "armor" {
  name = "${local.app_name}-armor"
  rule { action = "throttle"
  priority = 1000
  match { expr { expression = "true" } }
  rate_limit_options { conform_action = "allow"
  exceed_action = "deny(429)"
  enforce_on_key = "IP"
  rate_limit_threshold { count = var.armor_rate_limit_per_minute
  interval_sec = 60 } } }
  rule { action = "allow"
  priority = 2147483647
  match { versioned_expr = "SRC_IPS_V1"
  config { src_ip_ranges = ["*"] } } }
}
resource "google_compute_backend_service" "game" {
  name = "${local.app_name}-backend"
  protocol = "HTTP"
  port_name = "http"
  timeout_sec = 75
  connection_draining_timeout_sec = 30
  load_balancing_scheme = "EXTERNAL_MANAGED"
  backend { group = google_compute_instance_group_manager.game.instance_group
  balancing_mode = "UTILIZATION"
  max_utilization = 0.8 }
  health_checks = [google_compute_health_check.game.id]
  security_policy = google_compute_security_policy.armor.id
  log_config { enable = true
  sample_rate = 1 }
}
resource "google_compute_url_map" "game" { name = "${local.app_name}-url-map"
  default_service = google_compute_backend_service.game.id }
resource "google_compute_managed_ssl_certificate" "game" { name = "${local.app_name}-cert"
  managed { domains = [var.domain] } }
resource "google_compute_target_https_proxy" "game" { name = "${local.app_name}-https-proxy"
  url_map = google_compute_url_map.game.id
  ssl_certificates = [google_compute_managed_ssl_certificate.game.id] }
resource "google_compute_global_forwarding_rule" "https" { name = "${local.app_name}-https-forwarding"
  target = google_compute_target_https_proxy.game.id
  port_range = "443"
  ip_address = google_compute_global_address.lb.address
  load_balancing_scheme = "EXTERNAL_MANAGED" }
resource "google_compute_url_map" "http_redirect" {
  name = "${local.app_name}-http-redirect"
  default_url_redirect { https_redirect = true
  strip_query = false
  redirect_response_code = "MOVED_PERMANENTLY_DEFAULT" }
}
resource "google_compute_target_http_proxy" "redirect" { name = "${local.app_name}-http-proxy"
  url_map = google_compute_url_map.http_redirect.id }
resource "google_compute_global_forwarding_rule" "http" { name = "${local.app_name}-http-forwarding"
  target = google_compute_target_http_proxy.redirect.id
  port_range = "80"
  ip_address = google_compute_global_address.lb.address
  load_balancing_scheme = "EXTERNAL_MANAGED" }
resource "google_dns_managed_zone" "game" { name = "${local.app_name}-zone"
  dns_name = "${var.domain}."
  description = "Wayfinder game DNS zone"
  visibility = "public" }
resource "google_dns_record_set" "game" { name = "${var.domain}."
  managed_zone = google_dns_managed_zone.game.name
  type = "A"
  ttl = 300
  rrdatas = [google_compute_global_address.lb.address] }
