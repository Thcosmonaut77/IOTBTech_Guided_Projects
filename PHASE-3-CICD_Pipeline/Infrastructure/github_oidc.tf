# GitHub Actions authenticates to AWS with a short-lived OIDC token instead of
# long-lived access keys. The role is scoped to one repository, one branch and
# one ECR repository. Only the build-and-push job needs it; the deploy job uses
# SSH and the EC2 instance profile does the pulling.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = { Name = "${var.project}-github-oidc" }
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = ["repo:Thcosmonaut77@221428017/IOTBTech_Guided_Projects@1406576076"]
    }
  }
}

resource "aws_iam_role" "github_ecr_push" {
  name               = "${var.project}-github-ecr-push"
  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json
  tags               = { Name = "${var.project}-github-ecr-push" }
}

data "aws_iam_policy_document" "github_ecr_push" {
  statement {
    sid       = "EcrAuthorizationToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PushApplicationImages"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [aws_ecr_repository.zeetafin.arn]
  }
}

resource "aws_iam_role_policy" "github_ecr_push" {
  name   = "${var.project}-github-ecr-push"
  role   = aws_iam_role.github_ecr_push.id
  policy = data.aws_iam_policy_document.github_ecr_push.json
}
