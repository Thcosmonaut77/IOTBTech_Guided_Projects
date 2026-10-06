output "master_public_ip" {
  description = "Public IP of the Ansible control node"
  value       = aws_instance.master_node.public_ip
}

output "worker_private_ips" {
  description = "Private IPs of the worker nodes. These are what Ansible connects to, over the VPC."
  value       = aws_instance.worker_node[*].private_ip
}

output "worker_public_ips" {
  description = "Public IPs of the worker nodes. Informational only; not used by Ansible."
  value       = aws_instance.worker_node[*].public_ip
}

output "key_name" {
  description = "Name of the EC2 key pair shared by the master and worker nodes"
  value       = aws_key_pair.ansible.key_name
}

output "private_key_file" {
  description = "Private key to copy to the master node before running setup-ansible.sh"
  value       = var.private_key_file
}

output "ansible_setup_command" {
  description = "How to run the playbook on the master node once apply finishes"
  value = join("\n", [
    "ssh ${var.ssh_user}@${aws_instance.master_node.public_ip}",
    "cd ~/ansible && ansible-playbook docker.yml",
  ])
}
