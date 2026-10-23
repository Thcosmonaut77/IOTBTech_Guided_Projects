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

variable "github_repository" {
  description = "owner/repository allowed to assume the CI role through GitHub OIDC"
  type        = string
  default     = "Thcosmonaut77/IOTBTech_Guided_Projects"
}

variable "github_branch" {
  description = "Branch allowed to assume the CI role; the workflow deploys from this branch"
  type        = string
  default     = "main"
}

variable "ssh_ingress_cidrs" {
  description = <<-EOT
    Additional CIDR blocks allowed to SSH, on top of the operator's current
    public IP /32. GitHub-hosted runners have dynamic egress addresses, so the
    example tfvars sets this to 0.0.0.0/0; narrow it to a self-hosted runner's
    CIDR or remove it and use SSM in production. See docs/SECURITY.md.
  EOT
  type        = list(string)
  default     = []
}

# ─── Application delivery ────────────────────────────────────────────────────
#
# Phase 3 does not build on the host. The GitHub Actions pipeline builds both
# images, pushes them to the ECR repository created below, and then runs the
# on-host deploy script. The instance receives an IAM role that can pull from
# that repository; no AWS access keys are stored on the server.

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
