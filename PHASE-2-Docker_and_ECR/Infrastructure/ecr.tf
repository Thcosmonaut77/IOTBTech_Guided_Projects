resource "aws_ecr_repository" "zeetafin" {
  name                 = "${var.ecr_namespace}/${var.ecr_repository_name}"
  image_tag_mutability = "MUTABLE"

  # Lets `terraform destroy` remove the repository even when images are present,
  # so teardown does not need a manual `aws ecr delete-repository --force` first.
  force_delete = true

  tags = { Name = "${var.ecr_namespace}/${var.ecr_repository_name}" }
}
