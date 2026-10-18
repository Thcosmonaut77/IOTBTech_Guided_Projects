variable "region" {
  description = "AWS region for both the provider and the backend"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR range"
  type        = string
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR range"
  type        = string
}

variable "instance_type" {
  description = "Instance type"
  type        = string
}

variable "public_key_file" {
  description = "Path to the public key uploaded to the EC2 key pair"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "private_key_file" {
  description = "Path to the matching private key, used by Terraform and setup-docker.sh"
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_user" {
  description = "SSH user for the Ubuntu instance"
  type        = string
  default     = "ubuntu"
}

variable "project" {
  description = "Project name"
  type        = string
}

variable "ecr_namespace" {
  description = "Namespace prefix for ECR repositories"
  type        = string
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository"
  type        = string
}

# ─── Application source ------------------------------------------------------
#
# The ZeetaFin application lives in the local Application/ tree (two directories:
# Backend/ZeetaFin-BE and Frontend/ZeetaFin-FE). setup-docker.sh ships that tree
# to the host — it is never cloned from a remote. Bump app_source_revision to
# force the bootstrap to re-upload and rebuild after editing the application.

variable "app_source_revision" {
  description = <<-EOT
    Opaque revision marker for the local application source. Change this string
    (e.g. to the git SHA or a timestamp) to make the bootstrap re-upload the
    Application/ tree and rebuild the images on the next apply.
  EOT
  type        = string
  default     = "1"
}

# ─── Public hostname and TLS ─────────────────────────────────────────────────

variable "duckdns_domain" {
  description = "Public hostname served by nginx and certified by Let's Encrypt"
  type        = string
  default     = "zeetafin.duckdns.org"
}

variable "duckdns_token" {
  description = <<-EOT
    Optional DuckDNS API token. When set, setup-docker.sh points the DuckDNS
    record at the instance's public IP automatically before requesting the
    certificate. When empty, the script prints the update URL and waits for you
    to point the record yourself. Never commit this value.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "letsencrypt_email" {
  description = "Contact email passed to certbot. Used for expiry notices."
  type        = string
  default     = ""
}
