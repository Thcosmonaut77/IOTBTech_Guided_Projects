# Security

This document describes the threat model for the Phase 3 stack, the credential boundaries
between GitHub and AWS, and the controls that are **not** implemented. The project is a
learning deployment; it is not a production hardening guide.

---

## Credential inventory

| Credential | Where it lives | Scope | Rotation |
|---|---|---|---|
| GitHub OIDC token | Runner, in-memory | Assume one IAM role for the workflow lifetime | Automatic, minutes |
| `EC2_SSH_KEY` | GitHub repository secrets | SSH as `ubuntu` on one host | Manual |
| `EC2_HOST_KEY` | GitHub repository secrets | Pin the host identity in `known_hosts` | Manual; refresh when the instance changes |
| Operator SSH private key | Operator workstation | SSH as `ubuntu` on one host | Manual |
| `POSTGRES_PASSWORD` | `~/zeetafin/.env` on the host, mode 600 | Database user | Manual; `setup-docker.sh -f` rotates but desyncs the existing volume |
| `JWT_SECRET` | `~/zeetafin/.env` on the host, mode 600 | Application token signing | Manual; same caveat |
| EC2 instance profile token | IMDSv2, in-memory | ECR pull on one repository | Automatic, short-lived |
| GitHub Actions `GITHUB_TOKEN` | Runner | Repository read | Automatic, workflow lifetime |
| DuckDNS token | Terraform variable / CLI argument | DNS record update | Manual; leaks to process list (KI-07) |
| Let's Encrypt account key | `/etc/letsencrypt` on the host | Certificate issuance | Certbot-managed |

No credential is committed. `.gitignore` excludes `.env`, `*.tfvars`, `*.pem`, `*.key`,
`.terraform/`, state files and `known_hosts`.

---

## Trust boundaries

```text
Developer ──write──► GitHub ──OIDC──► AWS STS ──► ECR push role
                        │
                        └──SSH key──► EC2
                                       │
                                       └──instance role──► ECR (pull only)
```

### GitHub → AWS

The build job assumes an IAM role through GitHub OIDC. The trust policy requires
`aud = sts.amazonaws.com` and a subject for this repository and branch, so a token from
another repository or branch cannot assume it. Credentials last for the job and are never
stored in GitHub. The role can only push to the one ECR repository; it cannot read the
database or SSH to the host.

The static-key path remains available as a documented fallback
([CI-CD.md § Secrets](CI-CD.md#secrets)), but it is not the default.

### GitHub → EC2

The deploy job authenticates with an SSH private key in a repository secret. The key has
no passphrase because GitHub Actions cannot answer a prompt. Anyone who can read the
secret can SSH as `ubuntu`, which is effectively root through `sudo`.

The host key is pinned in `EC2_HOST_KEY`, so the runner refuses an unexpected host instead
of trusting whatever answers on the IP. Mitigations that are **not** present: a dedicated
deploy user, a forced command, key expiry, SSH certificates, or an SSM-based deploy path.
The instance profile gives the host ECR pull only, so an attacker on the host cannot push
images or use the AWS account broadly.

### EC2 → ECR

The instance role can:

```text
ecr:GetAuthorizationToken            on *
ecr:BatchCheckLayerAvailability      on the Phase 3 repository
ecr:GetDownloadUrlForLayer           on the Phase 3 repository
ecr:BatchGetImage                    on the Phase 3 repository
```

It cannot push, delete, or access any other repository. IMDSv2 is required, which blocks
the common SSRF-to-credentials path.

---

## Network exposure

| Port | Source | Purpose | Risk |
|---|---|---|---|
| 22 | Operator `/32` plus `ssh_ingress_cidrs` | Admin and CI SSH | **High** in the example, which sets `0.0.0.0/0` for GitHub-hosted runners |
| 80 | `0.0.0.0/0` | ACME HTTP-01, HTTP→HTTPS redirect | Low |
| 443 | `0.0.0.0/0` | Application | Low, application-dependent |
| 3000–3003 | `127.0.0.1` | Blue/green backend and frontend slots | Not reachable externally |
| 5432 | Docker network | PostgreSQL | Not reachable externally |

The example tfvars deliberately opens SSH to `0.0.0.0/0` so a GitHub-hosted runner can
deploy. Replace it with a self-hosted runner CIDR, or move to SSM, before exposing real
data. See [KI-09](KNOWN-ISSUES.md#ki-09).

No Elastic IP is assigned. A stop/start changes the public IP, so the DuckDNS record,
certificate renewal and the `EC2_HOST` secret point at the old address until they are
updated. `APP_BASE_URL` is the hostname and does not change. See
[KI-11](KNOWN-ISSUES.md#ki-11).

---

## Secrets on the host

`setup-docker.sh` generates a random `POSTGRES_PASSWORD` (24 bytes hex) and `JWT_SECRET`
(32 bytes hex) with `openssl rand` and writes `~/zeetafin/.env` with mode 600. The file is
sourced by `deploy.sh`.

| Control | Status |
|---|---|
| File mode 600 | ✅ |
| Generated from OS CSPRNG | ✅ |
| Preserved across bootstrap re-runs | ✅ |
| Preserved across application deploys | ✅ |
| Encrypted at rest beyond the EC2 root disk | ❌ (root disk is EBS-encrypted) |
| Rotated automatically | ❌ |
| Readable by the `ubuntu` user and root | ✅ by design |
| Loaded into container environment variables | ✅ (visible to `docker inspect` with host access) |

The `.env` file is never copied back to the operator and never enters Terraform state.
`setup-docker.sh -f` regenerates it, but the existing PostgreSQL volume still contains the
old password hash, so forcing a rotation without also changing the database password is
not a working rotation procedure. See [OPERATIONS.md § Rotating secrets](OPERATIONS.md#rotating-secrets).

---

## Pipeline security

| Property | Status |
|---|---|
| Pull request from a fork cannot read repository secrets | ✅ GitHub default |
| Workflow runs on `main` pushes and manual dispatch | ✅ |
| Deploy requires the `production` environment | ✅ (add protection rules in GitHub) |
| Concurrency prevents overlapping deploys | ✅ |
| Actions pinned by tag (`@v4`, `@v2`, `@v6`) | ⚠️ tags can move; pin SHA for stricter supply-chain control |
| Third-party action review | `actions/*`, `aws-actions/*` and `docker/*` only |
| Image vulnerability scan | ✅ Trivy fails the build on fixable CRITICAL findings; ECR scan-on-push is also enabled |
| Image provenance / signing | ❌ |
| SBOM | ❌ |
| Build logs contain secrets | ❌ secrets are masked; do not echo them |
| `latest` tag is immutable | ❌ (mutable by design) |
| Deploy uses commit tags | ✅ |
| Blue/green switch | ✅ two colour slots with an atomic nginx reload |
| Automatic rollback | ✅ on failed external verification, and on nginx reload failure |
| Host key pinned | ✅ `EC2_HOST_KEY` secret; no runtime `ssh-keyscan` |
| Tests gate the build | ✅ backend unit tests and frontend typecheck |
| Schema changes are versioned | ✅ TypeORM migrations; `synchronize` is disabled |

### Frontend build argument

`NEXT_PUBLIC_API_URL` is baked into the browser bundle. It is not a secret. The default
`/api` is correct for a same-origin deployment behind nginx.

### ECR lifecycle

The lifecycle policy keeps ten images per prefix and expires untagged layers after seven
days. This bounds storage but means a rollback target eventually disappears. Ten deploys is
the practical rollback window.

---

## Application security (inherited from Phase 2)

These are properties of the application, not the pipeline. They are listed because the
pipeline now deploys them automatically and can amplify a mistake.

- TypeORM `synchronize` is disabled. The container runs `node dist/migrate.js` before the
  seed and the application, so a schema change ships as a reviewed migration. The baseline
  migration is idempotent for databases created by the old synchronize setting.
- The seed runs on every backend start and retries ten times. It is intended to be
  idempotent, but verify before changing seed logic.
- The backend listens on port 3001 behind nginx; it is not directly exposed.
- JWT authentication uses `JWT_SECRET`; rotating it invalidates all sessions.
- The Postgres container is not published. The only path to it is the Docker network.
- There is no WAF, rate limiting, or request size limit in nginx. The application is
  exposed to the public internet on 443.
- There is no backup. A lost volume or destroyed instance loses the database.

---

## Hardening checklist

Before treating this as production:

- [x] Replace static AWS keys with GitHub OIDC.
- [ ] Replace SSH from `0.0.0.0/0` with a self-hosted runner or SSM.
- [ ] Pin third-party actions to commit SHAs.
- [x] Pin the EC2 host key in a secret instead of `ssh-keyscan`.
- [ ] Add a deploy user with a forced command or use SSH certificates.
- [x] Add automatic rollback on health-check failure.
- [ ] Add database backups and test a restore.
- [x] Replace `synchronize: true` with migrations.
- [ ] Add WAF/rate limiting and security headers.
- [x] Fail the image build on fixable CRITICAL findings.
- [ ] Add CloudWatch alarms for instance health, disk, and container restarts.
- [ ] Rotate the database password and JWT secret with a procedure that updates both the
      volume and the running containers.
- [ ] Restrict outbound egress to the required endpoints if the threat model warrants it.

---

## Reporting

This is a public review project. Open an issue with the finding, the affected file and a
suggested fix. Do not include live credentials, account IDs, IPs or `.env` contents in an
issue. If you believe a secret was committed, rotate it first, then report the commit.
