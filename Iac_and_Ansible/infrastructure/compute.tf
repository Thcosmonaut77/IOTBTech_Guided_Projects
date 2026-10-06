# Latest Ubuntu 24.04 LTS AMI
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_instance" "master_node" {
  ami                         = data.aws_ssm_parameter.ubuntu.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  key_name                    = aws_key_pair.ansible.key_name
  associate_public_ip_address = true

  tags = { Name = "${var.project}-Master-Server" }
}

resource "aws_instance" "worker_node" {
  ami                         = data.aws_ssm_parameter.ubuntu.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  key_name                    = aws_key_pair.ansible.key_name
  associate_public_ip_address = true
  count                       = 2

  tags = { Name = "${var.project}-Worker-Server${count.index + 1}" }
}