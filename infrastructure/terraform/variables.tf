variable "project_id" {
  type        = string
  description = "Existing GCP project id with billing enabled."
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "zone" {
  type    = string
  default = "asia-south1-a"
}

variable "domain" {
  type        = string
  description = "Owned domain name, e.g. play.example.com, delegated to Cloud DNS."
}

variable "artifact_registry_region" {
  type    = string
  default = "asia-south1"
}

variable "backend_image" {
  type        = string
  description = "Artifact Registry image including immutable tag or digest."
}

variable "frontend_image" {
  type        = string
  description = "Artifact Registry image including immutable tag or digest."
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "Cloud SQL password; 24+ URL-safe characters, supplied via TF_VAR_db_password."
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{24,}$", var.db_password))
    error_message = "Use at least 24 letters, digits, underscores, or hyphens so the connection URI is safe."
  }
}

variable "jwt_secret" {
  type        = string
  sensitive   = true
  description = "At least 32 random characters, supplied via TF_VAR_jwt_secret."
  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "JWT secret must contain at least 32 characters."
  }
}

variable "min_replicas" {
  type    = number
  default = 2
}

variable "max_replicas" {
  type    = number
  default = 5
}

variable "armor_rate_limit_per_minute" {
  type        = number
  default     = 600
  description = "Cloud Armor per-IP throttle. Raise only for controlled staging load tests."
}
