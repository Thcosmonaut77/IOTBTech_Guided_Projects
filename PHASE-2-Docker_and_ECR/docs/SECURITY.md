# Security

The threat model for a single public host running a real application, written to be used
rather than admired. It states what the design protects, what it explicitly does not, and
what an attacker who wins a given boundary actually obtains.

- [Scope and method](#scope-and-method)
- [Assets](#assets)
- [Actors](#actors)
- [Trust boundaries](#trust-boundaries)
- [Findings](#findings)
- [Credential inventory](#credential-inventory)
- [What is genuinely protected](#what-is-protected)
- [What is not protected](#what-is-not-protected)
- [Remediation roadmap](#remediation-roadmap)

---

## Scope and method

This is a **lab**, and the security posture is judged against a realistic production
baseline, not against a hobby project. The question asked of every decision is: *what does
an attacker gain, and how hard was it?*

The findings below were produced by reading the configuration in this repository — the
Terraform, `setup-docker.sh`, `deploy.sh`, the Dockerfiles and the nginx config — not by
auditing the application or running a scanner. Application-layer vulnerabilities in ZeetaFin
itself are out of scope.

> **This is not a compliance document.** It is a candid threat model. Where a control is
> missing, it says so.

---

## Threat model

### Assets

| Asset | Where it lives | Value |
|---|---|---|
| The live application + user data | `zeetafin-pgdata` volume on the host | Highest — the point of the deployment |
| PostgreSQL password, JWT secret | host `~/zeetafin/.env` | High — full data access / session forgery |
| AWS credentials (ECR push) | host `~/.aws/credentials` | High — whatever IAM policy was attached |
| DuckDNS API token | operator `terraform.tfvars` + process args | Medium — can redirect the hostname |
| SSH private key | operator `~/.ssh/id_ed25519` | High — root-equivalent host access |
| Terraform state | S3 bucket + local `remote_state/` state | High — describes the whole environment |

### Actors

| Actor | Capability | Goal |
|---|---|---|
| **Opportunistic internet scanner** | Port scans, exploit kits against 22/80/443 | Anything it can get |
| **Opportunistic web attacker** | Arbitrary HTTP/HTTPS requests | Exploit the app, funnel traffic, exfiltrate data |
| **Lost/compromised SSH key holder** | Whatever the key opens | Access to the host |
| **Compromised host** | root on the instance, IMDS, all local secrets | Pivot to ECR, the app repos, the AWS account |
| **Curious collaborator** | Read-only repo access | Learn the client's infrastructure |
| **Malicious contributor** | Push access to this repository | Poison the bootstrap script |

### Trust boundaries

```text
  [ Untrusted: the internet ]
        │  443/80 (public)          22 (operator /32 only)
        ▼
   ┌───────────────┐   TLS terminated here
   │      nginx    │
   └──────┬────────┘
          │ loopback only (127.0.0.1:3000 / :3001)
   ┌──────▼───────┐        ┌──────────────┐
   │  frontend /  │───────▶│  postgres    │   docker network zeetafin-net
   │  backend     │        │ (no ports)   │
   └──────────────┘        └──────────────┘
          │
          │  host holds: .env secrets · AWS creds
          ▼
   TRUST BOUNDARY: one process escaping a container reaches all three.

   ┌───────────────┐  S3 backend (TLS, encrypted at rest)
   │  Operator     │──────────────▶  docker77-terraform-state
   │  workstation  │  SSH (operator key)
   └───────────────┘──────────────▶  host
```

The critical observation: **everything of value is on one machine.** Container isolation
buys something against a single application bug, and nothing at all once an attacker has
host access.

---

## Findings

Severity scale: **High** = defeats a control or yields broad compromise; **Medium** = a real
weakness with a mitigating factor; **Low** — hygiene; **Accepted** — a deliberate trade-off.

| ID | Finding | Severity | Status |
|---|---|---|---|
| [S1](#s1--long-lived-aws-credentials-on-the-host) | Long-lived AWS credentials on the host | **High** | Documented |
| [S2](#s2--duckdns-token-leaks-into-the-process-list-and-terraforms-log) | DuckDNS token leaks into the process list / Terraform log | **High** | Open |
| S3 | Published default admin credentials, re-created on every boot | **High** | Open |
| S4 | GitHub deploy keys are long-lived and grant read access to the repos | **High** | **Removed** |
| S5 | Single host: one escape reaches the app, the database and all secrets | **High** | Accepted |
| S6 | SSH host-key verification is TOFU, not authoritative | Medium | Open |
| S7 | No Elastic IP: an IP change silently breaks DNS and TLS | Medium | Open |
| S8 | Secrets live in `.env` on disk, not in a secret manager | Medium | Open |
| S9 | No host hardening: no firewall, no fail2ban, no unattended upgrades | Medium | Open |
| S10 | ECR tags are mutable; no repository policy or lifecycle rule | Medium | Open |
| S11 | Containers have no health check and no resource limits | Medium | Open |
| S12 | HTTP/HTTPS open to `0.0.0.0/0` and egress unrestricted | Accepted | Documented |
| S13 | IMDSv2 was not enforced and the root volume was not encrypted | Medium | **Fixed** |
| S14 | No database backups; `destroy` deletes the data volume | High |

---

### S1 — Long-lived AWS credentials on the host

| | |
|---|---|
| **Where** | `DEPLOYMENT.md` Step 4; `setup-docker.sh` final hint |
| **Severity** | **High** |
| **Related** | [KI-15](KNOWN-ISSUES.md#ki-15) |

The ECR push requires `aws configure` on the host, which writes long-lived IAM access keys
to `~/.aws/credentials`. Any process that reads that file — including a compromised
application container — inherits those keys.

**Impact.** The blast radius is whatever the IAM user can do. A key scoped to `ecr:*` on one
repository is contained; a key belonging to a broadly-permissioned user is account-wide.

**Mitigations in place.** The step is documented as the one manual action and is *not*
automated; the docs explicitly recommend against `aws configure` and offer alternatives.

**Recommended fix.** Never put long-lived keys on the host. Either:
- mint a 12-hour ECR token from your workstation and pipe it over SSH:
  ```bash
  aws ecr get-login-password --region eu-north-1 \
    | ssh ubuntu@<ip> 'docker login --username AWS --password-stdin <registry>'
  ```
- or attach an instance role scoped to `ecr:GetAuthorizationToken` +
  `ecr:BatchCheckLayerAvailability` + `ecr:PutImage` + `ecr:InitiateLayerUpload` +
  `ecr:UploadLayerPart` + `ecr:CompleteLayerUpload` on `7/zeetafin` only, and drop
  `aws configure` entirely.

---

### S2 — DuckDNS token leaks into the process list and Terraform's log

| | |
|---|---|
| **File** | `bootstrap.tf:6`, `setup-docker.sh:113` |
| **Severity** | High |
| **Category** | Secret exposure |

`bootstrap.tf` builds the local-exec command with `-t ${var.duckdns_token}`, so the token
appears in the process argument list on the operator machine **and** in Terraform's
`local-exec` output, which by default is written to the terminal and to CI logs.

**Impact.** Anyone with log access — a shared terminal, a screen recording, a CI job — learns
the token and can repoint the DuckDNS record to an attacker-controlled host, enabling a
convincing TLS-capable phishing site for the same name.

**Patch.** Pass the token by file, exactly as the SSH key is handled:

```hcl
provisioner "local-exec" {
  command = "bash -c 'umask 077; printf %s \"$TOKEN\" > .duckdns_token && bash ./setup-docker.sh … ; rm -f .duckdns_token'"
  environment = { TOKEN = var.duckdns_token }
}
```

`local-exec` supports an `environment` map that is not echoed in the command line. Read
`-t "$(cat token-file)"` inside the script, then delete the file.

---

### S3 — Default seed credentials are published and re-created on boot

| | |
|---|---|
| **Files** | `Application/Backend/ZeetaFin-BE/src/seed.ts`, backend entrypoint |
| **Severity** | High |
| **Category** | Default credentials |

The seed creates `admin@zeeta.com` / `admin123` with role `FINANCE_ADMIN` whenever the
account is missing, and TypeORM runs with `synchronize: true`. The password is in a public
repository and the account is re-created on every boot.

**Impact.** Anyone who reaches the login page has administrator credentials for the
application. There is no forced rotation and no lockout documented in the app.

**Recommended fix.** Seed from environment variables
(`ADMIN_EMAIL`, `ADMIN_PASSWORD`) supplied from `.env`, require the password to be
non-empty, and turn `synchronize` off in favour of migrations. At minimum, change the
password immediately after first login (documented in
[OPERATIONS.md](OPERATIONS.md#the-seed-user)).

---

### S4 — The GitHub deploy keys are long-lived and grant read access to the repos

> **Removed.** The deploy-key delivery model no longer exists: `setup-docker.sh` uploads the
> operator's local `Application/` tree over `scp`, so no key is generated on the host and no
> repository access is required. This entry is kept for the record; the numbering of the
> other findings is unchanged.

| | |
|---|---|
| **File** | *(historical)* `setup-docker.sh` step 4/9 |
| **Severity** | High |
| **Category** | Credential scope and lifetime |

The former design had the host generate **one ed25519 deploy key per repository** (GitHub
refuses to reuse a single deploy key across repos) and the operator register each on its own
repository. Neither key expired or was rotated automatically.

**Impact (then).** Read access to all of the application's source. Asymmetrically, each key was
scoped to a single repository (a genuine improvement over a personal access token), and neither
could write.

**Resolution.** The host no longer holds any repository credential — the application source is
uploaded with `scp` from the operator's machine. See [ARCHITECTURE.md § Application delivery](ARCHITECTURE.md#application-delivery).

---

### S5 — Single host runs everything, so one compromise is total

| | |
|---|---|
| **Files** | `compute.tf`, `deploy.sh` |
| **Severity** | High |
| **Category** | Architecture / blast radius |

The application, the database, the reverse proxy, the AWS credentials and the uploaded
application source all live on one instance. Container isolation separates the workloads from
each other, but a host-level compromise (or a container escape) reaches every asset at once.

**Impact.** There is no second boundary. Whatever an attacker can do to the host —
`.env`, `~/.aws/credentials`, the source in `~/zeetafin/`, the database volume — they can do to
the whole deployment.

**Mitigation.** Nothing structural. This is an explicit, documented trade-off for a lab
([ARCHITECTURE.md](ARCHITECTURE.md)) and is catalogued as
[KI-01](KNOWN-ISSUES.md#ki-01).

**Recommended fix.** Separate the database onto RDS (or another host) and move the
credentials off the host entirely. Both change the cost model significantly.

---

### S6 — SSH host-key verification is TOFU, not authoritative

| | |
|---|---|
| **File** | `setup-docker.sh:160` |
| **Severity** | Medium |
| **Category** | MITM on first contact |

`StrictHostKeyChecking=accept-new` means the first
connection to a host is trusted blindly. On a network where an attacker can intercept the
first SSH session, the operator key is offered to the attacker's host.

**Mitigation.** This is strictly stronger than `StrictHostKeyChecking=no` — a *changed* key
is refused — but it is not authoritative.

**Recommended fix.** Distribute host keys out of band (Terraform can output the instance's
fingerprint; verify it before the first connection), or use SSM Session Manager instead of
SSH entirely.

---

### S7 — No Elastic IP

| | |
|---|---|
| **File** | `compute.tf` |
| **Severity** | Medium |
| **Category** | Availability / correctness |

The instance's public IP is reassigned on stop/start. The DuckDNS record and the Let's
Encrypt certificate both bind to the address; a change silently breaks DNS and the next
renewal.

**Mitigation.** The bootstrap updates DuckDNS automatically when `duckdns_token` is set;
renewals are dry-runnable (`certbot renew --dry-run`).

**Fix.** Add `aws_eip` + `aws_eip_association` (≈ $3.65/month) if the host is long-lived.
See [KI-03](KNOWN-ISSUES.md#ki-03).

---

### S8 — Secrets in a file on disk, not a secret manager

| | |
|---|---|
| **File** | host `~/zeetafin/.env` |
| **Severity** | Medium |
| **Category** | Secret management |

PostgreSQL and JWT secrets are generated with `openssl rand` and stored in a `0600` file.
There is no encryption at rest beyond the encrypted root volume, no rotation automation and
no audit trail.

**Fix.** SSM Parameter Store (SecureString) or Secrets Manager, read at container start.
This is the production answer and is deliberately out of scope here.

---

### S9 — No host hardening

The Ubuntu AMI is used as shipped: no `ufw`, no fail2ban, no `unattended-upgrades`
configuration, no auditd. The **network** security group is the only firewall, and it is a
good one, but a host compromise is not contained by it.

**Fix.** A cloud-init block or a hardening playbook: `unattended-upgrades` for security
patches, fail2ban for SSH, `ufw` as defence in depth, and a non-root deploy user.

---

### S10 — Mutable ECR tags, no lifecycle policy

`image_tag_mutability = "MUTABLE"` lets `:backend` and `:frontend` be overwritten in place,
so a digest recorded yesterday may not be the image it names today. There is no lifecycle
policy, so every push accumulates storage.

**Fix.** `immutable` tags plus content-addressed tags (git SHA), and a lifecycle rule
expiring untagged layers. See [KI-13](KNOWN-ISSUES.md#ki-13).

---

### S11 — No health checks or resource limits

No `HEALTHCHECK` is declared and no CPU/memory limits are set on `docker run`. A runaway
container can starve the host; a wedged process is only visible by reading logs by hand.
(The images *do* run as a non-root user — `USER node` and a UID 1001 `nextjs` user — so that
part is already handled.)

**Fix.** `HEALTHCHECK` directives in both Dockerfiles and `--memory` / `--cpus` on
`docker run` in `deploy.sh`. See [KI-18](KNOWN-ISSUES.md#ki-18).

---

### S12 — Ports 80/443 open to the world, egress unrestricted (accepted)

A public website must accept connections from anywhere on 443; 80 exists for the ACME
HTTP-01 challenge and the redirect. Egress is unrestricted because the host must reach
`apt`, `download.docker.com`, the npm registry, DuckDNS, ECR and Let's Encrypt.

**Accepted**, with the specific claim that this is the minimum that supports the design:
22 is operator-only, 3000/3001 are not exposed at all, and the database is not exposed.

---

### S13 — IMDSv2 not enforced, root volume not encrypted (fixed)

The original `compute.tf` used the AMI defaults: IMDSv1 permitted and no explicit encryption
on the root EBS volume. IMDSv1 is reachable from an SSRF in the application and can leak the
instance profile credentials.

**Fixed** in the current configuration:

```hcl
metadata_options {
  http_endpoint = "enabled"
  http_tokens   = "required"
}
root_block_device {
  volume_type = "gp3"
  volume_size = 20
  encrypted   = true
}
```

This is the cheapest high-value change in the whole repository. See
[KI-14](KNOWN-ISSUES.md#ki-14).

---

### S14 — No database backups

The `zeetafin-pgdata` volume is on the root disk. `terraform destroy`, instance
replacement, or disk failure loses all of it. There is no snapshot schedule and no automated
dump.

**Fix.** EBS snapshot schedule (AWS Data Lifecycle Manager) and a nightly `pg_dump` to S3.
See [OPERATIONS.md § Database operations](OPERATIONS.md#database-operations).

---

## Credential inventory

Every credential in the system, its scope, lifetime and where it lives.

| Credential | Scope | Lifetime | Stored where | Exposure |
|---|---|---|---|---|
| SSH private key | Shell on the host | Until rotated | Operator `~/.ssh/` | Copied to a temp dir during bootstrap |
| EC2 key pair | Shell on the host | Until rotated | AWS; public half in `compute`/`firewall` | Public half is not secret |
| PostgreSQL password | Full DB | Until rotated | Host `.env` | Readable by any host process |
| JWT secret | Forge any session | Until rotated | Host `.env` | Readable by any host process |
| DuckDNS token | Repoint the name | Until rotated | `terraform.tfvars` | **Leaks to logs** — S2 |
| AWS keys (ECR) | IAM policy | Until rotated | Host `~/.aws/credentials` | **S1** |
| Seed admin password | Application admin | Static default | Source code | **Published** — S3 |

---

## What is protected

- **The database is not reachable from the internet.** It has no published port and no
  security-group rule. Only containers on `zeetafin-net` can connect.
- **The application containers are not reachable directly.** They bind to `127.0.0.1`; nginx
  is the only public entry point.
- **SSH is restricted to the operator's current `/32`.** Not to `0.0.0.0/0`.
- **TLS is real.** A Let's Encrypt certificate, renewed automatically, with an HTTP→HTTPS
  redirect.
- **No secret is in the repository.** `git ls-files | grep -Ei 'tfvars|tfstate|\.env$|id_ed25519'`
  is empty, and the `.gitignore` is hardened.
- **The state bucket is private and encrypted**, with versioning and all public-access-block
  flags set.

## What is not protected

- **The host itself.** Compromise the host and you hold every credential listed above.
- **The `ubuntu` user is in the `docker` group.** Deliberate — it lets the bootstrap and day-2
  work run Docker without `sudo` — but it is effectively root-equivalent: any process running
  as `ubuntu` can mount the host filesystem through a container. Because the user already has
  passwordless `sudo`, this only removes the `sudo` prefix rather than widening the blast
  radius.
- **The application.** No WAF, no rate limiting, no security headers, no vulnerability scanning
  of the running images.
- **Availability.** One instance, no redundancy, no automatic recovery.
- **The data at rest beyond the volume.** No database-level encryption, no backups.
- **The build.** Images are built from a moving branch tip with no signature verification.

---

## Remediation roadmap

Ordered by risk reduced per unit of effort.

| Priority | Action | Addresses |
|---|---|---|
| 1 | Stop putting long-lived AWS keys on the host (instance role or SSH-piped token) | S1 |
| 2 | Pass the DuckDNS token as a file, never a CLI argument | S2 |
| 3 | Change the seed credentials and stop shipping a default password | S3 |
| 4 | Enforce IMDSv2 + encrypted root (**done**) | S13 |
| 5 | Add EBS snapshot + nightly `pg_dump` to S3 | S14 |
| 6 | Attach an Elastic IP | S7 |
| 7 | Health checks and resource limits (images already run non-root) | S11 |
| 8 | Immutable ECR tags + lifecycle policy | S10 |
| 9 | Host hardening via cloud-init (unattended-upgrades, fail2ban, ufw) | S9 |
| 10 | Move secrets to SSM Parameter Store / Secrets Manager | S8 |
| 11 | Concurrently rotate the host's credentials on replacement (SSH key, EC2 key pair) | S6 |
| 12 | Distribute SSH host keys out of band, or drop SSH for SSM | S6 |

---

## See also

- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — the defect catalogue, with patches.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the decisions this threat model accepts.
- [OPERATIONS.md](OPERATIONS.md) — the rotation and recovery runbooks.
- [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) — where to start a review.
