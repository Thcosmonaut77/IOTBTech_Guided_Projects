locals {
  # The operator's current public IP, resolved from checkip.amazonaws.com.
  operator_cidr = "${chomp(data.http.my_ip.response_body)}/32"

  # Operator SSH is always allowed. Additional ranges (for example a
  # self-hosted GitHub runner, or 0.0.0.0/0 for GitHub-hosted runners) come from
  # var.ssh_ingress_cidrs. See docs/SECURITY.md before widening this.
  ssh_cidrs = distinct(concat([local.operator_cidr], var.ssh_ingress_cidrs))
}

resource "aws_security_group" "ec2" {
  name        = "${var.project}-sg"
  description = "Public web edge: SSH from the operator and CI, HTTP/HTTPS from anywhere"
  vpc_id      = aws_vpc.main.id

  dynamic "ingress" {
    for_each = toset(local.ssh_cidrs)
    content {
      description = "SSH from ${ingress.value}"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  # The application is reached through the host's nginx reverse proxy on 80/443.
  # The containers themselves bind to 127.0.0.1 and are never publicly exposed.
  ingress {
    description = "HTTP for nginx and the ACME HTTP-01 challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all egress: image pulls, apt, GitHub and Lets Encrypt"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-sg" }
}

resource "aws_key_pair" "docker" {
  key_name   = "${var.project}-key"
  public_key = file(pathexpand(var.public_key_file))
  tags       = { Name = "${var.project}-keypair" }
}

data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}
