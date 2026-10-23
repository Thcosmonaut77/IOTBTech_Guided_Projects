output "server_public_ip" {
  description = "Public IP of the Docker host (value for the EC2_HOST GitHub secret)"
  value       = aws_instance.docker.public_ip
}

output "instance_id" {
  description = "EC2 instance ID, used by stop/start and describe commands"
  value       = aws_instance.docker.id
}

output "ssh_user" {
  description = "Login user for the Docker host (value for the EC2_USER GitHub secret)"
  value       = var.ssh_user
}

output "ssh_command" {
  description = "Ready-to-paste SSH command for the Docker host"
  value       = "ssh -i ${var.private_key_file} ${var.ssh_user}@${aws_instance.docker.public_ip}"
}

output "app_url" {
  description = "Public HTTPS URL of the deployed application (value for the APP_BASE_URL GitHub secret)"
  value       = "https://${var.duckdns_domain}"
}

output "key_name" {
  description = "Name of the EC2 key pair"
  value       = aws_key_pair.docker.key_name
}

output "private_key_file" {
  description = "Private key path used to reach the host. Upload its contents as EC2_SSH_KEY."
  value       = var.private_key_file
}

output "ecr_repository_name" {
  description = "Full ECR repository name, namespace/repository (value for the ECR_REPOSITORY GitHub secret)"
  value       = aws_ecr_repository.zeetafin.name
}

output "ecr_repository_url" {
  description = "Full URL of the ECR repository"
  value       = aws_ecr_repository.zeetafin.repository_url
}

output "ecr_registry" {
  description = "ECR registry hostname (value for the ECR_REGISTRY GitHub secret)"
  value       = split("/", aws_ecr_repository.zeetafin.repository_url)[0]
}

output "aws_region" {
  description = "Region the pipeline must use (value for the AWS_REGION GitHub secret)"
  value       = var.region
}

output "github_oidc_role_arn" {
  description = "IAM role assumed by GitHub Actions through OIDC (value for the AWS_ROLE_ARN GitHub secret)"
  value       = aws_iam_role.github_ecr_push.arn
}

output "ecr_image_base" {
  description = "Prefix the pipeline appends :backend-<sha> and :frontend-<sha> to"
  value       = aws_ecr_repository.zeetafin.repository_url
}

output "github_secret_values" {
  description = "Values to paste into the repository's GitHub Actions secrets"
  value       = <<-EOT
    AWS_REGION        = ${var.region}
    ECR_REGISTRY      = ${split("/", aws_ecr_repository.zeetafin.repository_url)[0]}
    ECR_REPOSITORY    = ${aws_ecr_repository.zeetafin.name}
    EC2_HOST          = ${aws_instance.docker.public_ip}
    EC2_USER          = ${var.ssh_user}
    APP_BASE_URL      = https://${var.duckdns_domain}
    EC2_SSH_KEY       = contents of ${var.private_key_file}
    EC2_HOST_KEY      = output of: ssh-keyscan -H ${aws_instance.docker.public_ip}
    AWS_ROLE_ARN      = ${aws_iam_role.github_ecr_push.arn}
  EOT
  sensitive   = true
}
