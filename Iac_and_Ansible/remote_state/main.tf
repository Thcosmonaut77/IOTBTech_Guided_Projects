terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-north-1"
}

# Bucket name and region are hard-coded. There are no variables in this module, and
# there cannot usefully be: a backend block cannot reference var.*, so the values in
# providers.tf and the values here are two independent copies of the same string that a
# backend config cannot enforce. See docs/KNOWN-ISSUES.md § KI-10.
resource "aws_s3_bucket" "tf_state" {
  bucket        = "cloud77-terraform-state"
  force_destroy = false # True to destroy. See docs/DEPLOYMENT.md § Full teardown.
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}