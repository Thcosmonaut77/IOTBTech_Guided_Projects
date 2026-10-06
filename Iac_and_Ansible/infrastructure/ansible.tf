resource "terraform_data" "ansible_setup" {
  triggers_replace = {
    master_ip    = aws_instance.master_node.public_ip
    worker_ips   = join(",", aws_instance.worker_node[*].private_ip)
    script       = filesha256("${path.module}/setup-ansible.sh")
    playbook     = filesha256("${path.module}/docker.yml")
    requirements = filesha256("${path.module}/requirements.yml")
  }

  provisioner "local-exec" {
    command = join(" ", [
      "bash ./setup-ansible.sh",
      "-m ${aws_instance.master_node.public_ip}",
      "-u ${var.ssh_user}",
      "-K ${base64encode(pathexpand(var.private_key_file))}",
      join(" ", aws_instance.worker_node[*].private_ip),
    ])
    working_dir = path.module
  }
}
