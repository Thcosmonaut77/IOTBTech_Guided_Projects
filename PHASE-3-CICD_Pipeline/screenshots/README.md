# Evidence

The project brief asks for screenshots of the successful pipeline and the running
application. This repository does not ship fabricated evidence. Capture the four images
below from a real deployment, redact them, and commit them here.

Suggested filenames:

| File | What it must show |
|---|---|
| `github-actions-success.png` | The workflow run in GitHub Actions with the `test`, `build-and-push` and `deploy` jobs green and the commit SHA visible |
| `ecr-images.png` | The ECR repository `7/zeetafin-ci` with `backend-<sha>` and `frontend-<sha>` tags, or the output of `aws ecr describe-images` |
| `ec2-containers.png` | `docker ps` on the host showing `zeetafin-db` and the active `zeetafin-be-<colour>` / `zeetafin-fe-<colour>` containers up, plus `cat ~/zeetafin/.active_color` |
| `application-live.png` | The ZeetaFin login or dashboard page loaded over HTTPS in a browser, with the address bar visible |

Optional extras:

| File | What it shows |
|---|---|
| `deploy-job-log.png` | The deploy job log with `Pulling`, `deploying green`, `Green backend is up`, `Switching nginx upstreams to green` and `Deployed <sha> successfully.` |
| `terraform-output.png` | `terraform output` with sensitive values hidden |
| `certificate.png` | The browser certificate panel for the domain |

## Capture commands

```bash
# Workflow runs
gh run list --workflow "Build, Push to ECR and Deploy to EC2" --limit 5
gh run view <run-id>

# ECR tags
aws ecr describe-images --repository-name 7/zeetafin-ci \
  --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0], imageSizeInBytes, imagePushedAt]' \
  --output table

# Host containers
ssh -i ~/.ssh/id_ed25519 ubuntu@<host> \
  "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# The live site
curl -sI https://<domain> | head -1
```

## Redaction rules

Screenshots from a real AWS account contain identifiers that must not be published. Before
committing, remove or mask:

- AWS account IDs (12 digits)
- ARNs, including ECR registry hostnames that embed the account ID
- EC2 instance IDs (`i-…`) and public IP addresses
- Security group IDs (`sg-…`), VPC IDs (`vpc-…`) and subnet IDs (`subnet-…`)
- The repository owner/name if you do not want it public
- Email addresses from certbot output
- Any part of `.env`, `terraform.tfvars`, GitHub Secrets, or an access key
- The private key fingerprint and `$HOME` paths if they identify you

A useful check before `git add`:

```bash
git diff --cached --stat
grep -RInE '([0-9]{12}|i-[0-9a-f]{8,}|sg-[0-9a-f]{8,}|vpc-[0-9a-f]{8,}|[0-9]{1,3}(\.[0-9]{1,3}){3})' screenshots/
```

`grep` cannot see inside PNGs. Redact the image itself (a filled rectangle over the
identifier) rather than relying on the file name or a caption.

## What not to do

- Do not commit a screenshot of a terminal that contains `cat .env` output.
- Do not commit a screenshot of the GitHub Secrets page; it shows names, and sometimes
  values in the UI.
- Do not commit a screenshot of the AWS console with the account menu open.
- Do not use a screenshot from a different project or a mock-up.
