# Deployment

A complete runbook from an empty AWS account to a green pipeline. Commands assume the
project root (the directory containing `Application/`, `Infrastructure/` and `remote_state/`).

---

## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Terraform | ≥ 1.10 | `terraform version` |
| AWS CLI | v2 | `aws sts get-caller-identity` |
| Git | any | `git --version` |
| SSH client | OpenSSH 8+ | `ssh -V` |
| Bash | ≥ 4.4 | `bash --version` |

Create the deploy key if it does not exist:

```bash
ssh-keygen -t ed25519 -a 100 -C "zeetafin-ci-deploy" -f ~/.ssh/id_ed25519
```

No passphrase: both `setup-docker.sh` and GitHub Actions use it non-interactively.

---

## 1. Bootstrap the Terraform state bucket

The main module uses an S3 backend, so the bucket must exist first. `remote_state/` is a
separate root module with local state.

```bash
cd remote_state
terraform init
terraform apply -auto-approve
```

Expected: `docker77-phase3-terraform-state` created with versioning, AES256 encryption and
all four public-access-block flags.

```bash
terraform output
cd ..
```

If the bucket already exists in your account, either import it or change the name in both
`remote_state/main.tf` and `Infrastructure/providers.tf`. The two values are independent
copies; a backend block cannot reference a variable.

---

## 2. Configure the infrastructure

```bash
cp Infrastructure/terraform.tfvars.example Infrastructure/terraform.tfvars
```

Edit at minimum:

```hcl
region             = "eu-north-1"
vpc_cidr           = "10.0.0.0/16"
public_subnet_cidr = "10.0.1.0/24"
instance_type      = "t3.medium"
project            = "DockerCI"
ecr_namespace      = "7"
ecr_repository_name = "zeetafin-ci"
ssh_user           = "ubuntu"

# OIDC trust is scoped to this repository and branch. Change both for a fork.
github_repository  = "Thcosmonaut77/IOTBTech_Guided_Projects"
github_branch      = "main"

# GitHub-hosted runners need port 22 from dynamic addresses. See docs/SECURITY.md.
ssh_ingress_cidrs = ["0.0.0.0/0"]

duckdns_domain    = "zeetafin-ci.duckdns.org"
duckdns_token     = ""          # optional, but it makes the first run automatic
letsencrypt_email = ""          # optional

public_key_file  = "~/.ssh/id_ed25519.pub"
private_key_file = "~/.ssh/id_ed25519"
```

`terraform.tfvars` is git-ignored. Never commit it.

---

## 3. Point DNS at the future host

DuckDNS cannot point at the instance until the instance exists. Two options:

**A. Automatic.** Put the DuckDNS token in `terraform.tfvars`. The bootstrap calls the
DuckDNS update API after the instance has an IP and before certbot runs.

**B. Manual.** Leave the token empty, apply, read the output, update the record at
<https://www.duckdns.org/domains>, then re-run the bootstrap:

```bash
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap
```

The first apply may finish with a warning that the domain does not resolve. The host is
still usable over HTTP; TLS is issued on the re-run.

---

## 4. Apply

```bash
terraform -chdir=Infrastructure init
terraform -chdir=Infrastructure plan
terraform -chdir=Infrastructure apply
```

The apply does two things in order:

1. Creates the networking, security group, key pair, instance, IAM role and instance
   profile, ECR repository and lifecycle policy.
2. Runs `setup-docker.sh` from your machine. It waits for SSH, installs Docker, AWS CLI v2,
   nginx and certbot, uploads `deploy.sh` and `nginx.cfg`, generates `.env`, configures
   nginx and requests a certificate.

Expected tail:

```text
==> Host bootstrap complete
The host at <ip> is ready for the pipeline.
  Application directory : ~/zeetafin
  Deploy script         : ~/zeetafin/deploy.sh
  Secrets file          : ~/zeetafin/.env (preserved across re-runs)
  ...
Nothing is running yet.
```

`https://<domain>` returns `502` at this point because no application container exists.
That is expected.

### If the bootstrap fails

| Error | Cause | Fix |
|---|---|---|
| `cannot reach <ip> over SSH` | Instance still booting, or SG does not allow you | Wait and re-run `terraform apply -replace=terraform_data.bootstrap` |
| `OpenSSH will not accept ...` | Key has a passphrase or wrong permissions | Use an unencrypted key; `chmod 600` |
| `private key ... not found` | Windows path was not translated | Run from Git Bash/WSL, or set `private_key_file` to a path Bash understands |
| `certificate pending` | DNS not propagated | Point the record, then re-run the bootstrap |
| `terraform_data.bootstrap` unchanged | Trigger inputs are the same | Use `-replace=terraform_data.bootstrap` |

---

## 5. Read the outputs

```bash
terraform -chdir=Infrastructure output
terraform -chdir=Infrastructure output -raw github_secret_values
```

The second command prints the values for most GitHub Secrets. It is marked sensitive, so
Terraform shows it only when explicitly requested.

---

## 6. Confirm the OIDC role

The apply already created the GitHub OIDC provider and the ECR push role in
[`Infrastructure/github_oidc.tf`](../Infrastructure/github_oidc.tf). There is no IAM user
and no access key to create.

```bash
terraform -chdir=Infrastructure output -raw github_oidc_role_arn
```

The trust policy only accepts tokens whose subject is
`repo:<github_repository>:ref:refs/heads/<github_branch>`. If the repository or branch is
wrong, the build job fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
Fix `github_repository` / `github_branch` in `terraform.tfvars` and re-apply.

If OIDC is not available, the static-key fallback is documented in
[CI-CD.md § Secrets](CI-CD.md#secrets). It reintroduces [KI-01](KNOWN-ISSUES.md#ki-01).

---

## 7. Configure GitHub Secrets

In the GitHub repository: **Settings → Secrets and variables → Actions → New repository
secret**.

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `terraform output -raw github_oidc_role_arn` |
| `AWS_REGION` | `terraform output -raw aws_region` |
| `ECR_REGISTRY` | `terraform output -raw ecr_registry` |
| `ECR_REPOSITORY` | `terraform output -raw ecr_repository_name` |
| `EC2_HOST` | `terraform output -raw server_public_ip` |
| `EC2_USER` | `terraform output -raw ssh_user` |
| `EC2_SSH_KEY` | `Get-Content ~/.ssh/id_ed25519 -Raw` (or `cat ~/.ssh/id_ed25519`) |
| `EC2_HOST_KEY` | `ssh-keyscan -H <server_public_ip>` — the full output line |
| `APP_BASE_URL` | `terraform output -raw app_url` (no trailing slash) |
| `NEXT_PUBLIC_API_URL` | optional; omit to use `/api` |

There are no `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets. The build job assumes
`AWS_ROLE_ARN` through OIDC and the token is valid only for the workflow run.

Generate the host key secret once the instance exists. The `github_secret_values` output
prints the exact command:

```bash
ssh-keyscan -H "$(terraform -chdir=Infrastructure output -raw server_public_ip)"
```

Paste the whole line, hashed hostname included, as `EC2_HOST_KEY`. The deploy job rejects a
key that does not cover `EC2_HOST`, so a stale value fails fast instead of silently
trusting a new host.

Recommended: create an environment named `production` under **Settings → Environments**
and add required reviewers. The deploy job already references it.

### Workflow placement

| Situation | File to use |
|---|---|
| Phase 3 directory is the repository root | `.github/workflows/deploy.yml` (already there) |
| Using the combined IOTB repository | `.github/workflows/phase3-cicd.yml` at the repository root (already there) |

GitHub only discovers workflows in the repository root `.github/workflows`. A nested
`.github` directory inside a project is inert until that project becomes the root.

---

## 8. First deployment

```bash
git add .
git commit -m "Add Phase 3 CI/CD pipeline"
git push origin main
```

Watch **Actions → Build, Push to ECR and Deploy to EC2**.

Expected sequence:

1. `test` — backend unit tests and frontend typecheck.
2. `build-and-push` — checkout, OIDC auth, ECR login, Buildx, backend build, Trivy gate,
   frontend build, Trivy gate, push both images, summary.
3. `deploy` — SSH keys, upload `deploy.sh`, remote blue/green deploy, external health
   check, `.last_good_tag` recorded.

Expected deploy log:

```text
Logging in to ECR registry <account>.dkr.ecr.eu-north-1.amazonaws.com
Pulling ...:backend-<sha>
Pulling ...:frontend-<sha>
Keeping existing database container zeetafin-db   # second run onward
Active colour is blue; deploying green on ports 3002/3003
Running migrations
Waiting for the green backend
Green backend is up
Waiting for the green frontend
Green frontend is up
Switching nginx upstreams to green
Removing the blue containers
Deployed <sha> successfully.
```

The external check then requests `https://<domain>/api/docs` and `https://<domain>/` and
must receive a successful response from both. On success the tag is written to
`~/zeetafin/.last_good_tag`. If the external check fails, the workflow SSHes back and runs
`deploy.sh --rollback`.

### If the workflow does not start

- Confirm the workflow is at the repository root `.github/workflows/`.
- Confirm the push was to `main` (or use **Run workflow**).
- Check **Settings → Actions → General → Allow all actions**.

### If SSH fails from the runner

The runner's egress address is not in the security group. The example sets
`ssh_ingress_cidrs = ["0.0.0.0/0"]`; if you narrowed it for a self-hosted runner, confirm
the runner's CIDR. See [SECURITY.md § Network exposure](SECURITY.md#network-exposure).

---

## 9. Verify

```bash
curl -sI https://zeetafin-ci.duckdns.org | head -1
curl -s  https://zeetafin-ci.duckdns.org/api/docs | head
```

On the host:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@$(terraform -chdir=Infrastructure output -raw server_public_ip)
docker ps
cat .active_color .deployed_tag .last_good_tag    # in ~/zeetafin
docker inspect --format '{{.Config.Image}}' "zeetafin-be-$(cat ~/zeetafin/.active_color)"
```

The image reference must end in `:backend-<sha>` matching the workflow run, and
`.active_color` names the colour that is serving traffic.

---

## 10. Redeploy and rollback

**Normal redeploy:** push any commit to `main`. Tests, builds, scans and deploys.

**Force a redeploy without a code change:** run the workflow manually with an empty
`image_tag`. It rebuilds the current commit and deploys it.

**Roll back:** run the workflow manually and set `image_tag` to a previous commit SHA that
still exists in ECR. The build job is skipped; only the test and deploy jobs run. See
[OPERATIONS.md § Rollback](OPERATIONS.md#rollback).

**Automatic rollback:** if the host deploy succeeds but the external health check fails,
the workflow runs `deploy.sh --rollback` on the host without operator action.

---

## Full teardown

```bash
terraform -chdir=Infrastructure destroy
terraform -chdir=remote_state destroy
```

This deletes the instance, volume (including the database), ECR repository (including
images) and the state bucket. There is no backup. See
[OPERATIONS.md § Teardown](OPERATIONS.md#teardown).
