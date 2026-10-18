# Contributing

This repository exists to be reviewed, so **criticism is the primary contribution** — not
just code. If you disagree with a design decision, a severity rating, or a claim in the
documentation, that is a valuable pull request.

- [Ways to contribute](#ways-to-contribute)
- [Reporting a bug](#reporting-a-bug)
- [Reviewing the design](#reviewing-the-design)
- [Submitting a code change](#submitting-a-code-change)
- [Before you open a PR](#before-you-open-a-pr)
- [Style](#style)
- [Commit messages](#commit-messages)
- [Adding a new Known Issue](#adding-a-new-known-issue)
- [Local development](#local-development)
- [Code of conduct](#code-of-conduct)

---

## Ways to contribute

| Area | What helps |
|---|---|
| Terraform | Tighter security groups, IAM instead of long-lived keys, remote state hardening |
| `setup-docker.sh` | Idempotency, error handling, portability across shells and hosts |
| Containers | Smaller images, non-root users, health checks, pinned base image digests |
| TLS / nginx | Hardening headers, renewals, HSTS, OCSP stapling |
| Documentation | Correcting claims that do not match the code |

The single most valuable contribution is a **finding** — a defect, a wrong claim, or a
security problem that is not already catalogued in [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

---

## Reporting a bug

Open an issue with the failing command, its full output, what you expected, and what
happened. For the bootstrap script a trace is ideal:

```bash
bash -x ./Infrastructure/setup-docker.sh -H <ip> \
  -K "$(printf '%s' ~/.ssh/id_ed25519 | base64)" 2>&1 | tail -120 \
  | sed -E 's/([0-9]{1,3}\.){3}[0-9]{1,3}/<IP>/g'
```

> **Never include**: your AWS account ID, ARNs, public IPs, instance IDs, ECR URLs containing
> your account ID, your `$HOME` path, the DuckDNS token, database passwords, or the JWT
> secret. This is a public repository.

---

## Reviewing the design

Start with **[docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md)**. The highest-value
questions:

- Is the point where automation stops (leaving `aws configure` and the ECR push manual) the
  right boundary?
- Should the Docker host have an Elastic IP and a public IP at all, or move behind SSM Session
  Manager?
- Is a single host running postgres + backend + frontend + nginx a defensible trade-off for
  this phase?
- Is the platform's security model in [docs/SECURITY.md](docs/SECURITY.md) honest about what a
  compromised host implies?

If you disagree with a documented decision, open an issue rather than a PR — a design
disagreement is not a code change.

---

## Submitting a code change

1. **Open an issue first** for anything beyond a trivial fix.
2. **Branch from `main`:** `git checkout -b fix/ki-04-certbot-renewal`.
3. **Make the change.** One concern per PR.
4. **Update the documentation.** Docs are part of the code here. If your change alters
   resource counts, costs, outputs or the deployment flow, the matching document changes in
   the same PR.
5. **Update [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)** if you fixed or introduced an issue.
6. **Run the checks** below.
7. **Open the PR.**

---

## Before you open a PR

```bash
terraform fmt -check -recursive
terraform -chdir=Infrastructure init -backend=false
terraform -chdir=Infrastructure validate
bash -n Infrastructure/setup-docker.sh
shellcheck Infrastructure/setup-docker.sh    # if installed
```

Then confirm you have not leaked anything:

```bash
git diff --cached | grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}'   # review every hit
git diff --cached | grep -nE '(arn:aws|[0-9]{12})'
git ls-files | grep -Ei 'tfvars|tfstate|id_ed25519|id_rsa|\.pem|\.env$'   # must be empty
```

There is no CI. These checks are yours to run.

---

## Style

### Terraform

- Run `terraform fmt`.
- One concern per file: `networking`, `firewall`, `compute`, `ecr`, `bootstrap`, `outputs`,
  `variables`, `providers`.
- A `description` on every variable, output and security-group rule.
- Derive resource names from `var.project`. No new hard-coded literals.
- Comment the *why*, never the *what*.
- Prefer `moved` blocks over letting Terraform replace a renamed resource.

### Bash

- `set -euo pipefail` at the top.
- Quote every expansion. Prefer `printf '%s\n'` over `echo`.
- Shellcheck-clean, or annotate why not.
- Clean up temporary files with `trap … EXIT`.
- Make every remote step re-runnable; the bootstrap must be idempotent.

### Containers

- Pin base image tags (and ideally digests).
- Multi-stage builds; do not ship build tooling in the runtime layer.
- Run as a non-root user.

### Docs

- One idea per sentence; prefer tables over prose for reference material.
- Relative links between documents.
- Update the [Documentation Index](README.md#documentation-index) line counts if you change a
  document substantially.

---

## Commit messages

Conventional Commits:

```text
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `fix`, `feat`, `docs`, `refactor`, `security`, `chore`. Reference issue IDs in the
body, not the subject.

Example:

```text
fix(bootstrap): keep the DuckDNS token out of the process list

setup-docker.sh accepted the token as a CLI argument, so it appeared in
`ps` on the host and in Terraform's local-exec log. Read it from a
0600 file uploaded over scp instead.

Refs KI-07.
```

---

## Adding a new Known Issue

1. Pick the next monotonic ID (`KI-01`, `KI-02`, …) — never renumber existing ones, other
   documents link to them by anchor.
2. Give severity, root cause, impact and a copy-pasteable patch.
3. Cross-reference [SECURITY.md](docs/SECURITY.md) if it is security-relevant.
4. Order sections by severity.
5. Add the entry to the index table and the [README](README.md#known-issues) summary if it is
   high severity.

---

## Local development

```bash
terraform fmt -recursive                     # format all Terraform
terraform -chdir=Infrastructure validate     # validate the root module, no backend needed
terraform -chdir=Infrastructure plan         # plan the deployment
terraform -chdir=Infrastructure apply        # apply (COSTS MONEY)

# Re-run only setup-docker.sh, without a plan change:
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap

# SSH to the Docker host:
ssh -i "$(terraform -chdir=Infrastructure output -raw private_key_file)" \
    "$(terraform -chdir=Infrastructure output -raw ssh_user)@$(terraform -chdir=Infrastructure output -raw server_public_ip)"
```

`terraform apply` and `terraform destroy` provision or destroy real AWS resources. They are not
wrapped in an extra confirmation prompt beyond Terraform's own.

### Testing a change without a full deploy

```bash
terraform fmt -check -recursive
terraform -chdir=Infrastructure validate
terraform -chdir=Infrastructure plan -out=tfplan
terraform -chdir=Infrastructure show tfplan > tfplan.txt     # attach to your PR

# Re-run only the bootstrap, without touching the instance:
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap
```

---

## Code of conduct

Be direct, be technical, and assume good faith. Critique the work, not the author.

---

## Further reading

- [README.md](README.md) — project overview
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design rationale
- [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — the defect catalogue
- [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md) — how to review this repository
