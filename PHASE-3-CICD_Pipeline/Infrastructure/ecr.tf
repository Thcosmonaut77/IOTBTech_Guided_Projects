resource "aws_ecr_repository" "zeetafin" {
  name                 = "${var.ecr_namespace}/${var.ecr_repository_name}"
  image_tag_mutability = "IMMUTABLE"

  # Scan every image pushed by CI for known OS/package vulnerabilities.
  image_scanning_configuration {
    scan_on_push = true
  }

  # Lets `terraform destroy` remove the repository even when images are present,
  # so teardown does not need a manual `aws ecr delete-repository --force` first.
  force_delete = true

  tags = { Name = "${var.ecr_namespace}/${var.ecr_repository_name}" }
}

# The pipeline pushes two new tags per commit (backend-<sha>, frontend-<sha>)
# plus the moving latest tags. Keep the ten most recent images per prefix and
# expire untagged layers so the repository does not grow without bound.
resource "aws_ecr_lifecycle_policy" "zeetafin" {
  repository = aws_ecr_repository.zeetafin.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the ten most recent backend-<sha> images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["backend-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep the ten most recent frontend-<sha> images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["frontend-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}
