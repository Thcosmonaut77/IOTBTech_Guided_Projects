locals {
  ecr_registry = split("/", aws_ecr_repository.zeetafin.repository_url)[0]

  # Optional flags are appended only when set, so an unset DuckDNS token or
  # Let's Encrypt email never shows up as an empty argument on the command line.
  duckdns_arg = var.duckdns_token == "" ? "" : "-t ${var.duckdns_token}"
  email_arg   = var.letsencrypt_email == "" ? "" : "-e ${var.letsencrypt_email}"
}

# Runs on the OPERATOR machine, not the server. It drives the freshly-created
# host over SSH and stops as soon as the host is ready to receive images:
#
#   install Docker, AWS CLI v2, nginx and certbot
#   upload deploy.sh and nginx.cfg
#   generate the application .env once (POSTGRES_PASSWORD, JWT_SECRET)
#   put nginx + a Let's Encrypt certificate in front
#
# It deliberately does not build or deploy the application. That job belongs to
# .github/workflows/deploy.yml: build in CI, push to ECR, then SSH to the host
# and run deploy.sh. Re-run the bootstrap with `-replace` if the host changes.
resource "terraform_data" "bootstrap" {
  triggers_replace = {
    host       = aws_instance.docker.public_ip
    script     = filesha256("${path.module}/setup-docker.sh")
    deploy_sh  = filesha256("${path.module}/../Application/deploy.sh")
    nginx_conf = filesha256("${path.module}/../Application/nginx.cfg")
    domain     = var.duckdns_domain
  }

  provisioner "local-exec" {
    command = join(" ", [
      "bash ./setup-docker.sh",
      "-H ${aws_instance.docker.public_ip}",
      "-u ${var.ssh_user}",
      "-K ${base64encode(pathexpand(var.private_key_file))}",
      "-d ${var.duckdns_domain}",
      "-c ${local.ecr_registry}",
      "-r ${aws_ecr_repository.zeetafin.repository_url}",
      "-R ${var.region}",
      "-P ${var.project}",
      local.email_arg,
      local.duckdns_arg,
    ])
    working_dir = path.module
  }
}
