locals {
  ecr_registry = split("/", aws_ecr_repository.zeetafin.repository_url)[0]

  # Optional flags are appended only when set, so an unset DuckDNS token or
  # Let's Encrypt email never shows up as an empty argument on the command line.
  duckdns_arg = var.duckdns_token == "" ? "" : "-t ${var.duckdns_token}"
  email_arg   = var.letsencrypt_email == "" ? "" : "-e ${var.letsencrypt_email}"
}

# Runs on the OPERATOR machine, not the server. It drives the server over SSH:
# install tooling, upload the local application source, build the images, deploy
# the containers, then put nginx + a Let's Encrypt certificate in front of them.
#
# The application is not cloned from GitHub — the operator's local Application/
# tree is the source of truth and is shipped to the host. Bump app_source_revision
# to re-upload and rebuild after editing the application.
#
# The only manual step it leaves is `aws configure` + the ECR push, which require
# credentials that must not live in Terraform.
resource "terraform_data" "bootstrap" {
  triggers_replace = {
    host       = aws_instance.docker.public_ip
    script     = filesha256("${path.module}/setup-docker.sh")
    deploy_sh  = filesha256("${path.module}/../Application/deploy.sh")
    nginx_conf = filesha256("${path.module}/../Application/nginx.cfg")
    domain     = var.duckdns_domain
    app_source = var.app_source_revision
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
