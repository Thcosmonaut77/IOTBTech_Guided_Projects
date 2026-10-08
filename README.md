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
| 1 | AWS EC2 Fleet with Hybrid Bash + Ansible Bootstrap | [`Iac_and_Ansible/`](Iac_and_Ansible/README.md) | Complete, applied | Terraform · AWS · Ansible · Bash |
| 2 | _In progress_ | _TBD_ | Planned | _TBD_ |
| 3 | _In progress_ | _TBD_ | Planned | _TBD_ |

Phase 1 is the only project published so far. Phases 2 and 3 are under way and will land
as new top-level directories, following the layout conventions below.

---

## Phase 1 — AWS EC2 Fleet with Hybrid Bash + Ansible Bootstrap

Provision a three-node Ubuntu 24.04 EC2 fleet on AWS with Terraform, then configure it
through **two deliberately different automation paths** so the trade-offs between imperative
shell bootstrapping and declarative configuration management are visible side by side.

| Node | Provisioned by | Configured by | Role |
|---|---|---|---|
| `Cloud7-Master-Server` | Terraform | `setup-ansible.sh` (Bash over SSH) | Ansible control node |
| `Cloud7-Worker-Server1` | Terraform | `docker.yml` (Ansible playbook) | Docker + nginx container on port 80 |
| `Cloud7-Worker-Server2` | Terraform | `docker.yml` (Ansible playbook) | Docker + nginx container on port 80 |

**Why it is interesting.** You cannot install Ansible with Ansible, so something outside
Ansible has to install it and hand it an inventory. That "something" is `setup-ansible.sh`,
invoked as a Terraform `local-exec` provisioner. The project keeps both halves visible so
the bootstrap boundary stays auditable rather than hidden inside a cloud-init blob.

| | |
|---|---|
| Full write-up | **[Iac_and_Ansible/README.md](Iac_and_Ansible/README.md)** |
| Entry points | [`infrastructure/`](Iac_and_Ansible/infrastructure/) (main module) · [`remote_state/`](Iac_and_Ansible/remote_state/) (bootstrap state bucket) |
| Deep docs | Architecture · Deployment · Operations · Security · Known Issues · Cost · Review Checklist |
| Findings | 20 catalogued issues, several open, each with a patch |
| Running cost | ≈ $42/month 24×7, ≈ $11/month weekdays only |
| Automation model | Three stages: Terraform provisions, Bash bootstraps the control node, Ansible configures the workers |

There is no CI. Every check is a local command you run yourself.

---

## Repository Layout

This repository is a container for independent projects, not a monorepo with shared code.

```text
.
├── README.md                  ← you are here: index and orientation
│
├── Iac_and_Ansible/           ← Phase 1 (complete)
│   ├── README.md              project write-up
│   ├── LICENSE
│   ├── CONTRIBUTING.md
│   ├── Makefile
│   ├── infrastructure/        Terraform root modules + Ansible assets
│   ├── remote_state/          separate root module for the S3 backend
│   ├── docs/                  design rationale, runbooks, threat model
│   └── screenshots/           terminal captures from the live deployment
│
├── <phase_2>/                 ← next
└── <phase_3>/                 ← after that
```

### Conventions for new projects

| Aspect | Convention |
|---|---|
| Directory name | `PascalCase` with underscores: `Iac_and_Ansible`, `My_Project` |
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
[here](Iac_and_Ansible/CONTRIBUTING.md).

> **Never commit:** AWS account IDs, ARNs, `ssh_cidr` values, instance IDs, `$HOME` paths,
> key material, or Terraform state. These repositories are public.

## License

MIT. See [`Iac_and_Ansible/LICENSE`](Iac_and_Ansible/LICENSE).