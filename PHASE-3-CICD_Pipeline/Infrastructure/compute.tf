# Latest Ubuntu 24.04 LTS AMI
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_instance" "docker" {
  ami                         = data.aws_ssm_parameter.ubuntu.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  key_name                    = aws_key_pair.docker.key_name
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.docker.name

  # IMDSv2 only. Blocks the SSRF-to-credentials class of attack against the
  # instance metadata service.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  # CI builds the images, but the host still needs room for pulled image layers,
  # the PostgreSQL volume and logs. 20 GiB gp3 is encrypted at rest.
  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = { Name = "${var.project}-Server" }
}
