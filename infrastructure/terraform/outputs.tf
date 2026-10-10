output "load_balancer_ip" { value = google_compute_global_address.lb.address }
output "cloud_dns_name_servers" { value = google_dns_managed_zone.game.name_servers
  description = "Add these NS records at your domain registrar to delegate DNS to Cloud DNS." }
output "game_url" { value = "https://${var.domain}" }
output "cloud_sql_private_ip" { value = google_sql_database_instance.postgres.private_ip_address }
output "memorystore_host" { value = google_redis_instance.game.host }
