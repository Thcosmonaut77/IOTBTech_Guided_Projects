output "server_public_ip" {
  description = "Public IP of the Docker host. This is the ECR push and SSH target."
  value       = aws_instance.docker.public_ip
}

output "ssh_user" {
  description = "Login user for the Docker host"
  value       = var.ssh_user
}

output "ssh_command" {
  description = "Ready-to-paste SSH command for the Docker host"
  value       = "ssh -i ${var.private_key_file} ${var.ssh_user}@${aws_instance.docker.public_ip}"
}

output "app_url" {
  description = "Public HTTPS URL of the deployed application"
  value       = "https://${var.duckdns_domain}"
}

output "key_name" {
  description = "Name of the EC2 key pair"
  value       = aws_key_pair.docker.key_name
}

output "private_key_file" {
  description = "Private key path used to reach the host"
  value       = var.private_key_file
}

output "ecr_repository_name" {
  description = "Full ECR repository name (namespace/repository)"
  value       = aws_ecr_repository.zeetafin.name
}

output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = aws_ecr_repository.zeetafin.repository_url
}

output "ecr_registry" {
  description = "ECR registry hostname used for docker login"
  value       = split("/", aws_ecr_repository.zeetafin.repository_url)[0]
}

output "ecr_push_commands" {
  description = "The manual tail of the deployment: authenticate, tag and push both images to ECR"
  value       = <<-EOT
    # Run these ON the Docker host, after `aws configure`:
    aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${split("/", aws_ecr_repository.zeetafin.repository_url)[0]}

    docker tag zeetafin-be:latest ${aws_ecr_repository.zeetafin.repository_url}:backend
    docker push ${aws_ecr_repository.zeetafin.repository_url}:backend

    docker tag zeetafin-fe:latest ${aws_ecr_repository.zeetafin.repository_url}:frontend
    docker push ${aws_ecr_repository.zeetafin.repository_url}:frontend
  EOT
}
