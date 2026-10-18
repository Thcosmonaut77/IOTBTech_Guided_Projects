# Review Checklist

A structured way to review this repository. Work top to bottom; each section ends where the
next begins. If you only have fifteen minutes, do the [fast pass](#fast-pass-15-minutes) and
read [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

- [How to use this](#how-to-use-this)
- [Fast pass (15 minutes)](#fast-pass-15-minutes)
- [Verify the claims](#verify-the-claims)
- [The design questions that matter](#the-design-questions-that-matter)
- [Terraform review](#terraform-review)
- [Bootstrap script review](#bootstrap-script-review)
- [Container and application review](#container-and-application-review)
- [Security review](#security-review)
- [Documentation review](#documentation-review)
- [Verdict template](#verdict-template)

---

## How to use this

This repository is published **for** review. The most valuable thing you can produce is a
finding — a defect, a wrong claim, or a security problem not already in the catalogue.

- If you find something **already** in [KNOWN-ISSUES.md](KNOWN-ISSUES.md), note whether you
  agree with the severity.
- If you find something **new**, open an issue (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- If you disagree with a **decision**, open an issue rather than a PR. Design disagreements
  are not code changes.

There is no CI. Every check below is a command you run yourself.

---

## Fast pass (15 minutes)

Read in this order and form a first opinion. Do not try to verify anything yet.

| # | Look at | Ask |
|---|---|---|
| 1 | [`Infrastructure/bootstrap.tf`](../Infrastructure/bootstrap.tf) | Is the manual/automatic boundary defensible? |
| 2 | [`Infrastructure/setup-docker.sh`](../Infrastructure/setup-docker.sh) | Does each of the eight steps make sense, and in this order? |
| 3 | [`Infrastructure/firewall.tf`](../Infrastructure/firewall.tf) | Is 22 really operator-only? Are 3000/3001 absent? |
| 4 | [`Infrastructure/compute.tf`](../Infrastructure/compute.tf) | IMDSv2? encrypted root? one host? |
| 4 | [`Application/deploy.sh`](../Application/deploy.sh) | Do containers bind to `127.0.0.1`? Is the DB port published? |
| 5 | [`Application/nginx.cfg`](../Application/nginx.cfg) | Does `/api/` reach the backend and `/` the frontend? |
| 6 | [SECURITY.md](SECURITY.md) | Is the threat model honest? |
| 7 | [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Do you disagree with any rating? |

---

## Verify the claims

Run these. They are the claims the repository makes about itself.

```bash
# 1. Formatting and validity
terraform -chdir=Infrastructure fmt -check -recursive      # expect: no output
terraform -chdir=Infrastructure validate                   # expect: Success!

# 2. The bootstrap script parses and self-documents
bash -n Infrastructure/setup-docker.sh                     # expect: no output
bash Infrastructure/setup-docker.sh -h                     # expect: usage text

# 3. Resource and output counts match the docs
terraform -chdir=Infrastructure plan | grep -E 'will be created'
terraform -chdir=Infrastructure output                     # expect 10 outputs (after apply)

# 4. No secret is tracked
git ls-files | grep -Ei 'tfvars$|tfstate|id_ed25519|id_rsa|\.pem$|\.env$'   # expect: empty
git check-ignore -v Infrastructure/.terraform.lock.hcl 2>/dev/null           # expect: no output (NOT ignored)
```

- [ ] `terraform fmt -check` is clean.
- [ ] `terraform validate` succeeds.
- [ ] `bash -n` is clean and `-h` prints the usage block.
- [ ] The docs' "10 managed resources / 10 outputs" matches the plan and `outputs.tf`.
- [ ] No `.tfvars`, state, key or `.env` is tracked.

---

## The design questions that matter

Answer these four explicitly. They are the substance of the review.

1. **Is the manual boundary in the right place?** The stack automates everything up to a live
   HTTPS site and stops before `aws configure` + the ECR push. Is that the honest stopping
   point, or is it an excuse to avoid wiring an instance role?
   ([ARCHITECTURE.md § The bootstrap model](ARCHITECTURE.md#the-bootstrap-model))

2. **Is one host defensible?** Application, database, proxy and credentials share one
   instance. Given the stated purpose (a lab, published for review), is the blast radius
   acceptable — or should the database have been RDS from the start?
   ([KI-01](KNOWN-ISSUES.md#ki-01), [SECURITY.md § S5](SECURITY.md#s5--single-host-runs-everything-so-one-compromise-is-total))

- [ ] DuckDNS + certbot (free, browser-trusted, but DNS-dependent) vs. a real domain and
  Route 53 (cost, account, but robust). Which is the better teaching choice?
- [ ] Building images on the host, when the application repositories already have a GitHub
  Actions workflow that builds and pushes to ECR. Is duplication justified, or is it drift?
  ([KI-12](KNOWN-ISSUES.md#ki-12))

---

## Terraform review

- [ ] Does every variable have a description and a sensible default?
- [ ] Is the backend configuration correct for `use_lockfile` (Terraform ≥ 1.10)?
- [ ] Does `bootstrap.tf`'s `triggers_replace` cover every input that should re-run the
  bootstrap — and nothing that should not?
- [ ] Are the security-group rules the minimum for the design (22 operator `/32`, 80/443
  world, egress all)?
- [ ] Is the operator IP resolved at the right time, and does a changed IP recover with a
  plain re-apply?
- [ ] Does `ecr.tf` do the right thing on `destroy` (`force_delete`)?
- [ ] Is anything in the config a hard-coded value that should be a variable?
- [ ] Is there any resource that would surprise you in a `terraform plan`?

---

## Bootstrap script review

Read `Infrastructure/setup-docker.sh` top to bottom.

- [ ] Does it fail closed? (`set -euo pipefail`, `: "${VAR:?…}"` guards.)
- [ ] Is the private key handled safely (temp dir, `0600`, `ssh-keygen -y` verification,
  trap-based cleanup)?
- [ ] Does `resolve_key()` cover the Windows path cases it claims to?
- [ ] Is the source upload (`tar`/`scp` of the local `Application/` tree) safe and clean to
  re-run?
- [ ] Are the generated secrets strong and kept off the command line?
- [ ] Is the login user added to the `docker` group, and is that acknowledged as
  root-equivalent in the threat model?
- [ ] Is the script idempotent — secrets and the TLS certificate preserved across re-runs
  ([KI-09](KNOWN-ISSUES.md#ki-09))?
- [ ] Is the DNS/certbot step resilient to a slow record ([KI-05](KNOWN-ISSUES.md#ki-05))?
- [ ] Is `shellcheck` clean, or are the suppressions justified?

```bash
shellcheck Infrastructure/setup-docker.sh   # if installed
```

---

## Container and application review

These files are the deployment interface to the application, not the application itself.

- [ ] Does `deploy.sh` refuse to run without `POSTGRES_PASSWORD` and `JWT_SECRET`?
- [ ] Are the containers bound to `127.0.0.1` and joined to a private network?
- [ ] Is the database port **not** published?
- [ ] Is the restart policy set, and is it the right one?
- [ ] Do both Dockerfiles build multi-stage and run as a non-root user?
- [ ] Is there a `HEALTHCHECK`?
- [ ] Does `nginx.cfg` proxy `/` to the frontend and `/api/` to the backend, with the
  right headers?
- [ ] Is the seed account's default password a problem ([SECURITY.md § S3](SECURITY.md))?

---

## Security review

Read [SECURITY.md](SECURITY.md) and check that the threat model is honest.

- [ ] Does the credential inventory list **every** credential, or is one missing?
- [ ] Are the trust boundaries drawn where they actually are?
- [ ] Does any documented mitigation overstate its effect?
- [ ] Is the "what is not protected" list candid, or does it hide behind the lab framing?
- [ ] Does the DuckDNS token path actually leak, as [S2](SECURITY.md) claims?
- [ ] Can the manual ECR push credentials be avoided, and does the doc say how?
- [ ] Are the "accepted" ratings (S5, S12) justified, or convenient?

---

## Documentation review

Docs are part of the code here.

- [ ] Do the resource counts and output names in the docs match `outputs.tf` and the plan?
- [ ] Do the documented log lines match `setup-docker.sh`?
- [ ] Do the file paths use `Infrastructure/` (capital `I`) consistently?
- [ ] Does the [Documentation Index](../README.md#documentation-index) link to files that exist?
- [ ] Are the [KNOWN-ISSUES](KNOWN-ISSUES.md) anchors referenced from other docs valid?
- [ ] Is any claim contradicted by the code?

---

## Verdict template

Copy this into your review:

```markdown
## Review — <your name> — <date>

**Commit:** <sha>
**Time spent:** <minutes>

### Verified
- [ ] terraform validate passes
- [ ] terraform fmt clean
- [ ] bash -n passes
- [ ] Docs match code

### Findings
| # | Finding | Severity | Already in KNOWN-ISSUES? |
|---|---|---|---|
| 1 | | | |

### Answers to the design questions
1. Manual boundary: …
2. Single host: …
3. DuckDNS + certbot: …
4. Build on host: …

### Verdict
<A sentence. Would you run this? What would you change first?>
```

---

## See also

- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — read this first.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to report what you find.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the decisions under review.
- [SECURITY.md](SECURITY.md) — the threat model.
