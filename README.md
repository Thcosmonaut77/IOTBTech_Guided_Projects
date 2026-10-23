# IOTB Tech Guided Projects

A collection of infrastructure and automation projects, built and documented as working
deployments rather than sketches. Each project is self-contained in its own top-level
directory with its own README, docs, and known-issues list.

Every project here is published **with its defects documented rather than hidden**. The
point of each one is to be appraised: read the design rationale, then read the known issues
and tell me what I got wrong.

## Projects

| Phase | Project | Directory | Status | Stack |
|:--:|---|---|---|---|
| 1 | AWS EC2 Fleet with Hybrid Bash + Ansible Bootstrap | [`PHASE-1-Iac_and_Ansible/`](PHASE-1-Iac_and_Ansible/README.md) | Complete, applied | Terraform · AWS · Ansible · Bash |
| 2 | ZeetaFin on AWS — Single-Host Docker Deployment with ECR | [`PHASE-2-Docker_and_ECR/`](PHASE-2-Docker_and_ECR/README.md) | Complete, applied | Terraform · AWS · Docker · ECR |
| 3 | CI/CD Pipeline for Automated AWS Application Deployment | [`PHASE-3-CICD_Pipeline/`](PHASE-3-CICD_Pipeline/README.md) | Complete, documented | GitHub Actions · AWS · Docker · ECR · Terraform |

Phases 1, 2 and 3 are published as independent top-level projects, following the layout
conventions below.

---

## Phase 1 — AWS EC2 Fleet with Hybrid Bash + Ansible Bootstrap

Provision a two-node Ubuntu 24.04 EC2 fleet on AWS with Terraform, then configure it
through **two deliberately different automation paths** so the trade-offs between imperative
shell bootstrapping and declarative configuration management are visible side by side.

| Node | Provisioned by | Configured by | Role |
|---|---|---|---|
| `Cloud7-Master-Server` | Terraform | `setup-ansible.sh` (Bash over SSH) | Ansible control node |
| `Cloud7-Worker-Server` | Terraform | `docker.yml` (Ansible playbook) | Docker + nginx container on port 80 |

**Why it is interesting.** You cannot install Ansible with Ansible, so something outside
Ansible has to install it and hand it an inventory. That "something" is `setup-ansible.sh`,
invoked as a Terraform `local-exec` provisioner. The project keeps both halves visible so
the bootstrap boundary stays auditable rather than hidden inside a cloud-init blob.

| | |
|---|---|
| Full write-up | **[PHASE-1-Iac_and_Ansible/README.md](PHASE-1-Iac_and_Ansible/README.md)** |
| Entry points | [`infrastructure/`](PHASE-1-Iac_and_Ansible/infrastructure/) (main module) · [`remote_state/`](PHASE-1-Iac_and_Ansible/remote_state/) (bootstrap state bucket) |
| Deep docs | Architecture · Deployment · Operations · Security · Known Issues · Cost · Review Checklist |
| Findings | 20 catalogued issues, several open, each with a patch |
| Running cost | ≈ $27/month 24×7, ≈ $8/month weekdays only |
| Automation model | Three stages: Terraform provisions, Bash bootstraps the control node, Ansible configures the worker |

There is no CI. Every check is a local command you run yourself.

---

## Phase 2 — ZeetaFin on AWS: Single-Host Docker Deployment with ECR

Provision one Ubuntu 24.04 EC2 host with Terraform, then drive it with a Bash bootstrap from the
operator machine until a real application — NestJS backend, Next.js frontend, PostgreSQL 16 —
is **live over HTTPS in a browser**, stopping exactly where AWS credentials become unavoidable.

Phase 1 used Ansible for a two-node fleet. Phase 2 is deliberately different: **one** host, and
a workload that is imperative by nature (`scp`, `docker build`, `certbot`), so the control-node
fan-out Ansible exists for does not apply. The trade-offs between the two paradigms are visible
side by side across the two projects.

| | |
|---|---|
| Full write-up | **[PHASE-2-Docker_and_ECR/README.md](PHASE-2-Docker_and_ECR/README.md)** |
| Entry points | [`Infrastructure/`](PHASE-2-Docker_and_ECR/Infrastructure/) (main module) · [`remote_state/`](PHASE-2-Docker_and_ECR/remote_state/) (bootstrap state bucket) · [`Application/`](PHASE-2-Docker_and_ECR/Application/) (deploy scripts, nginx config, tracked app source) |
| Deep docs | Architecture · Deployment · Operations · Security · Known Issues · Cost · Review Checklist |
| Findings | 18 catalogued issues, each with a patch |
| Running cost | ≈ $39/month 24×7, ≈ $10/month weekdays only |
| Automation model | Three stages: Terraform provisions, Bash bootstraps the host in one pass, then `aws configure` + the ECR push are manual |
| Manual | `aws configure` + `docker push` — the only two actions needing AWS credentials |

---

## Phase 3 — ZeetaFin CI/CD: GitHub Actions → ECR → EC2

Take the Phase 2 application and infrastructure and remove the human from the release path.
A push to `main` builds both Docker images on GitHub-hosted runners, pushes commit-tagged
images to ECR, SSHes into the EC2 host, pulls the new tags, replaces the application
containers and verifies the API and frontend from outside AWS. The database volume survives
the deploy.

The trust boundary shifts: the **host no longer holds AWS user credentials**. It pulls with
a pull-only EC2 instance profile, and the CI runner holds no stored credential either — it
assumes a scoped IAM role through GitHub OIDC. Releases are blue/green with an atomic nginx
switch, schema changes ship as versioned migrations, images are gated by Trivy before they
reach ECR, and a failed verification triggers an automatic rollback.

| | |
|---|---|
| Full write-up | **[PHASE-3-CICD_Pipeline/README.md](PHASE-3-CICD_Pipeline/README.md)** |
| Entry points | [`Application/`](PHASE-3-CICD_Pipeline/Application/) (Phase 2 app + ECR deploy script) · [`Infrastructure/`](PHASE-3-CICD_Pipeline/Infrastructure/) (Terraform + bootstrap) · [`.github/workflows/`](PHASE-3-CICD_Pipeline/.github/workflows/) (pipeline) |
| Deep docs | Architecture · CI/CD · Deployment · Operations · Security · Known Issues · Review Checklist |
| Findings | 15 catalogued issues; OIDC, pinned host key, blue/green, auto-rollback, migrations and tests now fixed, leaving backups, SSH exposure and tag immutability open |
| Running cost | ≈ $39/month 24×7 at `t3.medium`, ≈ $10/month weekdays only |
| Automation model | Terraform provisions and bootstraps the host, then GitHub Actions owns every release |
| Manual | None for a normal deploy; the first apply still needs an operator with AWS and SSH credentials |
| Deploy style | Blue/green on one host, Trivy-gated images, automatic rollback |

---

## Repository Layout

This repository is a container for independent projects, not a monorepo with shared code.

```text
.
├── README.md                  ← you are here: index and orientation
│
├── PHASE-1-Iac_and_Ansible/   ← Phase 1 (complete)
│   ├── README.md              project write-up
│   ├── LICENSE
│   ├── CONTRIBUTING.md
│   ├── infrastructure/        Terraform root modules + Ansible assets
│   ├── remote_state/          separate root module for the S3 backend
│   ├── docs/                  design rationale, runbooks, threat model
│   └── screenshots/           terminal captures from the live deployment
│
├── PHASE-2-Docker_and_ECR/     ← Phase 2 (complete)
│   ├── README.md              project write-up
│   ├── LICENSE
│   ├── CONTRIBUTING.md
│   ├── Infrastructure/        Terraform root modules + the Bash bootstrap
│   ├── remote_state/          separate root module for the S3 backend
│   ├── Application/           deploy scripts, nginx config, tracked app source
│   ├── docs/                  design rationale, runbooks, threat model
│   └── screenshots/           terminal captures from the live deployment
│
├── PHASE-3-CICD_Pipeline/     ← Phase 3 (complete)
│   ├── README.md              project write-up
│   ├── LICENSE
│   ├── CONTRIBUTING.md
│   ├── .github/workflows/     GitHub Actions pipeline (standalone layout)
│   ├── Application/           Phase 2 app + on-host ECR deploy script
│   ├── Infrastructure/        Terraform root module + host bootstrap
│   ├── remote_state/          separate root module for the S3 backend
│   ├── docs/                  CI/CD, architecture, deployment, operations, security
│   └── screenshots/           evidence capture instructions and redaction rules
│
└── .github/workflows/          root workflow for this combined repository
```

### Conventions for new projects

| Aspect | Convention |
|---|---|
| Directory name | `PHASE-<n>-PascalCase_with_underscores`: `PHASE-1-Iac_and_Ansible`, `PHASE-2-My_Project` |
| Own README | Every project directory carries its own `README.md`. The root README only indexes and summarises. |
| Own docs | Keep deep documentation in the project, not at the root. Depth belongs next to the code it describes. |
| Dependencies | Projects must not import each other. If two need the same module, copy it or extract it deliberately. |
| Secrets | Each project ships a `.gitignore` covering state, `.tfvars`, and key material. No committed credentials, ever. |
| License | MIT, with a `LICENSE` per project directory. |
| Screenshots | Redact public IPs, instance IDs, account IDs, ARNs, and `$HOME` paths before committing. |

---

## Contributing

Criticism is the primary contribution, not just code. Disagreeing with a design decision, a
severity rating, or a claim in the documentation is a valuable pull request.

Each project has its own `CONTRIBUTING.md` with project-specific guidance. Phase 1's is
[here](PHASE-1-Iac_and_Ansible/CONTRIBUTING.md), Phase 2's is
[here](PHASE-2-Docker_and_ECR/CONTRIBUTING.md), and Phase 3's is
[here](PHASE-3-CICD_Pipeline/CONTRIBUTING.md).

> **Never commit:** AWS account IDs, ARNs, IP addresses, instance IDs, `$HOME` paths, key
> material, or Terraform state. These repositories are public.

## License

MIT. See [`PHASE-1-Iac_and_Ansible/LICENSE`](PHASE-1-Iac_and_Ansible/LICENSE),
[`PHASE-2-Docker_and_ECR/LICENSE`](PHASE-2-Docker_and_ECR/LICENSE) and
[`PHASE-3-CICD_Pipeline/LICENSE`](PHASE-3-CICD_Pipeline/LICENSE).