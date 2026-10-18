# Deployment

A complete walkthrough from an empty AWS account to a live HTTPS site, with the expected
output at every step and the diagnosis for every failure mode I could reproduce.

> **This costs real money.** The `t3.medium` instance bills from the moment it is created.
> Read [COST.md](COST.md) first, and destroy the stack when you are done.

- [What you are about to do](#what-you-are-about-to-do)
- [Prerequisites](#prerequisites)
- [The one manual step](#the-one-manual-step)
- [Step 0 — Configure](#step-0--configure)
- [Step 1 — Bootstrap the state bucket](#step-1--bootstrap-the-state-bucket)
- [Step 2 — Deploy](#step-2--deploy)
- [The bootstrap in detail](#the-bootstrap-in-detail)
- [Step 3 — Verify the site](#step-3--verify-the-site)
- [Step 4 — Push the images to ECR (manual)](#step-4--push-the-images-to-ecr-manual)
- [Step 5 — Verify ECR](#step-5--verify-ecr)
- [Re-running and updating](#re-running-and-updating)
- [Failure modes and diagnosis](#failure-modes-and-diagnosis)
- [Teardown](#teardown)
- [Rebuilding from scratch](#rebuilding-from-scratch)

---

## What you are about to do

```text
terraform apply
      │
      ├─ Stage 1  Terraform creates 10 resources   (~90 s)
      │             VPC · subnet · IGW · RT · SG · key pair · instance · ECR
      │
      └─ Stage 2  setup-docker.sh drives the host  (~5–10 min)
                    1  resolve server, key and domain
                    2  wait for SSH
                    3  install Docker, AWS CLI, nginx, certbot
                    4  upload the Application/ source
                    5  generate secrets + deploy.sh
                    6  build the two images
                    7  deploy postgres + backend + frontend
                    8  nginx + Let's Encrypt
      │
      ▼
   live HTTPS site
      │
      └─ Stage 3  MANUAL: aws configure + docker push to ECR
```

The bootstrap runs start to finish in a **single pass** — there is no handshake to interrupt
it. It reads the application source from your local `Application/` tree, so that directory
must be present before you apply.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Terraform CLI | **≥ 1.10** (1.15.8 used) | `use_lockfile` needs ≥ 1.10. |
| AWS CLI | v2 | Used on the **host** for the ECR push. |
| AWS credentials | — | Anything the AWS provider supports. **Prefer SSO or a role over long-lived IAM keys.** |
| Permissions | — | `ec2:*`, `ecr:*`, `s3:*` on the state bucket. |
| SSH key pair | ed25519 | `~/.ssh/id_ed25519` + `.pub`, created **before** `apply`. |
| GNU bash | ≥ 4.4 | `setup-docker.sh` runs locally under Git Bash, WSL, Linux or macOS. |
| OpenSSH client | ≥ 8.0 | `ssh`, `scp`, `ssh-keygen`. |
| DuckDNS account | free | To own `zeetafin.duckdns.org` (or a subdomain of your choice). |
| App source | — | Shipped with this repository under `Application/`; `setup-docker.sh` uploads it — no clone, no deploy keys. |

**Generate the SSH key if you do not have one:**

```bash
ssh-keygen -t ed25519 -a 100 -C "zeetafin-deploy" -f ~/.ssh/id_ed25519
```

**On Windows**, run everything from **Git Bash** or **WSL**, never `cmd.exe` or PowerShell.
Terraform's `local-exec` on Windows cannot export environment variables to the child
`bash`, which is exactly why the bootstrap passes the key as a base64 `-K` argument and
`resolve_key()` exists to translate `C:\Users\…\id_ed25519` into a path Bash understands.

---

## The one manual step

Exactly one thing this stack does not automate, and it is deliberate:

1. **`aws configure` on the host** plus the `docker push` to ECR
   ([Step 4](#step-4--push-the-images-to-ecr-manual)). It needs AWS credentials that must not
   live in Terraform state or on the host by default.

---

## Step 0 — Configure

```bash
cp Infrastructure/terraform.tfvars.example Infrastructure/terraform.tfvars
```

Edit `Infrastructure/terraform.tfvars`:

```hcl
region              = "eu-north-1"
vpc_cidr            = "10.0.0.0/16"
public_subnet_cidr  = "10.0.1.0/24"
instance_type       = "t3.medium"
project             = "Docker"
ecr_namespace       = "7"
ecr_repository_name = "zeetafin"

ssh_user            = "ubuntu"
public_key_file     = "~/.ssh/id_ed25519.pub"
private_key_file    = "~/.ssh/id_ed25519"

duckdns_domain      = "zeetafin.duckdns.org"
duckdns_token       = ""     # optional; see below
letsencrypt_email   = ""     # optional
```

`terraform.tfvars` is git-ignored. Never commit it.

| Variable | Effect if set | Effect if empty |
|---|---|---|
| `duckdns_token` | The bootstrap updates the DuckDNS record to the host IP automatically. | The bootstrap prints the record and waits for you to update it manually. |
| `letsencrypt_email` | certbot registers an account with that contact address (expiry notices). | certbot registers without an email; the certificate still works. |

> **There is no `ssh_cidr` variable.** The operator's public IP is resolved at apply time
> from `https://checkip.amazonaws.com` and turned into a `/32`, so moving networks needs
> only a re-apply. See [SECURITY.md](SECURITY.md).

---

## Step 1 — Bootstrap the state bucket

Run **once per AWS account and region**:

```bash
cd remote_state
terraform init
terraform apply -auto-approve
```

Expected:

```text
Apply complete! Resources: 4 added, 0 changed, 0 destroyed.

Outputs:

bucket_name = "docker77-terraform-state"
region      = "eu-north-1"
```

The module creates a versioned, AES-256-encrypted bucket with all four public-access-block
flags set. There are no variables and no `.tfvars` here — the bucket name and region are
literals in `main.tf`, because `Infrastructure/providers.tf`'s `backend` block cannot read
`var.*`.

> This module has **no backend**: its state is a local `terraform.tfstate` in
> `remote_state/`. Back it up before deleting it. See [KI-06](KNOWN-ISSUES.md#ki-06).

Return to the repository root:

```bash
cd ..
```

---

## Step 2 — Deploy

```bash
terraform -chdir=Infrastructure init
terraform -chdir=Infrastructure plan      # review: first plan creates 10 resources
terraform -chdir=Infrastructure apply
```

`terraform init` configures the S3 backend:

```text
Initializing the backend...
Successfully configured the backend "s3"!
Initializing provider plugins...
- Installed hashicorp/aws v5.100.0 (signed by HashiCorp)
- Installed hashicorp/http v3.6.2 (signed by HashiCorp)
Terraform has been successfully initialized!
```

`apply` runs Stage 1, then hands off to Stage 2. The Stage 2 output is interleaved with
Terraform's, because the provisioner streams the script's stdout:

```text
aws_vpc.main: Creating...
...
aws_instance.docker: Creation complete after 42s [id=i-0abc…]
aws_ecr_repository.zeetafin: Creation complete after 3s [id=7/zeetafin]
terraform_data.bootstrap: Creating...
terraform_data.bootstrap: Provisioning with 'local-exec'...
terraform_data.bootstrap (local-exec): ==> 1/8 Resolving target
terraform_data.bootstrap (local-exec):     server : 13.53.x.x (ubuntu)
terraform_data.bootstrap (local-exec):     domain : zeetafin.duckdns.org
terraform_data.bootstrap (local-exec): ==> 2/8 Waiting for SSH on 13.53.x.x
terraform_data.bootstrap (local-exec):     reachable after 6 attempt(s)
...
```

### Where the application source comes from

The ZeetaFin repositories are **not cloned**. The `Application/Backend/ZeetaFin-BE/` and
`Application/Frontend/ZeetaFin-FE/` trees are tracked in this repository and are the source of
truth, and `setup-docker.sh` uploads them at step 4/8:

```bash
tar -czf backend.tar.gz -C Application/Backend/ZeetaFin-BE \
    --exclude='.git' --exclude='node_modules' --exclude='.next' \
    --exclude='dist' --exclude='build' --exclude='.env' .
scp backend.tar.gz frontend.tar.gz ubuntu@<host>:
# on the host: wipe ~/zeetafin/ZeetaFin-{BE,FE}, extract, delete the tarballs
```

Nothing about GitHub, deploy keys or `git` is involved, so the bootstrap never stops to wait
for you. If either source directory is missing it aborts at step 4/8 with:

```text
==> 4/8 Uploading the application source
ERROR: application source not found: Application/Backend/ZeetaFin-BE
       The local Application/ tree is the source of truth; populate it first.
```

To re-upload and rebuild after editing the application, bump `app_source_revision` (any new
value) and re-apply — see [Re-running and updating](#re-running-and-updating).

---

## The bootstrap in detail

`setup-docker.sh` runs on the **operator** machine and prints eight numbered phases. Here is
what each does and what to expect.

### `1/8` Resolve target

```text
==> 1/8 Resolving target
    server : 13.53.x.x (ubuntu)
    domain : zeetafin.duckdns.org
```

Values arrive as flags from `bootstrap.tf`; if you invoked the script by hand they fall back
to `terraform output`. The private key is resolved by `resolve_key()`, which tries the literal
path, `~` expansion, backslash normalisation, a Git-Bash `/mnt/c/…` translation,
`$HOME/.ssh/<basename>`, `$USERPROFILE/.ssh/<basename>`, and finally a glob over
`/mnt/*/Users/*/.ssh/` and `/mnt/*/home/*/.ssh/`. The key is copied to a `chmod 700`
`mktemp -d`, `chmod 600`s, and verified with `ssh-keygen -y` before any SSH is attempted.

### `2/8` Wait for SSH

```text
==> 2/8 Waiting for SSH on 13.53.x.x
    reachable after 6 attempt(s)
```

Up to 30 attempts, 10 s apart (5 minutes). `user_data` is not used, but cloud-init still
takes tens of seconds to bring `sshd` up, and the security group must already permit the
operator's IP.

### `3/8` Install tooling

```text
==> 3/8 Installing Docker, AWS CLI, nginx and certbot
```

Installs `ca-certificates curl gnupg nginx openssl unzip`, then Docker CE from Docker's
official apt repository (GPG-verified), then AWS CLI v2 from the official zip, then
`certbot python3-certbot-nginx`. It also adds the login user to the `docker` group
(`usermod -aG`, idempotent) so the build and deploy sessions — and day-2 work — run Docker
without `sudo`. Idempotent guards (`command -v docker`, `command -v aws`) mean a re-run skips
the installs. Note that **`git` is not installed** — nothing is cloned.

### `4/8` Upload the application source

```text
==> 4/8 Uploading the application source
```

Packs `Application/Backend/ZeetaFin-BE/` and `Application/Frontend/ZeetaFin-FE/` into two
tarballs (excluding `.git`, `node_modules`, `.next`, `dist`, `build` and `.env`), `scp`s them
to the host, then wipes and re-extracts `~/zeetafin/ZeetaFin-BE` and `~/zeetafin/ZeetaFin-FE`.
If either source directory is missing the script exits 1 before touching the host.

### `5/8` Deploy script and secrets

```text
==> 5/8 Uploading deploy.sh and generating secrets
```

Uploads `deploy.sh` (`chmod +x`), then writes `~/zeetafin/.env` (`0600`) with a fresh
`POSTGRES_PASSWORD` (`openssl rand -hex 24`) and `JWT_SECRET` (`openssl rand -hex 32`) —
**only if `.env` is not already present**. A re-run keeps the existing secrets, so the running
database stays reachable; add `-f` to the script to force-regenerate them when a rotation is
actually intended (see [OPERATIONS.md § Rotating secrets](OPERATIONS.md#rotating-secrets-and-credentials)).

### `6/8` Build

```text
==> 6/8 Building the application images
```

`docker build -t zeetafin-be:latest ZeetaFin-BE` and
`docker build -t zeetafin-fe:latest ZeetaFin-FE`. Docker is invoked through the `docker`
group added in `3/8` (falling back to `sudo` if the group is not yet active), so no `sudo` is
needed here. The backend is a multi-stage Node 20 Alpine build; the frontend is a Next.js
`output: 'standalone'` build. Expect **2–5 minutes** and a temporary CPU spike (the build
uses both vCPUs).

### `7/8` Deploy

```text
==> 7/8 Deploying the containers
    ...
    NAMES          STATUS         PORTS
    zeetafin-db    Up 12 seconds  5432/tcp
    zeetafin-be    Up 8 seconds   127.0.0.1:3001->3001/tcp
    zeetafin-fe    Up 8 seconds   127.0.0.1:3000->3000/tcp
```

`deploy.sh` creates the `zeetafin-net` network and `zeetafin-pgdata` volume, starts
PostgreSQL, waits for it, then starts the backend (which runs its seed step against the
database) and the frontend. It polls `http://127.0.0.1:3001/api` until the backend answers.
Note that the ports are published to **`127.0.0.1`** only — the containers are not reachable
from the internet, only through nginx.

### `8/8` nginx and TLS

```text
==> 8/8 Configuring nginx and obtaining a TLS certificate
    zeetafin.duckdns.org -> 13.53.x.x
```

Installs the server block — **first run only**, so a re-run never discards the TLS server
block certbot added — disables the Debian default site and reloads nginx. If a certificate
already exists it is re-applied with `--keep-until-expiring` (no reissue, no DNS wait);
otherwise the script polls DNS and runs `certbot --nginx`. On success the site answers on
HTTPS; if DNS has not propagated, the script reports the certificate as pending and prints the
exact re-run command.

### Done

```text
==> Deployment complete

The application is deployed on 13.53.x.x.
  HTTP : http://zeetafin.duckdns.org
  HTTPS: https://zeetafin.duckdns.org

Remaining manual step — put the images in ECR (needs your AWS credentials):

  ssh -i ~/.ssh/id_ed25519 ubuntu@13.53.x.x
  aws configure
  aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin 123…
  docker tag zeetafin-be:latest 123….dkr.ecr.eu-north-1.amazonaws.com/7/zeetafin:backend  && docker push …
  docker tag zeetafin-fe:latest 123….dkr.ecr.eu-north-1.amazonaws.com/7/zeetafin:frontend && docker push …
```

Terraform then prints the outputs:

```text
Outputs:

app_url             = "https://zeetafin.duckdns.org"
ecr_registry        = "123….dkr.ecr.eu-north-1.amazonaws.com"
ecr_repository_name = "7/zeetafin"
ecr_repository_url  = "123….dkr.ecr.eu-north-1.amazonaws.com/7/zeetafin"
key_name            = "Docker-key"
private_key_file    = "~/.ssh/id_ed25519"
server_public_ip    = "13.53.x.x"
ssh_command         = "ssh -i ~/.ssh/id_ed25519 ubuntu@13.53.x.x"
ssh_user            = "ubuntu"
```

### Environment variables passed to `setup-docker.sh`

| Flag | Source | Meaning |
|---|---|---|
| `-H` | `aws_instance.docker.public_ip` | host IP |
| `-u` | `var.ssh_user` | login user |
| `-K` | `base64encode(pathexpand(var.private_key_file))` | private key path, base64'd so Windows paths and spaces survive |
| `-d` | `var.duckdns_domain` | public hostname |
| `-t` | `var.duckdns_token` (only when set) | DuckDNS API token |
| `-e` | `var.letsencrypt_email` (only when set) | certbot contact |
| `-c` / `-r` / `-R` | ECR outputs | printed in the final ECR hint |
| `-P` | `var.project` | project name |

---

## Step 3 — Verify the site

Open the URL:

```bash
terraform -chdir=Infrastructure output -raw app_url
# https://zeetafin.duckdns.org
```

Checks, in increasing strictness:

```bash
# 1. DNS resolves to the host
dig +short zeetafin.duckdns.org

# 2. HTTP redirects to HTTPS (certbot installed the redirect)
curl -sI http://zeetafin.duckdns.org | head -1        # 301
curl -sI https://zeetafin.duckdns.org | head -1       # 200

# 3. The certificate is valid and issued by Let's Encrypt
echo | openssl s_client -connect zeetafin.duckdns.org:443 -servername zeetafin.duckdns.org 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates

# 4. The backend answers through the reverse proxy
curl -s https://zeetafin.duckdns.org/api/ | head

# 5. The frontend renders
curl -s https://zeetafin.duckdns.org/ | grep -i "<title"
```

Expected: the app loads in the browser over a green padlock, the API responds under `/api/`,
and the certificate issuer is `Let's Encrypt`.

### On the host

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@$(terraform -chdir=Infrastructure output -raw server_public_ip)

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs --tail 40 zeetafin-be
ls -l ~/zeetafin            # deploy.sh · .env · ZeetaFin-BE · ZeetaFin-FE
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo certbot certificates
```

---

## Step 4 — Push the images to ECR (manual)

The images exist on the host. Put them in the registry:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<server_public_ip>

# once per host — only the ECR-push credentials, nothing else
aws configure
#   AWS Access Key ID     : AKIA…
#   AWS Secret Access Key : …
#   Default region name   : eu-north-1
#   Default output format : json

REGISTRY=$(aws ecr describe-repositories \
  --repository-names 7/zeetafin \
  --query 'repositories[0].repositoryUri' --output text | cut -d/ -f1)
REPO=$(aws ecr describe-repositories \
  --repository-names 7/zeetafin \
  --query 'repositories[0].repositoryUri' --output text)

aws ecr get-login-password --region eu-north-1 \
  | docker login --username AWS --password-stdin "$REGISTRY"

docker tag zeetafin-be:latest "$REPO:backend"  && docker push "$REPO:backend"
docker tag zeetafin-fe:latest "$REPO:frontend" && docker push "$REPO:frontend"
```

> **Better:** do not run `aws configure` on the host at all. From your workstation, mint a
> short-lived token and pipe it over SSH, or push from your workstation by pulling the build
> artefacts — see [SECURITY.md](SECURITY.md). The `aws configure` path is what the lab
> documents, not what it recommends.

The exact command block is also printed at the end of the bootstrap and available as an
output:

```bash
terraform -chdir=Infrastructure output -raw ecr_push_commands
```

---

## Step 5 — Verify ECR

```bash
aws ecr describe-images \
  --repository-name 7/zeetafin \
  --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0], imageSizeInBytes]' \
  --output table
```

Expected:

```text
---------------------------------------------
|             DescribeImages                |
+----------+-------------+------------------+
| backend  |  198123456  |                  |
| frontend |   92345678  |                  |
+----------+-------------+------------------+
```

Each image is a few hundred MB. The repository is private; storage and data transfer in are
the only costs.

---

## Re-running and updating

The bootstrap re-runs automatically whenever its inputs change, because
`terraform_data.bootstrap.triggers_replace` includes the host IP, the domain, the SHA-256 of
`setup-docker.sh`, `deploy.sh`, `nginx.cfg`, and the `app_source_revision` marker.

| To do this | Run this |
|---|---|
| Re-run the bootstrap unchanged | `terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap` |
| Re-run after editing `setup-docker.sh` / `deploy.sh` / `nginx.cfg` | `terraform -chdir=Infrastructure apply` |
| Redeploy after editing the application | bump `app_source_revision` in `Infrastructure/terraform.tfvars`, then `terraform -chdir=Infrastructure apply` |
| Refresh after fixing DNS for the certificate | `terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap` |
| Change the instance type | edit `instance_type`, `terraform apply` (replace: the whole bootstrap re-runs on the new host) |

> Bumping `app_source_revision` re-uploads the local `Application/` tree and rebuilds both
> images. The script wipes `~/zeetafin/ZeetaFin-{BE,FE}` on the host before extracting, so the
> upload always matches your local working tree.

> The bootstrap is **safe to re-run**. It writes `~/zeetafin/.env` only on a fresh host, so
> the PostgreSQL password and JWT secret are preserved, and it reuses an existing TLS
> certificate instead of reissuing it. To rotate the secrets deliberately, run
> `setup-docker.sh -f` (see
> [OPERATIONS.md § Rotating secrets](OPERATIONS.md#rotating-secrets-and-credentials)).

> Changing `instance_type`, the AMI or the root volume forces **replacement**. The new host
> gets a new public IP, so the bootstrap re-runs from scratch. See
> [OPERATIONS.md](OPERATIONS.md#replacing-the-host).

---

## Failure modes and diagnosis

| Symptom | Likely cause | Fix |
|---|---|---|
| `Error: Unsupported argument: use_lockfile` | Terraform < 1.10 | Upgrade Terraform. |
| `Provider "registry.terraform.io/hashicorp/http" not found` | `http` provider missing from `required_providers` | It is declared in `providers.tf`; run `terraform init`. |
| `cannot reach 13.53.x.x over SSH` after 5 min | Security group does not include your current IP, or the instance is still booting | Re-run `apply` (re-reads your IP), or check `aws ec2 describe-instances`. |
| `ERROR: OpenSSH will not accept …` | Key is passphrase-protected or world-readable | `ssh-keygen -p` to clear the passphrase, or `chmod 600` the key. |
| Bootstrap stops at `4/8` with `ERROR: application source not found` | The local `Application/Backend/ZeetaFin-BE/` or `Application/Frontend/ZeetaFin-FE/` directory is missing | Populate the local `Application/` tree, then re-run `apply`. |
| `docker build` fails with `no space left on device` | Docker build exceeded the disk | `docker system prune -af`; a 20 GiB volume is enough for one build. |
| `7/8` times out waiting for the backend | DB not ready, or the app threw on boot | `docker logs zeetafin-be`; usually a bad `DB_*` value or a failing seed. |
| `certbot` fails with `DNS problem: NXDOMAIN` | DuckDNS record not pointing at the host | Update the record (or set `duckdns_token`), re-run `apply -replace=terraform_data.bootstrap`. |
| `nginx: [emerg] unknown server_name` | A malformed `duckdns_domain` | Fix the value; the bootstrap only writes the site on the first run, so remove `sudo rm /etc/nginx/sites-available/zeetafin` before re-running if it already exists. |
| Browser shows `NET::ERR_CERT_AUTHORITY_INVALID` | Self-signed/expired cert (certbot did not run) | Check DNS, then re-run the bootstrap. |
| Site works but `/api/` 404s | `server_name` mismatch or backend prefix | `docker logs zeetafin-be`; confirm `app.setGlobalPrefix('api')` and `location /api/`. |
| `docker login` → `no basic auth credentials` | `get-login-password` token not piped | Pipe it through `docker login --password-stdin`. |
| `apply` says "No changes" but the site is down | The provisioner only re-runs when its triggers change | `terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap`. |

---

## Teardown

```bash
terraform -chdir=Infrastructure destroy
```

Because `aws_ecr_repository.zeetafin` sets `force_delete = true`, the repository is removed
even with images in it, and the bootstrap volume goes with the instance. `destroy` does not
stop billing until it completes; confirm afterwards:

```bash
aws ec2 describe-instances --filters "Name=tag:Name,Values=Docker-*" \
  --query 'Reservations[].Instances[].State.Name'
```

To also remove the state bucket:

```bash
cd remote_state && terraform destroy
```

> The `remote_state/` state is local. Destroy it only when you are finished with the project
> — see [KI-06](KNOWN-ISSUES.md#ki-06).

---

## Rebuilding from scratch

```bash
# 1. state bucket (skip if it already exists)
cd remote_state && terraform init && terraform apply -auto-approve && cd ..

# 2. deploy (single pass — no handshake)
terraform -chdir=Infrastructure init
terraform -chdir=Infrastructure apply
```

A full rebuild takes roughly **10–15 minutes**, dominated by the Docker builds. The new
host has a **new public IP**, so update the DuckDNS record (or let the token do it) and
allow a minute for propagation before the certificate step.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — why the stages are split this way.
- [OPERATIONS.md](OPERATIONS.md) — day-2 tasks, credential rotation, host replacement.
- [SECURITY.md](SECURITY.md) — the threat model behind the manual/persistent decisions.
- [COST.md](COST.md) — what each step costs to leave running.
