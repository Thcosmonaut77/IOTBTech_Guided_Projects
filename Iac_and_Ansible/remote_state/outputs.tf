output "bucket_name" {
  value       = aws_s3_bucket.tf_state.bucket
  description = "S3 bucket for Terraform state"
}

output "region" {
  value       = "eu-north-1"
  description = "Region. Hard-coded to match the provider block in main.tf and the backend in providers.tf."
}