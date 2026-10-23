# Pull-only access to the application repository. The instance assumes this
# role through IMDSv2; no AWS access keys are written to the host, Terraform
# state, or GitHub for the deploy step. The pipeline itself authenticates with
# GitHub Secrets and only needs push rights to ECR.
data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2_ecr_pull" {
  name               = "${var.project}-ec2-ecr-pull"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = { Name = "${var.project}-ec2-ecr-pull" }
}

data "aws_iam_policy_document" "ec2_ecr_pull" {
  statement {
    sid       = "EcrAuthorizationToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PullApplicationImages"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.zeetafin.arn]
  }
}

resource "aws_iam_role_policy" "ec2_ecr_pull" {
  name   = "${var.project}-ecr-pull"
  role   = aws_iam_role.ec2_ecr_pull.id
  policy = data.aws_iam_policy_document.ec2_ecr_pull.json
}

resource "aws_iam_instance_profile" "docker" {
  name = "${var.project}-instance-profile"
  role = aws_iam_role.ec2_ecr_pull.name
  tags = { Name = "${var.project}-instance-profile" }
}
