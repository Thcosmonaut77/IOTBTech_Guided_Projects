# Review Checklist

A structured way to appraise this project. Each item names the file to read and the
question to ask. Disagreement is a valid outcome; open an issue with the specific claim you
think is wrong.

---

## 1. Pipeline correctness

| Check | File | Question |
|---|---|---|
| Trigger scope | `.github/workflows/deploy.yml` | Does every push to `main` start it? Is that the intended breadth? |
| Test gate | workflow `test` job | Does a failing backend test or frontend typecheck actually stop the build and deploy? |
| Build context | workflow | Are the backend and frontend contexts correct for both the standalone and combined layouts? |
| Tags | workflow | Can the deploy tag be traced to a commit, and can it be overwritten? |
| Image scan | workflow Trivy steps | Does a fixable CRITICAL finding fail before the push, or after the image is already in ECR? |
| Rollback path | workflow | Does a manual `image_tag` run skip the rebuild, or does it overwrite the old tag? |
| Automatic rollback | workflow + `Application/deploy.sh` | On a failed external check, does it deploy an earlier good tag, and does that leave the failed colour untouched? |
| Concurrency | workflow | Can two deploys overlap and corrupt the container state? |
| Secrets | workflow | Are any secrets printed, committed, or passed to the host unnecessarily? |
| Host key | workflow | Is the host identity pinned, or scanned at runtime (trust-on-first-use)? |
| Health check | workflow + `Application/deploy.sh` | Does it prove DNS, TLS, nginx and the API are working, or only that a container started? |

## 2. Credential boundaries

| Check | Question |
|---|---|
| CI AWS auth | Does the OIDC role trust only this repository and branch? Is it scoped to ECR push on one repository? Could another branch or fork assume it? |
| Host AWS access | Does the instance profile grant pull only, on one repository? |
| SSH key | Is it possible to replace it without recreating the host? Does it have a passphrase (and can CI use it)? |
| Host key | Is `EC2_HOST_KEY` pinned, and is a mismatch rejected rather than accepted? |
| Database secrets | Are they generated once, preserved across deploys, and mode 600? |
| Terraform state | Could any secret end up in state or in `terraform output`? |
| Logs | Do `terraform apply`, `setup-docker.sh`, or the workflow echo anything sensitive? |

## 3. Infrastructure

| Check | File | Question |
|---|---|---|
| State key | `providers.tf` | Does Phase 3 use its own bucket and key, or can it overwrite Phase 2 state? |
| Naming | `terraform.tfvars.example` | Are project, key pair and ECR names distinct from Phase 2? |
| Security group | `firewall.tf` | Is SSH exposure deliberate and documented? Are 3000/3001/5432 closed? |
| IAM | `iam.tf` | Is the pull policy limited to the Phase 3 repository ARN? |
| OIDC | `github_oidc.tf` | Is the provider thumbprint correct? Is the trust subject exactly `repo:<repo>:ref:refs/heads/<branch>` with no wildcard that admits other repos? |
| ECR | `ecr.tf` | Is scan-on-push enabled? Does the lifecycle policy bound storage without breaking rollback? |
| Bootstrap | `bootstrap.tf` | Does it re-run only when it should? Does it avoid building the app? |
| Keys | `firewall.tf` | Is the operator key pair still needed, and is it the same key CI uses? |

## 4. Runtime safety

| Check | File | Question |
|---|---|---|
| Pull before switch | `Application/deploy.sh` | If a pull fails, is the active colour still serving? |
| Database lifetime | `Application/deploy.sh` | Is the database container or volume ever recreated on a normal deploy? |
| Migrations | `Application/deploy.sh` + backend entrypoint | Do migrations run before the app starts, and is `synchronize` off? |
| Blue/green switch | `Application/deploy.sh` | Is nginx reloaded only after the new colour is healthy? Is the old upstream restored if `nginx -t` fails? |
| Old colour cleanup | `Application/deploy.sh` | Is the previous colour removed only after a successful switch, so a failed deploy never leaves two live colours? |
| State files | `Application/deploy.sh` | Are `.active_color`, `.deployed_tag`, `.previous_tag` and `.last_good_tag` consistent after a successful deploy, a failed deploy and a rollback? |
| Health failure | `Application/deploy.sh` | What is the state of the host when the new image never becomes healthy? |
| Disk | `Application/deploy.sh` | Does pruning remove only dangling images, or can it remove a rollback target or a second colour? |
| Idempotency | `setup-docker.sh` | Does a second bootstrap keep the existing `.env`, upstreams file and certificate? |

## 5. Claims in the documentation

Read the README and the docs and mark every claim you cannot verify from the code. The
highest-value findings are usually here: a sentence that says "no downtime", "no
credentials on the host" or "only SSH from the operator" when the code says otherwise.

Specific claims to test:

- "No static AWS keys" — check `github_oidc.tf`, the workflow, and the secrets table.
- "The old containers are replaced" — check `docker rm -f` and the name uniqueness.
- "The database survives" — check the volume and the condition around `docker run postgres`.
- "No downtime / blue-green" — check that the old colour serves until the nginx reload and
  that the reload only happens after the direct health check passes.
- "Automatic rollback" — check that the workflow runs `deploy.sh --rollback` and that the
  script's rollback target is a previously verified tag.
- "The pipeline verifies the application" — check whether the URL is external and whether a
  200 from `/api/docs` proves the app is usable.
- "No secrets are committed" — run the grep commands in
  [`../screenshots/README.md`](../screenshots/README.md) and in
  [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## 6. Failure injection

If you can spend AWS budget, test these deliberately:

1. Break the backend test. The build and deploy jobs must not run.
2. Introduce a fixable CRITICAL vulnerability, for example by pinning an old base image.
   Trivy must fail before the push; ECR must not receive the image.
3. Break the frontend build. The deploy job must not run.
4. Make the external health check fail (for example, point `APP_BASE_URL` at a closed
   port). Confirm the workflow runs `deploy.sh --rollback` and the previous tag serves again.
5. Force `nginx -t` to fail (for example, corrupt the upstreams file first). The script must
   restore the previous upstreams and not switch colours.
6. Stop the database, then deploy. `deploy.sh` should start it and wait for readiness.
7. Revoke the instance profile's ECR pull policy. The pull should fail **before** the active
   colour is touched.
8. Remove SSH ingress for the runner. The deploy should fail before touching the host.

Record the outcome of each test. A failed expectation is a finding.

## 7. Cost and teardown

| Check | Question |
|---|---|
| Resources | Does anything outlive `terraform destroy` (Elastic IP, ECR images, state bucket)? |
| Stop/start | Does stopping the instance break DNS, TLS or GitHub Secrets? (KI-11) |
| Idle cost | What is billed while the instance is stopped? |
| Teardown | Does `force_destroy` on the state bucket and ECR actually make destroy clean? |

---

## Verdict template

```text
Scope reviewed:
Commit:
Date:

Blocking findings:
  - KI-xx: ...

Non-blocking findings:
  - ...

Claims I could not verify:
  - ...

Tests I ran:
  - ...

Overall: approve / approve with comments / request changes
```
