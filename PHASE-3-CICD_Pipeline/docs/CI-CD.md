# CI/CD Pipeline

This document explains the GitHub Actions workflow in detail: what triggers it, what each
step does, which credentials it uses, and how to diagnose the common failures.

Workflow files:

| File | Layout |
|---|---|
| [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | Phase 3 directory is the repository root |
| [`../../.github/workflows/phase3-cicd.yml`](../../.github/workflows/phase3-cicd.yml) | Combined IOTB repository |

The two files are intentionally mirrored. They differ only in the path prefix
(`Application/…` versus `PHASE-3-CICD_Pipeline/Application/…`). If you change one, change
the other; see [KNOWN-ISSUES.md § KI-10](KNOWN-ISSUES.md#ki-10).

---

## Flow

```text
developer push to main
        │
        ▼
GitHub Actions — test job
        │  npm ci + backend unit tests
        │  npm ci + frontend TypeScript check
        ▼
GitHub Actions — build-and-push job (OIDC, no static keys)
        │  checkout
        │  assume AWS_ROLE_ARN through GitHub OIDC
        │  ECR login
        │  build backend  ──► Trivy CRITICAL gate ──┐
        │  build frontend ──► Trivy CRITICAL gate ──┤
        │                                           ▼
        │                            push :backend-<sha>, :frontend-<sha>
        │                            and the moving :*-latest tags
        ▼
GitHub Actions — deploy job
        │  install EC2_SSH_KEY and pinned EC2_HOST_KEY
        │  scp Application/deploy.sh to ~/zeetafin/
        │  ssh: AWS_REGION=… ECR_REGISTRY=… ECR_REPOSITORY=… IMAGE_TAG=<sha> bash deploy.sh
        ▼
EC2 host — deploy.sh
        │  aws ecr get-login-password   (instance profile)
        │  docker pull :backend-<sha>, :frontend-<sha>
        │  ensure network, volume and postgres container
        │  start the inactive colour on its own port pair
        │  poll the new colour directly; old colour still serves
        │  rewrite zeetafin-upstreams.conf and reload nginx
        │  remove the previous colour
        ▼
GitHub Actions — verify
        │  curl https://<host>/api/docs and / with retries
        │  on success: record .last_good_tag on the host
        │  on failure: ssh back and run deploy.sh --rollback
```

### Triggers

| Event | Condition |
|---|---|
| `push` | Every push to branch `main` |
| `workflow_dispatch` | Manual run from the Actions tab; optional `image_tag` input |

Every push to `main` runs the tests, builds, scans and deploys, as the brief requires. If the
extra deploys become noisy, add a `paths:` filter for `Application/**` and the workflow file;
the trade-off is that docs-only or Terraform-only commits no longer produce a release.

A push to any branch other than `main` does not deploy. Add branch protection and require a
pull request before merge.

### Concurrency

```yaml
concurrency:
  group: zeetafin-production-deploy
  cancel-in-progress: false
```

Two pushes in quick succession queue instead of racing. Because `cancel-in-progress` is
false, an in-flight deploy is never cancelled halfway through swapping colours.

---

## Secrets

All values are repository secrets. None are committed.

| Secret | Used by | Notes |
|---|---|---|
| `AWS_ROLE_ARN` | build-and-push | OIDC role ARN from `terraform output -raw github_oidc_role_arn` |
| `AWS_REGION` | both jobs | Must match the Terraform region |
| `ECR_REGISTRY` | both jobs | Registry hostname, no repository path |
| `ECR_REPOSITORY` | both jobs | `namespace/name`, no registry hostname |
| `EC2_HOST` | deploy | Public IP or DNS name |
| `EC2_HOST_KEY` | deploy | Output of `ssh-keyscan -H <host>`; pinned, never scanned at runtime |
| `EC2_USER` | deploy | `ubuntu` for the Canonical AMI |
| `EC2_SSH_KEY` | deploy | Private key contents, no passphrase |
| `APP_BASE_URL` | deploy | Scheme + host, no trailing slash |
| `NEXT_PUBLIC_API_URL` | build-and-push | Optional frontend build arg; default `/api` |

There are no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secrets. The build job exchanges
the GitHub OIDC token for short-lived STS credentials, and the EC2 host pulls images with
its instance profile. The deploy step sends only the registry coordinates and image tag.

### OIDC trust

[`../Infrastructure/github_oidc.tf`](../Infrastructure/github_oidc.tf) creates:

- an OpenID Connect provider for `token.actions.githubusercontent.com`;
- an IAM role whose trust policy requires `aud = sts.amazonaws.com` and a subject of
  `repo:<github_repository>:ref:refs/heads/<github_branch>`;
- an inline policy with `ecr:GetAuthorizationToken` plus push actions on the single
  application repository.

The repository and branch are Terraform variables (`github_repository`, `github_branch`),
defaulting to this project and `main`. A fork must change them.

### Fallback: static IAM credentials

If OIDC is unavailable, the same ECR push policy is in
[`../Infrastructure/ci-ecr-push.example.json`](../Infrastructure/ci-ecr-push.example.json).
Create a dedicated IAM user, replace `ACCOUNT_ID`, and set `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`. This reintroduces [KI-01](KNOWN-ISSUES.md#ki-01) and is not the
default path.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushToZeetaFin",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:<region>:<account-id>:repository/<namespace>/<repository>"
    }
  ]
}
```

---

## Job 1 — `test`

| Step | What it does |
|---|---|
| Backend install | `npm ci` in `Application/Backend/ZeetaFin-BE` |
| Backend tests | `npm test`: compiles with Nest and runs the `node:test` suite |
| Frontend install | `npm ci` in `Application/Frontend/ZeetaFin-FE` |
| Frontend typecheck | `npm test`: `tsc --noEmit` against the Next.js app |

`build-and-push` needs this job, so a failing test stops the pipeline before anything is
pushed or deployed. The test suite is intentionally small: it covers the journal-entry
balance rule. Add real unit and integration tests as the application grows.

---

## Job 2 — `build-and-push`

| Step | Action | Why |
|---|---|---|
| Check out | `actions/checkout@v4` | Makes the application source available |
| Authenticate | `aws-actions/configure-aws-credentials@v4` | Assumes `AWS_ROLE_ARN` through OIDC; no stored keys |
| ECR login | `aws-actions/amazon-ecr-login@v2` | Configures Docker for the registry and exposes `steps.login-ecr.outputs.registry` |
| Buildx | `docker/setup-buildx-action@v3` | Enables layer caching and loading images locally |
| Backend | `docker/build-push-action@v6` | Builds `Application/Backend/ZeetaFin-BE` with `push: false`, `load: true` |
| Scan | `aquasecurity/trivy-action@v0.36.0` | Fails on fixable CRITICAL OS/library findings |
| Frontend | `docker/build-push-action@v6` | Builds `Application/Frontend/ZeetaFin-FE`, passes `NEXT_PUBLIC_API_URL` |
| Scan | `aquasecurity/trivy-action@v0.36.0` | Same gate for the frontend image |
| Push | shell | Tags and pushes both commit tags and both `latest` tags |
| Summary | shell | Writes the pushed tags to the job summary |

Images are built and scanned locally. Nothing reaches ECR unless both scans pass.

Tags for commit `abc123`:

```text
<registry>/<namespace>/<repository>:backend-abc123
<registry>/<namespace>/<repository>:backend-latest
<registry>/<namespace>/<repository>:frontend-abc123
<registry>/<namespace>/<repository>:frontend-latest
```

The deploy job uses the commit tags, so a deploy is reproducible even if `latest` moves.
The lifecycle policy in `Infrastructure/ecr.tf` keeps the ten most recent images per
prefix and expires untagged layers after seven days.

Build caches use `type=gha`. The first run is slower; later runs reuse backend and frontend
layers.

### Manual redeploy of an existing image

Run `workflow_dispatch` with `image_tag` set to a SHA that already exists in ECR. The
`build-and-push` job is skipped and only `test` and `deploy` run. This is the manual
rollback path. It does not rebuild current source over the old tag.

---

## Job 3 — `deploy`

| Step | What it does |
|---|---|
| Check out | Reads `Application/deploy.sh` from the commit being deployed |
| Install keys | Writes `EC2_SSH_KEY` and the pinned `EC2_HOST_KEY`; rejects a host key that does not match `EC2_HOST` |
| Upload | `scp` the deploy script to `~/zeetafin/deploy.sh` |
| Deploy | `ssh` with the registry coordinates and commit tag; runs `deploy.sh` |
| Verify | `curl --retry 12 --retry-delay 5` against `APP_BASE_URL/api/docs` and `APP_BASE_URL/` |
| Record | On success, writes the tag to `~/zeetafin/.last_good_tag` |
| Roll back | If verification fails after a successful host deploy, runs `deploy.sh --rollback` |

The host key is pinned, not scanned at runtime. Generate the secret once, after the instance
exists:

```bash
ssh-keyscan -H "$(terraform -chdir=Infrastructure output -raw server_public_ip)"
```

Store the complete output line as `EC2_HOST_KEY`. If the instance is replaced, refresh it.

---

## What deploy.sh guarantees

1. **Pull before touch.** Both images are pulled before any live container is changed. A
   failed pull leaves the previous version serving.
2. **Database is not recreated.** The Postgres container is started only if missing; the
   named volume `zeetafin-pgdata` is never removed. Schema changes run as versioned
   migrations in the new backend container.
3. **Two colour slots.** Blue uses backend `3001` / frontend `3000`; green uses `3002` /
   `3003`. The new colour starts and passes direct health checks while the old colour keeps
   receiving traffic.
4. **Atomic nginx switch.** `zeetafin-upstreams.conf` is replaced and nginx is reloaded
   only after the new colour is healthy. If `nginx -t` or the reload fails, the previous
   upstream file is restored and the new containers are removed.
5. **Old colour is removed last.** Only after the switch does the script delete the previous
   colour. A failed deploy never leaves two live colours fighting for traffic.
6. **Rollback is a redeploy.** `.last_good_tag` and `.previous_tag` are kept on the host.
   `deploy.sh --rollback` deploys the last externally verified tag into the inactive slot.

The swap removes the stop-then-start outage described in
[KI-05](KNOWN-ISSUES.md#ki-05). It is a single-host blue/green, not a multi-host cluster.

---

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `configure-aws-credentials` fails | OIDC trust does not match the repository/branch, or `AWS_ROLE_ARN` is wrong | Compare `github_repository` / `github_branch` with the actual repo; check the role ARN output |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The workflow ref is not the trusted branch | Push to `main` or change `github_branch` and re-apply Terraform |
| Trivy exits 1 | A fixable CRITICAL vulnerability in an image | Update the base image or dependency; rerun. `ignore-unfixed: true` keeps unfixable findings from blocking |
| Test job fails | Backend test or frontend typecheck error | Run `npm test` in the matching `Application/` directory locally |
| `amazon-ecr-login` fails with `RepositoryNotFoundException` | `ECR_REPOSITORY` does not match the Terraform repository | Compare with `terraform output -raw ecr_repository_name`; the value is `namespace/name` |
| Build fails at `npm ci` | `package-lock.json` out of sync with `package.json` | Run `npm install` locally and commit the lockfile |
| Frontend build fails on `next build` | Missing public directory or bad API URL | The Dockerfile creates `public`; check `NEXT_PUBLIC_API_URL` |
| `Permission denied (publickey)` | `EC2_SSH_KEY` is not the matching private key, has a passphrase, or wrong `EC2_USER` | Use the key whose `.pub` is in `Infrastructure/terraform.tfvars` |
| `Host key verification failed` | `EC2_HOST_KEY` is stale or for a different host | Run `ssh-keyscan -H <host>` and replace the secret |
| `EC2_HOST_KEY does not contain a key` | The secret is empty or missing the hostname | Paste the full hashed `ssh-keyscan -H` output |
| `docker pull` fails with `no basic auth credentials` | The instance profile is missing or lacks ECR pull | Check `aws sts get-caller-identity` and `aws ecr get-login-password` on the host |
| `API did not become ready` | Backend cannot reach the database, a migration failed, or the image is broken | `docker logs zeetafin-be-<colour> --tail 100`; check `.env` on the host |
| `nginx rejected the … upstreams` | The site was edited by hand or the upstream file is invalid | `sudo nginx -t`; the script restores the previous upstreams on failure |
| External `curl` fails but host health check passed | DNS, TLS or nginx problem | `dig` the domain, `sudo nginx -t`, `sudo certbot certificates` |
| Workflow never starts | The push was not to `main`, or the workflow is not at the repository root `.github/workflows/` | Push to `main`, use **Run workflow**, or confirm workflow placement |

For a stuck deployment, the fastest diagnosis is on the host:

```bash
cd ~/zeetafin
docker ps -a
cat .active_color .deployed_tag .last_good_tag 2>/dev/null
docker logs --tail 100 "zeetafin-be-$(cat .active_color 2>/dev/null || echo blue)"
cat /etc/nginx/zeetafin-upstreams.conf
cat .env | grep -v PASSWORD | grep -v JWT   # do not paste secrets into issues
```

---

## Manual execution

The pipeline can be reproduced without GitHub Actions:

```bash
# On a machine with AWS credentials and Docker
aws ecr get-login-password --region eu-north-1 \
  | docker login --username AWS --password-stdin <registry>

docker build -t <registry>/7/zeetafin-ci:backend-manual Application/Backend/ZeetaFin-BE
docker build -t <registry>/7/zeetafin-ci:frontend-manual Application/Frontend/ZeetaFin-FE
docker push <registry>/7/zeetafin-ci:backend-manual
docker push <registry>/7/zeetafin-ci:frontend-manual

ssh ubuntu@<host> \
  "cd ~/zeetafin && AWS_REGION=eu-north-1 ECR_REGISTRY=<registry> \
   ECR_REPOSITORY=7/zeetafin-ci IMAGE_TAG=manual bash deploy.sh"
```

This is useful when Actions is unavailable, but it bypasses the test gate, the image scans,
the audit trail and the external health check. Prefer the workflow.

---

## Remaining improvements

The original list is implemented; the open items are smaller:

1. Pin every action to a full commit SHA instead of a version tag (KI-13).
2. Use immutable ECR tags or deploy by digest (KI-14).
3. Add database backups and test a restore (KI-04).
4. Add a self-hosted runner or SSM Session Manager instead of SSH from GitHub runners
   (KI-09).
5. Add SBOM attestation and image signing.
