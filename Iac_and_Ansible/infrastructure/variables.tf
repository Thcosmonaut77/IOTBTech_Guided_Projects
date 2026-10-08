variable "region" {
  description = "AWS region"
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
  description = "Path to the matching private key, used by Terraform and setup-ansible.sh"
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_user" {
  description = "SSH user for the Ubuntu instances"
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH (use your IP/32)"
  type        = string
  sensitive   = true
}

variable "project" {
  description = "Project name"
  type        = string
}
