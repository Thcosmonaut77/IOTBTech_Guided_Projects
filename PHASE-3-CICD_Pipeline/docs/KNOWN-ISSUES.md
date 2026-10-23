# Known Issues

Published with its defects visible. Each entry states the severity, the root cause, the
impact and a practical fix. Severity is about consequence, not likelihood.

| ID | Severity | Summary | Status |
|---|---|---|---|
| [KI-01](#ki-01) | High | CI uses long-lived AWS access keys instead of OIDC | Fixed |
| [KI-02](#ki-02) | Medium | SSH host key is trust-on-first-use via `ssh-keyscan` | Fixed |
| [KI-03](#ki-03) | High | No automatic rollback when the health check fails | Fixed |
| [KI-04](#ki-04) | High | One host, no database backups | Open |
| [KI-05](#ki-05) | Medium | Stop-then-start replacement causes a short outage | Fixed |
| [KI-06](#ki-06) | High | TypeORM `synchronize: true` instead of migrations | Fixed |
| [KI-07](#ki-07) | Medium | DuckDNS token leaks through the process list | Open |
| [KI-08](#ki-08) | Low | State bucket has local state (bootstrap paradox) | Accepted |
| [KI-09](#ki-09) | High | Example opens SSH to `0.0.0.0/0` for GitHub runners | Open |
| [KI-10](#ki-10) | Low | Root and standalone workflow files can drift | Open |
| [KI-11](#ki-11) | Medium | No Elastic IP, so stop/start breaks DNS and TLS | Open |
| [KI-12](#ki-12) | Medium | Pipeline has no test stage | Fixed |
| [KI-13](#ki-13) | Low | Actions are pinned to tags, not commit SHAs | Open |
| [KI-14](#ki-14) | Medium | Mutable ECR tags allow a tag to be overwritten | Open |
| [KI-15](#ki-15) | Low | VS Code extension falsely flags `environment: production` | Accepted |

---

## KI-01

**CI uses long-lived AWS access keys instead of OIDC** — High — Fixed

**Root cause.** The workflow authenticated with `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` stored as repository secrets. Static credentials are powerful until
manually rotated.

**Impact.** A leaked secret allows an attacker to push arbitrary images to the Phase 3
repository. The deploy job will happily run them on the host, so the blast radius is the
application and anything reachable from it. The key cannot read the database directly, but
code execution on the host can.

**Resolution.** The workflow now authenticates through GitHub OIDC.
`Infrastructure/github_oidc.tf` creates the provider and an IAM role whose trust policy
requires `aud = sts.amazonaws.com` and the subject
`repo:<github_repository>:ref:refs/heads/<github_branch>`. The role's inline policy allows
ECR push to the single application repository only. The build job uses
`role-to-assume: ${{ secrets.AWS_ROLE_ARN }}` with `permissions: id-token: write`. The two
static secrets are gone.

The static-key policy remains in `Infrastructure/ci-ecr-push.example.json` as a documented
fallback.

---

## KI-02

**SSH host key is trust-on-first-use via `ssh-keyscan`** — Medium — Fixed

**Root cause.** The deploy job ran `ssh-keyscan -H "$EC2_HOST" >> known_hosts`. That
accepts whatever key the host presents on that connection. It protects against a passive
observer only; it does not prove the host is the one Terraform created.

**Impact.** A network attacker who can intercept the runner's SSH connection could present
a different host key and capture the deploy. The window is small and the target is a lab,
but the control is not meaningful.

**Resolution.** The host key is now pinned in the `EC2_HOST_KEY` repository secret
(`ssh-keyscan -H <host>` captured once). The deploy job writes it to `known_hosts` and
verifies it covers `EC2_HOST` with `ssh-keygen -F` before connecting. A stale or wrong key
fails the job instead of being silently accepted.

---

## KI-03

**No automatic rollback when the health check fails** — High — Fixed

**Root cause.** The old deploy removed the old containers before starting the new ones. If
the new image started but failed its health check, the script exited non-zero and left the
new containers in place. The workflow failed, but nothing restored the previous tag.

**Impact.** A bad image could take the site down until a human ran the rollback path.

**Resolution.** Two layers. First, blue/green removes the outage: the new colour is
health-checked before nginx switches, and a failed deploy never touches the active colour.
Second, the workflow records the last tag that passed the external check in
`~/zeetafin/.last_good_tag`; if the external check fails, it runs `deploy.sh --rollback`,
which prefers `.last_good_tag`, falls back to `.previous_tag`, and deploys that into the
inactive colour.

---

## KI-04

**One host, no database backups** — High — Open

**Root cause.** The application, database and reverse proxy run on a single EC2 instance.
There is no backup schedule, no replica and no snapshot policy.

**Impact.** Instance loss, disk corruption, a bad migration or a mistaken `docker rm -v`
loses the database. The stack can be rebuilt in minutes, but the data cannot be recovered.

**Fix.** At minimum, a cron job that runs `pg_dump` to S3 with versioning and lifecycle
rules, plus a tested restore. Better: move the database to RDS with automated backups and
point the backend at it.

---

## KI-05

**Stop-then-start replacement causes a short outage** — Medium — Fixed

**Root cause.** The old deploy ran `docker rm -f zeetafin-be zeetafin-fe` and then started
the new containers. Between those commands nginx had nothing to proxy to.

**Impact.** A few seconds of 502s per deploy. For a lab this is fine. For a real service,
it is unacceptable during business hours.

**Resolution.** `deploy.sh` now runs blue/green on one host. Blue uses backend `3001` /
frontend `3000`; green uses `3002` / `3003`. The inactive colour starts and passes a direct
health check while the active colour keeps serving. nginx reads
`/etc/nginx/zeetafin-upstreams.conf`; the script rewrites it, validates with `nginx -t` and
reloads. The old colour is removed only after the switch. A failed validation or reload
restores the previous upstream file, so nginx never points at a broken colour.

---

## KI-06

**TypeORM `synchronize: true` instead of migrations** — High — Fixed

**Root cause.** `Application/Backend/ZeetaFin-BE/src/app.module.ts` set
`synchronize: (process.env.DB_SYNC || 'true') === 'true'`. Every backend start let
TypeORM alter the schema to match the entities.

**Impact.** A code change to an entity could drop or alter a column on startup, without
review and without a rollback path. In production this is a data-loss risk.

**Resolution.** `synchronize` is disabled. Schema changes are TypeORM migration classes
under `src/migrations/`, run by `node dist/migrate.js` before the seed and the app. The
baseline migration `1760000000000-InitialSchema` uses `CREATE TABLE IF NOT EXISTS` and
duplicate-object guards so it can adopt a database that an earlier `synchronize: true` run
already created without destroying data.

---

## KI-07

**DuckDNS token leaks through the process list** — Medium — Open

**Root cause.** The token is passed to `setup-docker.sh` as `-t <token>` and then embedded
in an `ssh` command string. It appears in the local process list and in Terraform's
`local-exec` output.

**Impact.** Anyone who can see the operator's process list or the Terraform logs can read
the token and change the DNS record. The token only controls one subdomain, but that is
enough to redirect traffic during a certificate renewal window.

**Fix.** Pass the token through an environment variable or a file descriptor rather than
an argument, and mark the Terraform input sensitive (it already is). Better: use Route 53
with a scoped IAM role and no shared token.

---

## KI-08

**State bucket has local state (bootstrap paradox)** — Low — Accepted

**Root cause.** `remote_state/` creates the S3 bucket that `Infrastructure/` uses as its
backend. The bucket module cannot use that backend before it exists, so it uses local
state.

**Impact.** The state for the bucket itself lives on the operator machine. Losing it means
`terraform destroy` in `remote_state/` cannot cleanly remove the bucket; the bucket can be
deleted manually.

**Fix.** Accept it for a small stack, or use a separate bootstrap mechanism (a shell
script, CloudFormation, or a bucket created outside Terraform) and keep all Terraform state
remote. Document the local state file as disposable.

---

## KI-09

**Example opens SSH to `0.0.0.0/0` for GitHub runners** — High — Open

**Root cause.** GitHub-hosted runners use dynamic egress addresses, so the operator `/32`
rule alone cannot authorize them. `terraform.tfvars.example` sets
`ssh_ingress_cidrs = ["0.0.0.0/0"]` to make the pipeline work out of the box.

**Impact.** Port 22 is reachable from the entire internet. Authentication is key-only, but
there is no fail2ban, no rate limiting, no port knocking and no MFA. Internet-wide SSH
scanning is constant.

**Fix.** Use a self-hosted runner and set `ssh_ingress_cidrs` to its CIDR. Better: remove
port 22 from the public security group and deploy through AWS Systems Manager Session
Manager or an EC2 Instance Connect Endpoint. Pin GitHub's published ranges only if you
accept the Terraform churn.

---

## KI-10

**Root and standalone workflow files can drift** — Low — Open

**Root cause.** The pipeline exists twice:

- `.github/workflows/phase3-cicd.yml` for the combined repository
- `PHASE-3-CICD_Pipeline/.github/workflows/deploy.yml` for the standalone project

GitHub only discovers workflows at the repository root, so a nested copy is necessary for
the standalone deliverable and a root copy is necessary for this monorepo.

**Impact.** A fix applied to one file may be missed in the other. The two differ only by a
path prefix today.

**Fix.** Generate one from the other in CI, or keep a single source of truth and a small
sync check that compares the files after stripping the path prefix. A reusable workflow
cannot solve this because reusable workflows must also live at the repository root.

---

## KI-11

**No Elastic IP, so stop/start breaks DNS and TLS** — Medium — Open

**Root cause.** The instance has an auto-assigned public IPv4. Stopping and starting the
instance releases it and assigns a new one.

**Impact.** After a stop/start, DuckDNS still points at the old address, the certificate
challenge fails on renewal, and the `EC2_HOST` secret is stale. `APP_BASE_URL` is the
hostname, so it does not change; the site looks down until DNS and `EC2_HOST` are updated.

**Fix.** Allocate an Elastic IP and associate it with the instance. That adds ≈ $3.65/month
but keeps the address stable across stop/start. Then the DNS record and certificate remain
valid.

---

## KI-12

**Pipeline has no test stage** — Medium — Fixed

**Root cause.** The backend `package.json` had no `test` script, and the workflow went
straight from checkout to build.

**Impact.** A change that compiled but broke behaviour was deployed automatically. The
health check only proves the API answers, not that it is correct.

**Resolution.** A `test` job runs before `build-and-push` and gates it. The backend
compiles with Nest and runs a `node:test` suite (`Application/Backend/ZeetaFin-BE/test/`),
covering the journal-entry balance rule in `src/common/finance/balance.ts`. The frontend
runs `tsc --noEmit` against the Next.js app. The suite is deliberately small; unit and
integration tests against an ephemeral Postgres are the next step.

A separate image-scan gap was closed at the same time: Trivy fails the build on fixable
CRITICAL findings before any image is pushed to ECR.

---

## KI-13

**Actions are pinned to tags, not commit SHAs** — Low — Open

**Root cause.** The workflow uses `actions/checkout@v4`, `aws-actions/configure-aws-
credentials@v4`, `aws-actions/amazon-ecr-login@v2`, `docker/setup-buildx-action@v3` and
`docker/build-push-action@v6`.

**Impact.** Tags are mutable. A compromised or retagged action could run arbitrary code
with the job's credentials. The risk is mitigated by using only well-known publishers, but
it is not eliminated.

**Fix.** Pin each action to a full commit SHA and let Dependabot update the pins. Verify
the owner and repository before updating.

---

## KI-14

**Mutable ECR tags allow a tag to be overwritten** — Medium — Open

**Root cause.** The repository sets `image_tag_mutability = "MUTABLE"` so the moving
`latest` tags can be updated.

**Impact.** Anyone with push rights can overwrite `backend-<sha>` after the fact, so the
tag no longer proves what was built. The deploy job trusts the tag, not a digest.

**Fix.** Use `IMMUTABLE` tags and stop publishing `latest`, or keep a separate mutable
repository for convenience tags. Deploy by image digest rather than tag. At minimum,
enable ECR tag immutability exceptions for the `latest` prefix only if the provider
supports it; otherwise drop `latest`.

---

## KI-15

**VS Code extension falsely flags `environment: production`** — Low — Accepted

**Root cause.** The GitHub Actions language server bundled with the VS Code extension
validates the scalar `environment` value as an expression and reports
`Value 'production' is not valid` with the expression context list. The workflow schema
defines `environment` as either a string or a mapping, so the scalar form is valid. This is
an editor false positive tracked upstream in `github/vscode-github-actions#402`; GitHub
Actions itself accepts the file.

**Impact.** No runtime impact. Editors show a squiggle on the deploy job, which can be
mistaken for a broken workflow.

**Fix.** Leave the declaration as written. If the warning is distracting, disable the
extension's validation for the workspace or wait for the upstream fix. The equivalent
mapping form below is also valid, but the extension may flag it the same way. Verify with
`actionlint` or a push to a branch rather than relying on the editor.

```yaml
environment:
  name: production
```

---

## Fixed in this repository

Issues found during the initial build and closed in the same project:

| ID | Issue | How it was fixed |
|---|---|---|
| KI-01 | Long-lived AWS keys in CI | GitHub OIDC into a repository- and branch-scoped IAM role (`github_oidc.tf`) |
| KI-02 | `ssh-keyscan` trust-on-first-use | Pinned `EC2_HOST_KEY` secret, verified with `ssh-keygen -F` before connecting |
| KI-03 | No automatic rollback | `.last_good_tag` recorded after external verification; `deploy.sh --rollback` runs on failure |
| KI-05 | Stop-then-start outage | Blue/green colour slots with an atomic nginx upstream reload |
| KI-06 | TypeORM `synchronize: true` | `synchronize` disabled; versioned migrations run before the app starts |
| KI-12 | No test stage | `test` job (backend `node:test`, frontend `tsc`) before `build-and-push`; Trivy CRITICAL gate before push |

The static-key and host-scanning paths are retained only as documented fallbacks. They are
not the default.

Phase 1 and Phase 2 document their own fixed issues in their respective
`docs/KNOWN-ISSUES.md` files.

---

## Not fixed, and why

| ID | Reason left open |
|---|---|
| KI-04 | Requires a backup target (S3 bucket or RDS) and a schedule; out of scope for a lab, and would add cost |
| KI-07 | Needs a secret delivery change to the bootstrap; low impact for a single subdomain |
| KI-09 | Self-hosted runner or SSM is a larger change than the pipeline itself |
| KI-10 | Reusable workflows cannot live in a nested `.github`; a sync check is the realistic fix |
| KI-11 | An Elastic IP adds a small monthly cost; documented so the operator knows the stop/start consequence |
| KI-13 | SHA pinning is cheap but noisy without Dependabot configured; kept as the next hardening step |
| KI-14 | Immutable tags conflict with the moving `latest` convenience tags; drop `latest` first |
