# Known Issues

Eighteen defects, catalogued with severity, root cause, impact and a copy-pasteable patch.
This document exists so the repository can be reviewed honestly: everything below was found
by reading the configuration, not by guessing.

**Several entries have since been fixed in the working code.** The **Status** column in the
index records which. Each section marks a fixed entry and describes the original defect, so
the record of what was wrong — and why it mattered — survives the fix. Unfixed entries carry
a patch for the maintainer to apply deliberately.

- [Severity scale](#severity-scale)
- [Index](#index)
- [High severity](#high-severity)
- [Medium severity](#medium-severity)
- [Low severity](#low-severity)
- [Container and script quality issues](#container-and-script-quality-issues)
- [Suggested fix order](#suggested-fix-order)

---

## Severity scale

| Severity | Meaning |
|---|---|
| **High** | Can break the deployment, silently corrupt state, expose a secret, or defeat a security control. Fix before relying on this. |
| **Medium** | Works today but will cause a confusing failure, a silent no-op, or an unexpected replacement. |
| **Low** | Code smell, dead code, or cosmetic. No functional impact. |

---

## Index

| ID | Finding | Severity | File | Status |
|---|---|---|---|---|
| [KI-01](#ki-01) | One host runs the app, the database and the proxy | **High** | `compute.tf`, `deploy.sh` | Accepted / documented |
| [KI-02](#ki-02) | `.gitignore` hid the lock file and did not exclude the application trees | **Medium** | `.gitignore` | **Fixed** |
| [KI-03](#ki-03) | No Elastic IP; the public IP changes on stop/start | **Medium** | `compute.tf` | Open |
| [KI-04](#ki-04) | certbot renewal is untested; a hand-edited nginx config can block reload | **Medium** | `setup-docker.sh` | Open |
| [KI-05](#ki-05) | DuckDNS update is best-effort; a propagation race can fail the first certificate | **Medium** | `setup-docker.sh` | Open |
| [KI-06](#ki-06) | `remote_state/` has no backend; its state is a single local file | **Medium** | `remote_state/` | Open |
| [KI-07](#ki-07) | The DuckDNS token is passed as a CLI argument and leaks to logs | **High** | `bootstrap.tf`, `setup-docker.sh` | Open |
| [KI-08](#ki-08) | SSH host-key verification is TOFU, not authoritative | **High** | `setup-docker.sh` | Open |
| [KI-09](#ki-09) | `setup-docker.sh` is not fully idempotent | **Medium** | `setup-docker.sh` | **Fixed** |
| [KI-10](#ki-10) | The GitHub deploy keys are long-lived and unrotated | **High** | `setup-docker.sh` | **Removed** |
| [KI-11](#ki-11) | Files failed `terraform fmt` | **Low** | multiple | **Fixed** |
| [KI-12](#ki-12) | Images are built on the host, diverging from the repo CI workflow | **Medium** | `setup-docker.sh` | Open |
| [KI-13](#ki-13) | ECR uses mutable tags and has no lifecycle policy | **Medium** | `ecr.tf` | Open |
| [KI-14](#ki-14) | IMDSv1 permitted and the root volume was not explicitly encrypted | **Medium** | `compute.tf` | **Fixed** |
| [KI-15](#ki-15) | No IAM instance role; long-lived AWS keys for the ECR push | **High** | `compute.tf`, `setup-docker.sh` | Open |
| [KI-16](#ki-16) | Security group allows all egress and opens 80/443 to the world | **Low** | `firewall.tf` | Accepted |
| [KI-17](#ki-17) | Shell scripts and configs are vulnerable to CRLF line endings | **Low** | `Application/`, `setup-docker.sh` | **Fixed** |
| [KI-18](#ki-18) | Containers have no health check and no resource limits | **Medium** | Dockerfiles, `deploy.sh` | Open |

---

## High severity

### KI-01

One host runs the application, the database and the reverse proxy

| | |
|---|---|
| **Files** | `compute.tf:6`, `deploy.sh` |
| **Severity** | High |
| **Category** | Architecture / blast radius |

**Current.** A single `aws_instance.docker` hosts nginx, the Next.js frontend, the NestJS
backend, PostgreSQL, the AWS credentials and the uploaded application source.

**Root cause.** Deliberate simplicity. One host is enough for the workload, cheapest to run,
and keeps the whole path visible from one `terraform apply`.

**Impact.** No fault isolation and no second boundary:

- A **container escape** reaches the database volume, `.env`, `~/.aws/credentials` and
  the uploaded source in `~/zeetafin/`.
- A **disk failure** loses the database (there are no backups).
- **Host replacement** — any change to `instance_type`, the AMI, or the root volume — wipes
  the data.
- A resource-exhausting container starves every other workload on the box.

**Rating.** Accepted and documented in [ARCHITECTURE.md](ARCHITECTURE.md) and
[SECURITY.md § S5](SECURITY.md#s5--single-host-runs-everything-so-one-compromise-is-total).
It is called out here because a reviewer should not have to find it.

**Patch (structural).** Move the database to RDS (or a second instance) and take credentials
off the host. Both change the cost model; see [COST.md](COST.md).

**Verification**

```bash
docker ps --format '{{.Names}}'        # three workloads, one host
```

---

## High severity (continued)

### KI-07

The DuckDNS token is passed as a CLI argument and leaks to logs

| | |
|---|---|
| **File** | `bootstrap.tf:6`, `setup-docker.sh:113` |
| **Severity** | High |
| **Category** | Secret exposure |

**Current**

```hcl
duckdns_arg = var.duckdns_token == "" ? "" : "-t ${var.duckdns_token}"
```

```bash
# setup-docker.sh
t) DUCKDNS_TOKEN="$OPTARG" ;;
```

**Root cause.** The token is assembled into the `local-exec` command string, so it appears in
the process argument list (`ps`) and in Terraform's provisioner output, which is written to
the terminal and, in a CI setting, to the build log.

**Impact.** Anyone with log access can repoint the DuckDNS record to a host they control and
serve a validly-certificated phishing page on the project's own name. The token never expires
unless rotated.

**Patch.** Pass it as a **file**, the same way the SSH key already is:

```hcl
provisioner "local-exec" {
  command = join(" ", [
    "bash ./setup-docker.sh",
    # … existing flags …
    var.duckdns_token == "" ? "" : "-t-file ${path.module}/.duckdns_token",
  ])
  working_dir = path.module
}
```

```bash
# write it 0600 before the provisioner, delete it after; read it with $(cat)
```

Or keep `-t` but read the value from `TF_VAR_duckdns_token` inside the script rather than from
`$OPTARG`.

**Verification**

```bash
bash -x Infrastructure/setup-docker.sh -H <ip> -t SECRET 2>&1 | grep -c SECRET   # should be 0 after the fix
```

---

### KI-08

SSH host-key verification is TOFU, not authoritative

| | |
|---|---|
| **File** | `setup-docker.sh:160` |
| **Severity** | High |
| **Category** | MITM on first contact |

**Current**

```bash
SSH_CMD=(ssh -i "$LOCAL_TMP/key" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new \
  -o UserKnownHostsFile="$LOCAL_TMP/known_hosts" \
  "$SSH_USER@$SERVER_IP")
```

The same treatment is given to GitHub via `ssh-keyscan -t ed25519,rsa github.com`.

**Root cause.** The host key is not known before the first connection, so it is trusted on
first use. `accept-new` records it and refuses a *changed* key later.

**Impact.** On a network where the first SSH session can be intercepted, the operator's key
is offered to the attacker's host. `ssh-keyscan` for GitHub has the same weakness, though
GitHub's keys are widely published and could be pinned.

**Mitigation.** Materially better than `StrictHostKeyChecking=no` (a changed key is
rejected), and the SSH security group already restricts the source to the operator `/32`.

**Patch.** Publish the instance host-key fingerprint as a Terraform output and verify it
before the first connection, or pin GitHub's published keys instead of scanning them.

**Verification**

```bash
grep -c "accept-new" Infrastructure/setup-docker.sh    # 0 after the fix
```

---

### KI-10

The GitHub deploy keys are long-lived and unrotated

| | |
|---|---|
| **File** | *(historical)* `setup-docker.sh:213–236` |
| **Severity** | High |
| **Category** | Credential lifetime |

**Removed.** The deploy-key delivery model no longer exists: `setup-docker.sh` uploads the
operator's local `Application/` tree over `scp`, so the host generates no keys and needs no
repository access. This entry is kept for the record; the numbering is unchanged.

**What it was.** The host generated one ed25519 deploy key per repository (GitHub refuses to
reuse a single deploy key across repos) and the operator registered each on its own
repository. The keys were generated once and reused forever — no rotation step, no expiry.

**Impact (then).** A host compromise yielded read access to all of the application's source.
Each key was scoped to a single repository — narrower than a PAT or account key — and only the
public halves left the host.

**Resolution.** The host holds **no** repository credential at all; the application source is
pushed from the operator's machine. See
[ARCHITECTURE.md § Application delivery](ARCHITECTURE.md#application-delivery).

---

### KI-15

No IAM instance role; long-lived AWS keys for the ECR push

| | |
|---|---|
| **Files** | `compute.tf`, `setup-docker.sh:390` |
| **Severity** | High |
| **Category** | Credential management |

**Current.** The bootstrap's final instruction is `aws configure` on the host, which writes
long-lived access keys to `~/.aws/credentials`.

**Root cause.** The ECR push is deliberately left manual (see
[ARCHITECTURE.md](ARCHITECTURE.md#the-bootstrap-model)), and the simplest way to authenticate
is the standard CLI login — which stores persistent keys.

**Impact.** Any process that reads `~/.aws/credentials` inherits the IAM user's permissions.
Combined with KI-01 (everything on one host), this is the highest-value credential in the
deployment after the database password.

**Mitigation.** The docs recommend against it and offer alternatives; the step is not
automated.

**Patch (preferred).** Attach a least-privilege instance role:

```hcl
resource "aws_iam_role" "host" {
  name = "${var.project}-ecr-push"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "ecr_push" {
  role = aws_iam_role.host.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ecr:GetAuthorizationToken"]
      Resource = "*"
    }, {
      Effect = "Allow"
      Action = [
        "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
        "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"
      ]
      Resource = aws_ecr_repository.zeetafin.arn
    }]
  })
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.project}-profile"
  role = aws_iam_role.host.name
}

# aws_instance.docker gains:
iam_instance_profile = aws_iam_instance_profile.host.name
```

Then drop `aws configure` and everything works with temporary, rotated credentials.

**Alternative.** Mint a 12-hour token on the workstation and pipe it over SSH
([SECURITY.md § S1](SECURITY.md#s1--long-lived-aws-credentials-on-the-host)).

---

## Medium severity

### KI-02

`.gitignore` hid the lock file and did not exclude the application trees

| | |
|---|---|
| **File** | `.gitignore` |
| **Severity** | Medium |
| **Status** | **Fixed** |

**Original defect.** The first `.gitignore` matched `.terraform*`, which swallowed
`.terraform.lock.hcl` — a file that **must** be committed so provider selections are
reproducible. It also did not exclude the local `Application/Backend/` and
`Application/Frontend/` source trees. At the time the application code was meant to stay out,
so that was one `git add .` away from being pushed to this public repository.

**Patch (already applied).**

```gitignore
# Provider cache. NOTE: `.terraform*` would hide .terraform.lock.hcl — exclude it.
.terraform/
*.tfstate
*.tfstate.*
```

**Resolution note.** The second half of this issue — excluding the application trees — was
later **superseded**, not fixed: the application source is now deliberately tracked in this
repository (see [ARCHITECTURE.md § Application delivery](ARCHITECTURE.md#application-delivery)),
so `Application/Backend/` and `Application/Frontend/` are no longer ignored. Runtime `.env`
files still are, and that is the part that matters.

**Verification**

```bash
git check-ignore -v Infrastructure/.terraform.lock.hcl       # must be silent (not ignored)
git check-ignore -v Application/Frontend/ZeetaFin-FE/.env    # must be ignored
git ls-files Application/Backend/ZeetaFin-BE | head          # must list source files
```

---

### KI-03

No Elastic IP; the public IP changes on stop/start

| | |
|---|---|
| **File** | `compute.tf:6–29` |
| **Severity** | Medium |
| **Category** | Availability / correctness |

**Current.** `associate_public_ip_address = true` with no `aws_eip`. The address is released
when the instance stops and a different one is assigned on start.

**Impact.** The DuckDNS record and the Let's Encrypt certificate are both bound to the
address. A stop/start silently breaks DNS; the certificate keeps working until it renews,
then fails. `terraform apply` also cannot fix it — only an external DNS update can.

**Mitigation.** The bootstrap updates DuckDNS when `duckdns_token` is set.

**Patch**

```hcl
resource "aws_eip" "docker" {
  domain = "vpc"
  tags   = { Name = "${var.project}-eip" }
}

resource "aws_eip_association" "docker" {
  instance_id   = aws_instance.docker.id
  allocation_id = aws_eip.docker.id
}
```

Costs $0.005/hr while attached (≈ $3.65/month). Adjust `data.http.my_ip` usage and the
outputs accordingly.

**Verification**

```bash
terraform -chdir=Infrastructure output -raw server_public_ip
# stop and start the instance, then re-run the output — it must be unchanged
```

---

### KI-04

certbot renewal is untested; a hand-edited nginx config can block reload

| | |
|---|---|
| **File** | `setup-docker.sh:334–352`, `Application/nginx.cfg` |
| **Severity** | Medium |
| **Category** | Operational |

**Current.** The bootstrap runs `certbot --nginx` once. Renewal is delegated entirely to
certbot's systemd timer, which the script never tests.

**Root cause.** `certbot renew` runs `nginx -t` before reloading and refuses to reload a
broken configuration, so a *renewal* cannot break a valid site. But a **hand-edited**
`/etc/nginx/sites-available/zeetafin` (which the next bootstrap overwrites anyway) or a
missing `server_name` can leave the reload failing, and the failure is quiet.

**Impact.** A certificate can expire without anyone noticing because the renewal path was
never validated on this host. This is the classic "it worked when I set it up" TLS outage.

**Patch.** After installing nginx and before finishing, prove the renewal path:

```bash
"${SSH_CMD[@]}" 'sudo certbot renew --dry-run'
```

And add a `--deploy-hook` that verifies nginx after reload. See
[OPERATIONS.md § TLS certificate operations](OPERATIONS.md#tls-certificate-operations).

**Verification**

```bash
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

---

### KI-05

DuckDNS update is best-effort; a propagation race can fail the first certificate

| | |
|---|---|
| **File** | `setup-docker.sh:338–362` |
| **Severity** | Medium |
| **Category** | Race condition |

**Current.** The DuckDNS update is issued with `|| true`, and the DNS poll runs for at most
30 × 10 s. If the record has not propagated when the poll ends, certbot is skipped.

**Impact.** A fresh deployment can finish with the site on HTTP and no certificate, requiring
a second `apply`. The script handles this gracefully (it does not fail the apply and prints
the fix), but the first run does not always end on HTTPS.

**Patch.** Increase the poll budget, or request the certificate over a longer window with
retries and backoff. A more robust option is `certbot --preferred-challenges dns` with a
DuckDNS TXT record, removing the HTTP-01 dependency on the A record entirely.

**Verification**

```bash
# with a stale token
sudo certbot certificates     # confirm the cert exists after the retry
```

---

### KI-06

`remote_state/` has no backend; its state is a single local file

| | |
|---|---|
| **File** | `remote_state/main.tf`, `remote_state/terraform.tfstate` |
| **Severity** | Medium |
| **Category** | State safety |

**Current.** The bootstrap module that creates the S3 bucket cannot store its own state in
that bucket — the bootstrap paradox. Its state is a local, git-ignored `terraform.tfstate`.

**Impact.** Lose that file and you re-`import` the bucket and its three configuration
resources by hand. Two operators applying `remote_state` concurrently can also diverge,
because there is no lock.

**Mitigation.** The module destroys cleanly (`force_destroy = true`) and is trivial to
recreate.

**Patch.** Back the file up out of band (a private bucket, or a password manager) and
document that it is the one piece of state not covered by the S3 backend.

**Verification**

```bash
ls -la remote_state/terraform.tfstate    # exists; back it up
```

---

### KI-09

`setup-docker.sh` is not fully idempotent

| | |
|---|---|
| **File** | `Infrastructure/setup-docker.sh` |
| **Severity** | Medium |
| **Category** | Idempotency |
| **Status** | **Fixed** |

**Original defect.** Several steps ran unconditionally, so a re-run **rotated the
PostgreSQL password and JWT secret** and rebuilt the nginx site. Because `deploy.sh` recreates
the DB container but keeps the volume, changing `POSTGRES_PASSWORD` without an `ALTER USER`
left the container unable to authenticate; and re-installing the nginx site discarded the 443
server block certbot had added.

**Fix.** Secret generation is now conditional on the remote `.env` not existing, so a re-run
keeps the secrets that the running database already uses; a new `-f` flag forces a rotation
when one is actually intended. The nginx site is written only on the first run, and an
existing certificate is re-applied with `--keep-until-expiring` instead of being reissued or
gated on the DNS poll. The Docker images are still rebuilt on every run, which is intentional —
it is what makes a source revision change take effect.

**Verification.** Boot the stack, note the DB password, re-run
`terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap`, and confirm the
containers still authenticate and the certificate is unchanged. See
[OPERATIONS.md § Rotating secrets](OPERATIONS.md#rotating-secrets-and-credentials) for the
deliberate rotation path.

---

### KI-12

Images are built on the host, diverging from the in-repo CI workflow

| | |
|---|---|
| **File** | `setup-docker.sh:305–311` |
| **Severity** | Medium |
| **Category** | Consistency / drift |

**Current.** The bootstrap runs `docker build` on the instance. The application repositories
also contain `.github/workflows/cicd.yml`, which builds images in GitHub Actions.

**Impact.** Two independent build paths can produce different images from the same commit
(different base-image pulls, different build args). Nothing guarantees the image running on
the host matches what CI would build, and the host pays the build cost in CPU and time.

**Patch.** Pick one path. To align on CI, change the bootstrap to `docker pull` the
SHA-tagged image from ECR instead of building, and remove the build step. This also removes
the npm/apt build load from the small instance.

**Verification**

```bash
docker image inspect zeetafin-be:latest --format '{{.Id}}'
# compare with the digest in ECR for the same commit
```

---

### KI-13

ECR uses mutable tags and has no lifecycle policy

| | |
|---|---|
| **File** | `ecr.tf:3` |
| **Severity** | Medium |
| **Category** | Reproducibility / cost |

**Current**

```hcl
image_tag_mutability = "MUTABLE"
```

**Impact.** `:backend` and `:frontend` can be overwritten in place, so a tag is not a stable
reference to a build. Untagged layers accumulate and are billed at $0.10/GiB-month.

**Patch**

```hcl
resource "aws_ecr_repository" "zeetafin" {
  name                 = "${var.ecr_namespace}/${var.ecr_repository_name}"
  image_tag_mutability = "IMMUTABLE"
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "zeetafin" {
  repository = aws_ecr_repository.zeetafin.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}
```

With immutable tags, push content-addressed tags (the git SHA) alongside the moving ones.

**Verification**

```bash
aws ecr describe-repositories --repository-names 7/zeetafin \
  --query 'repositories[0].imageTagMutability'      # IMMUTABLE
```

---

### KI-14

IMDSv1 permitted and the root volume was not explicitly encrypted

| | |
|---|---|
| **File** | `compute.tf` |
| **Severity** | Medium |
| **Category** | Hardening |

**Original defect.** The instance used the AMI defaults: Instance Metadata Service v1 was
reachable, and no encryption was specified on the root `gp3` volume.

**Impact.** An SSRF in the application could read `http://169.254.169.254/…` and, once an IAM
role exists ([KI-15](#ki-15)), steal its credentials. An unencrypted root disk exposes the
database volume and `.env` to anyone who can detach it.

**Fixed.** The current `compute.tf` sets:

```hcl
metadata_options {
  http_endpoint = "enabled"
  http_tokens   = "required"      # IMDSv2 only
}

root_block_device {
  volume_type = "gp3"
  volume_size = 20
  encrypted   = true
}
```

**Verification**

```bash
aws ec2 describe-instances --instance-ids <id> \
  --query 'Reservations[0].Instances[0].MetadataOptions.HttpTokens'   # required
aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=<id> \
  --query 'Volumes[0].Encrypted'                                      # true
```

---

### KI-18

Containers have no health check and no resource limits

| | |
|---|---|
| **Files** | application Dockerfiles, `deploy.sh:55–72` |
| **Severity** | Medium |
| **Category** | Container hardening |

**Current.** `deploy.sh` runs each container with `docker run -d --name … --restart …` and
no `--memory`, `--cpus` or `--health-cmd`. Neither Dockerfile declares a `HEALTHCHECK`. Both
images *do* run as a non-root user (`USER node` in the backend, a UID 1001 `nextjs` user in
the frontend) and are multi-stage builds, so that part is already done.

**Impact.** A runaway container can consume the whole host (there is no cgroup limit), and a
wedged process is only visible via a manual `docker logs` — there is no orchestrator to
notice and restart it.

**Patch**

```bash
docker run -d --name "${BE_CONTAINER}" --network "${NETWORK}" \
  --restart "${RESTART_POLICY}" \
  --memory 768m --cpus 1.0 \
  --health-cmd "wget -qO- http://127.0.0.1:3001/api/ >/dev/null || exit 1" \
  --health-interval 30s --health-retries 3 \
  -p "${BIND_ADDR}:${BACKEND_PORT}:3001" \
  … "${BE_IMAGE}"
```

and a `HEALTHCHECK` in each Dockerfile (the non-root `USER` line is already present):

```dockerfile
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/api/ || exit 1
```

**Verification**

```bash
docker inspect zeetafin-be --format '{{.Config.User}}'          # node
docker inspect zeetafin-be --format '{{.State.Health.Status}}'  # healthy
docker inspect zeetafin-be --format '{{.HostConfig.Memory}}'    # non-zero
```

---

## Low severity

### KI-11

Files failed `terraform fmt`

| | |
|---|---|
| **File** | multiple |
| **Severity** | Low |
| **Status** | **Fixed** |

**Original defect.** Early revisions had misaligned `=` signs and inconsistent indentation in
`bootstrap.tf`, `firewall.tf`, `compute.tf`, `outputs.tf` and `variables.tf`.

**Impact.** Cosmetic; it also made `terraform fmt -check` fail, so the format check could not
be used as a gate.

**Fixed.** `terraform fmt -recursive` is clean.

**Verification**

```bash
terraform -chdir=Infrastructure fmt -check -recursive   # no output
```

---

### KI-16

Security group allows all egress and opens 80/443 to the world

| | |
|---|---|
| **File** | `firewall.tf:18–40` |
| **Severity** | Low |
| **Category** | Least privilege |

**Current.** Ingress 80 and 443 from `0.0.0.0/0`; egress all protocols to `0.0.0.0/0`.

**Impact.** The public site is intentionally reachable by anyone. Unrestricted egress gives
an attacker who reaches the host a wide exfiltration channel.

**Rating.** **Accepted.** A public website must accept 443 from anywhere, and the host must
reach `apt`, Docker Hub, the npm registry, DuckDNS, ECR and Let's Encrypt. Restricting egress to a
destination allow-list is possible but operationally brittle.

**Patch (optional).** Replace the single egress rule with allow-lists for 443 to the specific
endpoints, then assess whether the DNS and package paths still work.

---

### KI-17

Shell scripts and configs are vulnerable to CRLF line endings

| | |
|---|---|
| **Files** | `Infrastructure/setup-docker.sh`, `Application/deploy.sh`, `Application/nginx.cfg`, `.gitattributes` |
| **Severity** | Low |
| **Category** | Portability |

**Original defect.** On Windows checkouts, Git's `core.autocrlf` can convert these files to
CRLF, at which point the remote shell fails with `bad interpreter: /usr/bin/env bash^M` and
the app `.env` cannot be sourced.

**Fixed.** `.gitattributes` forces LF for `*.sh`, `*.cfg`, `*.conf`, `*.env*`, `*.yml` and
`.gitattributes` normalises line endings at checkout.

**Verification**

```bash
git check-attr text eol -- Infrastructure/setup-docker.sh   # text, eol=lf
file Infrastructure/setup-docker.sh                         # ... with no CRLF
```

---

## Container and script quality issues

These are captured above as their own entries (KI-12, KI-17, KI-18) but collected here
because they share a cause: the scripts and images were written to work, not to be hardened.

| Area | Issue | Entry |
|---|---|---|
| Containers | No `HEALTHCHECK`, no resource limits (images already run non-root) | [KI-18](#ki-18) |
| Builds | On-host build diverges from the repo's CI workflow | [KI-12](#ki-12) |
| Portability | CRLF line endings | [KI-17](#ki-17) |
| Idempotency | `.env` and secrets regenerated on every bootstrap | [KI-09](#ki-09) (**fixed**) |

---

## Suggested fix order

1. [KI-15](#ki-15) — get long-lived AWS keys off the host.
2. [KI-07](#ki-07) — stop leaking the DuckDNS token.
3. [KI-14](#ki-14) — enforce IMDSv2 + encryption (**done**).
4. [KI-01](#ki-01) — decide whether the database belongs on the host.
5. [KI-09](#ki-09) — make the bootstrap safely re-runnable (**done**).
6. [KI-03](#ki-03) — attach an Elastic IP.
7. [KI-04](#ki-04) / [KI-05](#ki-05) — make TLS renewal reliable.
8. [KI-18](#ki-18) — container hardening.
9. [KI-13](#ki-13) — immutable ECR tags + lifecycle.
10. [KI-12](#ki-12) — pick one build path.
11. [KI-06](#ki-06) — back up the bootstrap state.
12. [KI-08](#ki-08) — authoritative SSH host keys.

---

## See also

- [SECURITY.md](SECURITY.md) — the threat model these findings roll up into.
- [OPERATIONS.md](OPERATIONS.md) — the runbooks that patch several of these.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the decisions behind the accepted entries.
- [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) — where to start.
