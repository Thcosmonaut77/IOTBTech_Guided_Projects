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

In rough order of value to this repository:

| Contribution | What it means |
|---|---|
| **Find a defect** | Especially one not in [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md). Those are the most interesting PRs. |
| **Disagree with a finding** | Argue that a severity is wrong, or that a "deliberate omission" is actually a mistake. |
| **Improve the docs** | Correct an inaccuracy, clarify an ambiguous step, add a missing failure mode. |
| **Fix a known issue** | Apply one of the patches in [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) and update that file. |
| **Add hardening** | Enable IMDSv2, add `lifecycle` guards, split the security groups. |
| **Add tests** | Terratest, Checkov, `ansible-lint`, `shellcheck`. None exist today. |
| **Improve the playbook** | FQCNs, `cache_valid_time`, handlers, pinned versions — see [Playbook quality issues](docs/KNOWN-ISSUES.md#playbook-quality-issues). |

---

## Reporting a bug

Open an issue with:

1. **File and line**, or the exact command and its full output.
2. **What you expected** and **what happened**.
3. **Versions** — `terraform version`, `aws --version`, and the AWS provider version from
   `terraform version`.
4. **Whether it reproduces** from a clean `terraform apply`.
5. **Whether it is security-relevant** — if so, say so in the title so it can be handled
   privately first.

For anything involving `setup-ansible.sh`, include a trace with sensitive material removed:

```bash
bash -x ./infrastructure/setup-ansible.sh -m <ip> -k <key> <worker1> <worker2> 2>&1 | tail -100 \
  | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<IP>/g'
```

> **Never include**: your AWS account ID, ARNs, `ssh_cidr`, instance IDs, your
> `$HOME` path, your SSH username, or any key material. This is a public repository.

---

## Reviewing the design

You do not need to change anything to review. Start with
**[docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md)**, which walks through six phases and
ends with a scoring sheet.

The highest-value questions to answer:

- Is the Bash → Ansible bootstrap boundary in the right place?
- Is the shared-security-group / single-subnet topology the right trade-off at n=3?
- Are the security severity ratings in [SECURITY.md](docs/SECURITY.md) defensible?
- Is [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) complete, and are the severities right?
- Which single change would you make first, and why?

If you disagree with a documented decision, open an issue rather than a PR — a design
disagreement is not a code change.

---

## Submitting a code change

1. **Open an issue first** for anything beyond a trivial fix, so the approach can be agreed
   before you write it. For a one-line typo, just open the PR.
2. **Branch from `main`:** `git checkout -b fix/ki-12-playbook-duplication`
3. **Make the change.** Keep it focused — one concern per PR.
4. **Update the documentation.** This repository treats docs as part of the code. If your
   change alters behaviour, resource counts, costs, or outputs, the corresponding document
   must change in the same PR.
5. **Update [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)** if you fixed or introduced an issue.
6. **Run the checks** (below).
7. **Open the PR** using the template.

### The one trap to know about

`docker.yml` used to exist in **two** places: as a tracked file in the repository root, and as
a heredoc inside `setup-ansible.sh`. The script used its own copy, so editing the tracked
file changed nothing that reached the workers.

**That is fixed.** `setup-ansible.sh` now `cp`s the tracked file, and
`filesha256(docker.yml)` is a `triggers_replace` key in `ansible.tf`, so editing the playbook
replaces `terraform_data.ansible_setup` and re-copies the file on the next apply. There is
exactly one copy. See [KI-12](docs/KNOWN-ISSUES.md#ki-12).

Two things that trap is easy to misread:

- **Editing `docker.yml` re-copies it, but does not run it.** Stage 3 is still a manual
  `ansible-playbook docker.yml` on the master, by design. Apply, then run the playbook.
- **`make check-playbook-sync` no longer exists.** There is nothing to drift any more, so the
  target was removed rather than left as a check that cannot fail.

---

## Before you open a PR

```bash
make check
```

Or individually:

```bash
terraform fmt -check -recursive                       # must be silent
terraform -chdir=infrastructure validate              # must print "Success!"
bash -n infrastructure/setup-ansible.sh               # syntax check
shellcheck infrastructure/setup-ansible.sh            # if you have it
ansible-lint infrastructure/docker.yml                # if you have it
ansible-playbook infrastructure/docker.yml --syntax-check
```

Then confirm you have not leaked anything:

```bash
git diff --cached | grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}'   # review every hit
git diff --cached | grep -nE '(arn:aws|[0-9]{12})'
git ls-files | grep -Ei 'tfvars|tfstate|id_ed25519|id_rsa|\.pem'   # must be empty
```

There is no CI in this repository, so these checks are yours to run. `make check` runs the
Terraform and Bash ones. See [Checks](#checks) for the full list.

---

## Style

### Terraform

- **Run `terraform fmt`.** Nothing enforces this for you; `make fmt-check` will fail if you skip it.
- One concern per file: `networking`, `firewall`, `compute`, `ansible`, `outputs`,
  `variables`, `providers`.
- `description` on every variable, every output, every security-group rule.
- Derive resource names from `var.project`. No new hard-coded literals.
- Comment the *why*, never the *what*. `# Latest Ubuntu 24.04 LTS AMI` is a what; the AMI
  section of [ARCHITECTURE.md](docs/ARCHITECTURE.md) is a why.
- Prefer `moved` blocks over letting Terraform replace a renamed resource.

### Bash

- `set -euo pipefail` at the top.
- Quote every expansion. `"$VAR"`, `"${ARRAY[@]}"`, never bare `$VAR`.
- Prefer `printf '%s\n'` over `echo` for values that may begin with `-`.
- Shellcheck-clean, or annotate why not.
- Clean up temporary files with `trap … EXIT`.

### Ansible

- Fully-qualified module names (`ansible.builtin.apt`, not `apt`).
- Tasks named as what they accomplish, in the imperative: "Add Docker official GPG key".
- `changed_when` wherever a task reports changed without changing anything.
- Idempotent: a second run must report `changed=0`. If your change breaks that, it is not
  finished.
- Prefer handlers over restarting a service inside a task.

### Markdown

- One sentence per idea. Prefer a table to a paragraph of list items.
- Relative links between documents (`./ARCHITECTURE.md`), so they work on GitHub and in a
  local checkout.
- Anchor links to a specific section (`[KI-12](docs/KNOWN-ISSUES.md#ki-12)`) rather than "see
  above".
- Every fenced block tagged with a language, so it highlights.
- No line-wrapping in prose. One sentence per line renders identically and diffs cleanly.

---

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), because the history is the
narrative of how the design changed.

```text
<type>(<scope>): <subject>

<body>

<footer>
```

| Type | Use for |
|---|---|
| `fix` | A defect fix |
| `feat` | New resource, new capability |
| `docs` | Documentation only |
| `refactor` | No behaviour change |
| `security` | A finding from [SECURITY.md](docs/SECURITY.md) |
The `test` type below is a historical convention; there are no test or CI scripts to run in
this repository. Anything caught by `make check` is already covered by `fix` or `docs` in
practice.
| `chore` | Tooling, dependencies, `.gitignore` |

Examples:

```text
fix(ansible): read worker private IPs in the Terraform-output fallback

The script's no-argument path parsed worker_public_ips while ansible.tf
passes worker_private_ips. The manual path therefore routed inter-node
SSH out to the internet and back.

Refs KI-05.
```

```text
docs(security): add S15 for unpinned Docker package versions

Co-Authored-By: Your Name <you@example.com>
```

Reference the issue ID in the body, not the subject — the subject should read as a summary,
not an index.

---

## Checks

This repository has **no CI**. Nothing runs automatically on push or on a pull request,
which means every check below is manual and depends on you remembering it. Treat this table
as the checklist to run before you share a change.

| Check | Command |
|---|---|
| Formatting | `terraform fmt -check -recursive` |
| Provider config | `terraform -chdir=infrastructure init -backend=false` then `terraform -chdir=infrastructure validate`; same in `remote_state/` |
| Shell syntax | `bash -n infrastructure/setup-ansible.sh` |
| Shell lint | `shellcheck infrastructure/setup-ansible.sh` |
| Playbook lint | `ansible-lint infrastructure/docker.yml` and `ansible-playbook infrastructure/docker.yml --syntax-check` |
| Secret hygiene | see [Before you open a PR](#before-you-open-a-pr) |

`make check` runs the Terraform and Bash rows in one go.

> The playbook-drift check that used to live here has been removed. It asserted that the
> tracked `docker.yml` matched the copy embedded in `setup-ansible.sh`; that duplication is
> gone, so the check had nothing left to verify. See
> [KI-12](docs/KNOWN-ISSUES.md#ki-12).

None of these commands provision or destroy AWS infrastructure.

---

## Adding a new Known Issue

1. Pick the next unused `KI-NN`. Existing: 01–18.
2. Add a row to the [index](docs/KNOWN-ISSUES.md#index).
3. Add a section under the appropriate severity heading, containing:

| Field | Requirement |
|---|---|
| Title | One line, stating the defect, not the symptom |
| File / line | Exact location |
| Severity | High / Medium / Low, with the scale's definition |
| Category | Correctness, Security, Determinism, Dead code, … |
| **Current** | The code as it exists, in a fenced block |
| **Root cause** | Why it is wrong — not what is wrong |
| **Impact** | What actually breaks, and how a user would notice |
| **Patch** | A copy-pasteable diff or replacement block |
| **Verification** | Commands that prove the patch worked |

4. If it changes a security finding, cross-link to [SECURITY.md](docs/SECURITY.md) and vice versa.
5. If it appears in the README's summary or in another document, update that reference too.

Order the sections by severity, and keep the numbering monotonic — do not renumber existing
issues, because other documents link to them by anchor.

---

## Local development

### Requirements

```bash
# Terraform
brew install terraform              # macOS
# or see https://developer.hashicorp.com/terraform/install

# Optional but recommended
brew install shellcheck tflint ansible-lint
pip install ansible
```

### Common tasks

```bash
make help          # list targets
make check         # fmt + validate + shellcheck + ansible-lint
make fmt           # rewrite files with terraform fmt
make validate      # validate both root modules, no backend needed
make plan          # plan the fleet
make apply         # apply the fleet (COSTS MONEY)
make bootstrap     # create the S3 state bucket
make ssh           # SSH to the master
make workers       # list worker private IPs
make playbook      # run docker.yml on the master
make check-playbook # --check --diff against the master
make lint          # tflint + shellcheck + ansible-lint
make clean         # remove local artifacts (never touches AWS)
```

`make apply` and `make destroy` are **not** wrapped in a confirmation prompt beyond
Terraform's own. Do not put them in an alias.

### Testing a change without a full deploy

```bash
# 1. Validate and lint
make check

# 2. See what would change
terraform -chdir=infrastructure plan -out=tfplan
terraform -chdir=infrastructure show tfplan > tfplan.txt       # attach to your PR

# 3. Re-run only the bootstrap, without touching instances
terraform -chdir=infrastructure apply -replace=terraform_data.ansible_setup

# 4. Push a playbook change directly, bypassing Terraform
scp infrastructure/docker.yml ubuntu@$(terraform -chdir=infrastructure output -raw master_public_ip):~/ansible/
ssh ubuntu@$(terraform -chdir=infrastructure output -raw master_public_ip) \
  'cd ~/ansible && ansible-playbook docker.yml --check --diff'
```

---

## Code of conduct

Be direct, be technical, and assume good faith. Critique the work, not the person who wrote
it.

Specifically welcome:

- "This is wrong because X, here's the counter-example."
- "You rated this Medium; I think it's High, because Y."
- "This documented behaviour does not match what the code does."

Not welcome:

- Personal remarks, or arguing about the author's experience level.
- Assuming a defect was deliberate without reading the rationale first.
- Speculative findings with no reproduction path.

---

## Further reading

- [README.md](README.md) — project overview
- [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — the defect catalogue
- [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md) — how to review this repository
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design rationale
