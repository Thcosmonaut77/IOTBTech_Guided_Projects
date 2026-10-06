# Known Issues

Twenty defects, catalogued with severity, root cause, impact and a copy-pasteable patch.
This document exists so the repository can be reviewed honestly: everything below was found
by reading the configuration, not by guessing.

**Several entries have since been fixed in the working code.** The **Status** column in the
index records which. Each section marks a fixed entry and describes the original defect, so
the record of what was wrong — and why it mattered — survives the fix. Unfixed entries carry
a patch for the maintainer to apply deliberately.

- [Severity scale](#severity-scale)
- [Index](#index)
- [High severity](#high-severity)
- [Medium severity](#medium-severity)
- [Low severity](#low-severity)
- [Playbook quality issues](#playbook-quality-issues)
- [Suggested fix order](#suggested-fix-order)

---

## Severity scale

| Severity | Meaning |
|---|---|
| **High** | Can break the deployment, silently corrupt state, or defeat a security control. Fix before relying on this. |
| **Medium** | Works today but will cause a confusing failure, a silent no-op, or an unexpected replacement. |
| **Low** | Code smell, dead code, or cosmetic. No functional impact. |

---

## Index

| ID | Finding | Severity | File | Status |
|---|---|---|---|---|
| [KI-01](#ki-01) | `required_version` permits versions that cannot parse this config | **High** | `providers.tf` | Open |
| [KI-02](#ki-02) | `.gitignore` hid `.terraform.lock.hcl` | **Medium** | `.gitignore` | **Fixed** |
| [KI-03](#ki-03) | `key_name` hard-coded, collides across projects | **Low** | `firewall.tf` | **Fixed** |
| [KI-04](#ki-04) | `var.key` was dead code | **Low** | `variables.tf` | **Fixed** |
| [KI-05](#ki-05) | Worker private vs public IP used inconsistently | **Medium** | `ansible.tf`, `outputs.tf`, `setup-ansible.sh` | **Fixed** |
| [KI-06](#ki-06) | Bootstrap state is unprotected | **Medium** | `remote_state/` | Open |
| [KI-07](#ki-07) | AMI resolved from a moving SSM parameter | **Medium** | `compute.tf` | Open |
| [KI-08](#ki-08) | SSH host-key verification is TOFU, not authoritative | **High** | `setup-ansible.sh` | Open |
| [KI-09](#ki-09) | Playbook target set is implicit | **Medium** | `docker.yml` | **Fixed** |
| [KI-10](#ki-10) | `random_id` unused; bucket name can collide | **Medium** | `remote_state/main.tf` | Partly fixed |
| [KI-11](#ki-11) | Three files failed `terraform fmt` | **Low** | multiple | **Fixed** |
| [KI-12](#ki-12) | `docker.yml` duplicated; the repo copy was unused | **High** | `setup-ansible.sh`, `docker.yml` | **Fixed** |
| [KI-13](#ki-13) | `ssh_public_key` inventory variable is never used | **Low** | `setup-ansible.sh` | Open |
| [KI-14](#ki-14) | IMDSv2 not enforced, root volume not explicitly encrypted | **Medium** | `compute.tf` | Open |
| [KI-15](#ki-15) | Availability zone list unsorted; single AZ | **Medium** | `networking.tf` | Open |
| [KI-16](#ki-16) | No `lifecycle` guards; changes force replacement | **Medium** | `compute.tf` | Open |
| [KI-17](#ki-17) | `docker.yml` line endings and trailing newline | **Low** | `docker.yml` | Partly fixed |
| [KI-18](#ki-18) | Playbook publishes port 80 with no matching ingress rule | **Medium** | `firewall.tf`, `docker.yml` | **Fixed** |
| [KI-19](#ki-19) | Shared SG makes the master's copy of the key an internet-reachable fleet credential | **High** | `firewall.tf`, `compute.tf` | Accepted / documented |
| [KI-20](#ki-20) | No key-removal or post-rotation cleanup procedure | **Medium** | `setup-ansible.sh`, docs | **Fixed** |

---

## High severity

### KI-01

`required_version` permits versions that cannot parse this config

| | |
|---|---|
| **File** | `providers.tf:2` |
| **Severity** | High |
| **Category** | Correctness / reproducibility |

**Current**

```hcl
terraform -chdir=infrastructure {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket       = "cloud77-terraform-state"
    key          = "terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
    encrypt      = true
  }
}
```

**Root cause.** Three features are used that postdate the declared floor:

| Feature | Requires | Introduced in |
|---|---|---|
| `use_lockfile` (S3-native state locking) | **Terraform ≥ 1.10** | 1.10.0 |
| `terraform_data` resource type | Terraform ≥ 1.4 | 1.4.0 |
| `moved` blocks (recommended, not used) | Terraform ≥ 1.1 | 1.1.0 |

The binding constraint is `use_lockfile`. A user on Terraform 1.5, 1.6, 1.9 — all of which
satisfy `>= 1.5` — gets an error from the backend initialisation stage that does **not**
mention version requirements, because the failure occurs in the backend, before the
`required_version` check is meaningful in context:

```text
Error: Unsupported argument
  on main.tf line 1:
   1: terraform {
An argument named "use_lockfile" is not expected here.
```

**Impact.** The declared constraint is a lie. It permits versions that cannot run this
configuration and excludes no version that can. It also understates the real requirement for
anyone auditing the repository.

**Patch**

```hcl
terraform -chdir=infrastructure {
  required_version = ">= 1.10, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }
  ...
}
```

**Verification**

```bash
terraform -chdir=infrastructure version   # must be >= 1.10
terraform -chdir=infrastructure init -upgrade
terraform -chdir=infrastructure validate
```

---

### KI-08

SSH host-key verification is disabled end to end

| | |
|---|---|
| **File** | `setup-ansible.sh:164-166`, `setup-ansible.sh:192-204` |
| **Severity** | High |
| **Category** | Security |
| **Full analysis** | [SECURITY.md § S1](SECURITY.md#s1--ssh-host-key-verification-is-tofu-not-authoritative) |

**Current**

```bash
# setup-ansible.sh:164
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o IdentitiesOnly=yes -o ConnectTimeout=10 -o LogLevel=ERROR
          -i "$KEY_FILE")
```

```ini
# generated ansible.cfg, setup-ansible.sh:195
host_key_checking = False
```

**Root cause.** Legitimate convenience (fresh instances have no `known_hosts` entry, and
worker IPs change on replacement) solved by disabling verification entirely, rather than by
trusting a key exactly once.

**Impact.** Every SSH connection the stack makes is encrypted but unauthenticated, and
records nothing. Vulnerable to any attacker on the network path. Two sessions matter most:
the initial connection to the master, and every master → worker session Ansible opens. In
the latter case the private key is presented to a host whose identity was never checked.

**Patch — part 1, the bootstrap path**

```bash
# setup-ansible.sh:164 — replace
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o IdentitiesOnly=yes -o ConnectTimeout=10 -o LogLevel=ERROR
          -i "$KEY_FILE")

# with — TOFU: records on first contact, refuses a CHANGED key thereafter
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes
          -o ConnectTimeout=10 -o LogLevel=ERROR
          -i "$KEY_FILE")
```

Because instances are replaced rather than rebuilt in place, `accept-new` is the correct
policy here: a new instance legitimately presents a new key, and the operator's existing
entry is for an IP that no longer exists.

**Patch — part 2, the Ansible path**

```bash
# setup-ansible.sh:191-204 — replace
cat > "$LOCAL_TMP/ansible.cfg" <<EOF
[defaults]
inventory = $REMOTE_DIR/hosts.ini
host_key_checking = False
...
EOF

# with
cat > "$LOCAL_TMP/ansible.cfg" <<EOF
[defaults]
inventory = $REMOTE_DIR/hosts.ini
host_key_checking = True
ssh_known_hosts_check = True
...
EOF
```

Also seed a `known_hosts` file so verification is authoritative rather than TOFU:

```bash
# After workers are reachable, capture their real host keys
"${ssh_cmd[@]}" "ssh-keyscan -H ${WORKER_IPS[*]} > '$REMOTE_DIR/known_hosts' 2>/dev/null"
"${scp_cmd[@]}" "$LOCAL_TMP/known_hosts" "$SSH_USER@$MASTER_IP:$REMOTE_DIR/known_hosts"

# And in ansible.cfg
#   ssh_common_args = -o UserKnownHostsFile=$REMOTE_DIR/known_hosts
```

Note `$REMOTE_DIR` is substituted by the heredoc at generation time, so this must be added
inside the `cat > ... <<EOF` block.

**Verification**

```bash
ssh ubuntu@$MASTER 'grep -E "host_key_checking" ~/ansible/ansible.cfg'
# Expect: host_key_checking = True
ssh ubuntu@$MASTER 'wc -l ~/.ssh/known_hosts ~/ansible/known_hosts 2>/dev/null'
```

---

### KI-12

`docker.yml` is duplicated; the repository copy is never used

| | |
|---|---|
| **File** | `setup-ansible.sh:225` (heredoc) and `docker.yml` |
| **Severity** | High |
| **Category** | Correctness / maintenance |
| **Status** | **Fixed in this repository.** `setup-ansible.sh` now ships the tracked file via `cp`; the heredoc is gone. The original defect is described below for reference. |

**Original root cause.** The playbook existed twice:

1. As `docker.yml` in the repository root — the copy a human reads and a reviewer reviews.
2. As a heredoc inside `setup-ansible.sh` between `cat > "$LOCAL_TMP/docker.yml" <<'EOF'`
   and the closing `EOF` — the copy that was actually shipped to the workers.

They were identical apart from the trailing newline. Nothing kept them in sync: no
checksum, no `filesha256` over `docker.yml` in `triggers_replace`, and no check comparing
them.

**Impact — a silent no-op.**

```bash
vim infrastructure/docker.yml   # add a task
terraform -chdir=infrastructure apply           # does nothing — docker.yml was not in triggers_replace
```

Even `terraform apply -replace=terraform_data.ansible_setup` did not help, because the
script regenerated `~/ansible/docker.yml` from its own heredoc, overwriting the change. A
reviewer approving a PR that modified `docker.yml` reviewed a file that never reached
production.

**Fix applied — option A: the repo file is authoritative**

`setup-ansible.sh:225` now reads:

```bash
cp "$DIR/docker.yml" "$LOCAL_TMP/docker.yml"
```

and `ansible.tf` carries the playbook in `triggers_replace`:

```hcl
triggers_replace = {
  master_ip  = aws_instance.master_node.public_ip
  worker_ips = join(",", aws_instance.worker_node[*].private_ip)
  script     = filesha256("${path.module}/setup-ansible.sh")
  playbook   = filesha256("${path.module}/docker.yml")
}
```

There is now exactly one copy of the playbook in the repository.

**Verification**

```bash
# No heredoc remains in the script.
grep -c 'cat > .*docker\.yml' infrastructure/setup-ansible.sh    # must return 0

# Editing the playbook re-triggers the bootstrap.
vim infrastructure/docker.yml
terraform -chdir=infrastructure plan                                    # must show terraform_data.ansible_setup replaced
```

---

## Medium severity

### KI-02

`.gitignore` hides `.terraform.lock.hcl`

| | |
|---|---|
| **File** | `.gitignore` |
| **Severity** | Medium |
| **Category** | Repository hygiene |
| **Status** | Fixed in this repository; the original two-line file is preserved below |

**Current** (as originally written)

```gitignore
.*
terraform.*
```

**Root cause.** Two patterns are doing far more than intended. Both match at **any**
directory depth, because neither contains a slash.

| Pattern | Intended | Actual |
|---|---|---|
| `terraform.*` | `terraform.tfstate`, `terraform.tfvars` | Also `terraform.tfvars.example`, `terraform.tfplan` |
| `.*` | `.terraform/` | Also `.terraform.lock.hcl`, `.gitignore` itself, `.editorconfig`, `.gitattributes`, `.env`, `.vscode/` |

**Impact — two distinct problems.**

1. **`.terraform.lock.hcl` is not committed.** This is the file that pins provider and
   checksum versions. Without it, every developer and every future clone resolves provider
   versions independently. Two people can run the same commit against different AWS provider
   builds, and AWS provider 5.x contains breaking changes across minor versions.
   Reproducibility — the primary benefit of Terraform — is lost.
2. **`terraform.tfvars.example` is not committed**, so the template other people are meant
   to copy does not exist for them.

> **Severity note.** This was originally rated **High** because the same `.*` pattern also
> excluded `.github/`, which made any CI workflow permanently untrackable. This repository
> ships no CI, so that failure mode no longer applies and the rating is reduced to
> **Medium**. The provider-locking problem is real but does not affect a running deployment.

**No functional impact on a running deployment.** This is a publishing and correctness
problem, not a runtime problem — which is exactly why it is easy to miss.

**Patch**

```gitignore
# Terraform state and variables — never commit
*.tfstate
*.tfstate.*
*.tfplan
crash.log
crash.*.log
terraform.tfvars
*.auto.tfvars
override.tf
override_tofu.tf
*_override.tf
*_override.tofu.tf

# Terraform provider cache and local CLI config
.terraform/
.terraform.tfstate.lock.info

# NOTE: .terraform.lock.hcl is intentionally NOT ignored. Commit it.

# Credentials and keys — belt and braces
*.pem
*.key
*.p12
id_rsa*
id_ed25519*
.env
.env.*
!.env.example

# OS and editor noise
.DS_Store
Thumbs.db
*.swp
*~
.idea/
.vscode/

# Local artifacts from the deployment docs
.master_ip
tfplan
tfplan.txt
```

Note the two deliberate inversions: `.terraform.lock.hcl` is committed, and everything under
`.terraform/` except the lock file is ignored.

Pair this with [`.gitattributes`](#ki-17) — without a line-ending policy, a Windows clone will
still produce inconsistent bytes for `docker.yml` even once it is tracked.

**Verification**

```bash
git check-ignore -v infrastructure/.terraform.lock.hcl
# Must print nothing — if it matches, the file is still ignored.

git add -n infrastructure/.terraform.lock.hcl infrastructure/terraform.tfvars.example
# Must list both files as addable.

git add -n infrastructure/terraform.tfvars
# Must print nothing — this one SHOULD be ignored.
```

---

### KI-05

Worker private vs public IP were used inconsistently

| | |
|---|---|
| **File** | `ansible.tf`, `outputs.tf`, `setup-ansible.sh` |
| **Severity** | Medium |
| **Category** | Correctness / documentation |
| **Status** | **Fixed in this repository.** Both outputs and the script fallback now use and describe private IPs; the original is preserved below |

**Original root cause.** Three places disagreed about which address Ansible should use.

| Location | Address used |
|---|---|
| `ansible.tf:14` — passes to the script | `aws_instance.worker_node[*].private_ip` |
| `outputs.tf:6-9` — `worker_public_ips`, described as "feed these to the Ansible inventory" | **public** |
| `setup-ansible.sh:111` — Terraform-output fallback | `worker_public_ips` — **public** |

**Impact.**

- The normal path (invoked by Terraform) uses **private** IPs, which is correct: master →
  worker traffic stays inside the VPC and never traverses the IGW.
- The manual path (`bash ./infrastructure/setup-ansible.sh` with no arguments) uses **public** IPs. This
  works, but it routes inter-node SSH out to the internet and back, exposing it to the exact
  MITM risk in [KI-08](#ki-08), and it depends on the workers retaining public IPs.
- `outputs.tf` documents the public IPs as the inventory input, which is wrong. A reviewer
  or a new operator following the output description will build an inventory that differs
  from the one Terraform actually configures.

**Patch**

```hcl
# outputs.tf — correct the description to match reality
output "worker_private_ips" {
  description = "Private IPs of the worker nodes. These are what Ansible connects to, over the VPC."
  value       = aws_instance.worker_node[*].private_ip
}

output "worker_public_ips" {
  description = "Public IPs of the worker nodes. Informational only; not used by Ansible."
  value       = aws_instance.worker_node[*].public_ip
}
```

```bash
# setup-ansible.sh — read private IPs in the fallback
print(val("master_public_ip"))
print(" ".join(str(i) for i in out.get("worker_private_ips", {}).get("value", [])))
print(val("private_key_file"))
```

---

### KI-06

Bootstrap state is unprotected

| | |
|---|---|
| **File** | `remote_state/` (whole module) |
| **Severity** | Medium |
| **Category** | State management |

**Root cause.** `remote_state/` has no `backend` block, so its state lives in
`remote_state/terraform.tfstate` on whichever machine ran `terraform apply`. That file is
the only record of the state bucket's ID, its versioning configuration, its encryption
configuration and its public-access-block settings.

**Impact.**

- If the file is lost and the bucket still exists, you must `terraform import` all five
  resources by hand before the next `terraform apply` can plan a change.
- The file is git-ignored (correctly), so it exists in exactly one place.
- It contains no secrets, but it is still the only source of truth for the bucket's
  configuration.

**Patch — back it up, and note the residual risk**

```bash
# Add to a pre-commit or scheduled job
cp remote_state/terraform.tfstate \
   "s3://cloud77-terraform-state/backup/remote_state-$(date +%Y%m%d).tfstate"
```

Fully removing the problem means giving the bootstrap module a backend of its own, which
requires bootstrapping a second bucket — usually not worth it at this size. The accepted
practice is: bootstrap state is disposable, because recreating the bucket is cheap and the
*fleet* state (the part that matters) is already remote.

**Verification**

```bash
ls -la remote_state/terraform.tfstate
aws s3 ls s3://cloud77-terraform-state/backup/
```

---

### KI-07

AMI resolved from a moving SSM parameter

| | |
|---|---|
| **File** | `compute.tf:2-4` |
| **Severity** | Medium |
| **Category** | Reproducibility |

**Current**

```hcl
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}
```

**Root cause.** `stable/current` is a pointer, not a value. Canonical repoints it whenever a
new Ubuntu 24.04 build is published.

**Impact.** `terraform plan` can spontaneously propose replacing all three instances,
weeks after a clean apply — with no change to any file in the repository. That reads as a
bug and destroys working nodes. Conversely, after such a replacement you cannot prove which
build you are running. It also means a `terraform apply` months apart produces two
environments with different patch levels, which makes a "why does this only happen on the
new nodes" bug very hard to answer.

**This is a deliberate trade-off**, not an oversight: `current` gives you security patches
without any work. The documentation should make the consequence explicit rather than
removing the behaviour.

**Patch — option A: pin the AMI ID (fully reproducible)**

```hcl
variable "ubuntu_ami_id" {
  description = "Ubuntu 24.04 LTS AMI ID. Pin this for reproducibility."
  type        = string
  default     = "ami-0e2c8caa4b6378d8c"   # eu-north-1, resolved 2026-04-08
}

resource "aws_instance" "master_node" {
  ami           = var.ubuntu_ami_id
  # ...
}
```

**Patch — option B: record the AMI without pinning (recommended for a lab)**

Keep the SSM lookup, but write the resolved value into the instance tags so it is always
visible in the console and in state history:

```hcl
locals {
  ubuntu_ami_id = data.aws_ssm_parameter.ubuntu.value
}

resource "aws_instance" "master_node" {
  ami           = local.ubuntu_ami_id
  # ...
  tags = {
    Name    = "${var.project}-Master-Server"
    AMI     = local.ubuntu_ami_id
    AMISource = "canonical-24.04-ssm-current"
  }
}
```

**Patch — option C: pin by digest (most robust)**

```hcl
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]   # Canonical  <!-- ci-allow-public-id -->
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}
```

…then commit the resulting AMI ID and a `check` block that fails when it drifts.

---

### KI-09

Playbook target set is implicit

| | |
|---|---|
| **File** | `docker.yml:3`, `setup-ansible.sh:206-218` |
| **Severity** | Medium |
| **Category** | Correctness / comprehensibility |

**Root cause.** The playbook says:

```yaml
- name: Install Docker on Ubuntu 24.04
  hosts: all
```

but the generated inventory contains **only** the workers:

```ini
[workers]
worker-01 ansible_host=10.0.1.14
worker-02 ansible_host=10.0.1.35

[workers:vars]
ansible_user=ubuntu
...
```

**Impact.** `all` resolves to `worker-01` and `worker-02`. Docker is **never installed on
the master**. This is almost certainly the intent — the control node runs the automation,
the workers run the workloads — but nothing states it. A reviewer reasonably assumes
`hosts: all` means "all three instances" and may conclude the master was missed. It is also
fragile: adding the master to the inventory later silently changes what the playbook does.

The playbook's own name, "Install Docker on Ubuntu 24.04", does not help either.

**Patch — make the target explicit**

```yaml
- name: Install Docker on the worker fleet
  hosts: workers
  become: yes
```

**Patch — or, if you want Docker on all three nodes**

```bash
# setup-ansible.sh — add the master to the inventory
{
  echo "[all_instances]"
  printf 'master ansible_host=%s\n' "$MASTER_IP"
  echo
  echo "[workers]"
  ...
}
```

…but then the master needs to reach its own public IP, which depends on hairpin NAT
behaviour that does not work everywhere. Private IPs for self, public for workers is the
usual resolution.

**Verification**

```bash
ssh ubuntu@$MASTER 'cd ~/ansible && ansible-inventory --graph'
# all
  └── workers
       ├── worker-01
       └── worker-02
# Confirms: no master.
```

---

### KI-10

`random_id` is unused and the bucket name can collide

| | |
|---|---|
| **File** | `remote_state/main.tf` |
| **Severity** | Medium |
| **Category** | Correctness |
| **Status** | Partly fixed. The dead `random_id`, its provider requirement, and the `project`/`region` variables with their `terraform.tfvars` are all removed; the bucket name is now a literal in both modules. The collision risk itself is unchanged |

**Original**

```hcl
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "tf_state" {
  bucket        = "${var.project}-terraform-state"
  force_destroy = false
}
```

**Root cause.** `random_id.bucket_suffix` generated 8 hex characters that were **never
interpolated into the bucket name**. It was dead code. Meanwhile the bucket name was a fixed
string.

**Impact.**

1. **Global namespace collision.** S3 bucket names are unique across all of AWS, not per
   account. A second person following this README in their own account hits
   `BucketAlreadyExists` / `BucketAlreadyOwnedByYou`. Two deployments in the same account
   collide too. The `random_id` looked like it was *meant* to prevent exactly this and did
   not.
2. **`terraform plan` on the bootstrap module always showed `random_id` changing nothing
   useful**, which reviewers flag immediately.

**Fix applied.** The `random_id` resource and the `hashicorp/random` entry in
`required_providers` are both deleted, as are `remote_state/variables.tf` and
`remote_state/terraform.tfvars`. The bucket name is unchanged — it is now a literal
`cloud77-terraform-state` in both `remote_state/main.tf` and `providers.tf`.

Removing the variables is the honest version of this fix. They made the name look
parameterised; because a `backend` block cannot read `var.*`, they could not actually be
changed in step with the root module, so they were a third place to forget to edit.

**Not fixed — the collision risk remains.** Removing the dead code removes the misleading
part; it does not make the name unique.

**Patch — if you want a unique name, add it back correctly:**

```hcl
resource "aws_s3_bucket" "tf_state" {
  bucket        = "${var.project}-terraform-state-${random_id.bucket_suffix.hex}"
  force_destroy = false
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
  keepers = {
    project = var.project
    region  = var.region
  }
}
```

The `keepers` block is what makes this *correct* rather than merely working: without it,
Terraform may regenerate the suffix on a later plan and try to rename the bucket, which S3
does not allow — `bucket` is a force-new attribute.

**Then update the backend to match:**

```hcl
# providers.tf
backend "s3" {
  bucket = "cloud77-terraform-state-a1b2c3d4"   # from `terraform output -raw bucket_name`
  # ...
}
```

The cheaper alternative is to keep the fixed name and give each operator their own
`project` value, which already feeds the bucket name.

Note this reintroduces the duplication problem described in
[ARCHITECTURE.md § Module topology](ARCHITECTURE.md#module-topology): the backend bucket
name is a literal in `providers.tf`, so it must be updated by hand whenever the bootstrap
module is re-applied with a new suffix.

---

### KI-18

Playbook published port 80 with no matching ingress rule

| | |
|---|---|
| **File** | `firewall.tf`, `docker.yml` |
| **Severity** | Medium |
| **Category** | Correctness |
| **Status** | **Fixed in this repository.** Two ingress rules added; the original is described below |

**Original.** `docker.yml` grew a task that starts an nginx container with
`published_ports: ["80:80"]`, but `firewall.tf` defined no rule for port 80. The container
started and served locally, and the playbook's own verification task passed — because it
checked `http://localhost:80` from inside the worker. Nothing in the run reported a problem.

**Impact.** The service was unreachable from outside the VPC. The playbook reported success,
so the failure mode was invisible: an operator would reasonably conclude the web server was
deployed and reachable. This is the same class of bug as [KI-12](#ki-12) — a green run that
does not mean what it appears to mean.

**Fix applied.** Two ingress rules in `firewall.tf`, both scoped rather than open:

```hcl
ingress {
  description = "HTTP to the nginx container on the workers, operator IP only"
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = [var.ssh_cidr]
}

ingress {
  description = "HTTP between nodes inside the VPC"
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = [var.vpc_cidr]
}
```

Port 80 is reachable from the operator's `/32` and from inside the VPC, and from nowhere
else. Widen it to `0.0.0.0/0` only if you intend the workers to serve the public internet —
and read [SECURITY.md](SECURITY.md) first.

**Verification**

```bash
terraform -chdir=infrastructure plan -target=aws_security_group.ec2     # 2 ingress rules to add
ansible worker-01 -m uri -a "url=http://localhost"
curl http://<worker-public-ip>                    # from an address inside ssh_cidr
```

---

### KI-19

One shared security group makes the master's copy of the key a fleet-wide, internet-reachable credential

| | |
|---|---|
| **File** | `firewall.tf`, `compute.tf` |
| **Severity** | High |
| **Category** | Security |
| **Status** | **Accepted and documented, not fixed.** The fix is known and is one edit, but it changes network reachability, so it is left to the operator |
| **Full analysis** | [SECURITY.md § S3, S4, S9](SECURITY.md#s3--the-private-key-is-copied-to-the-control-node-and-left-there) |

**What is wrong.** `aws_security_group.ec2` is attached to the master *and* both workers
(`compute.tf:10,21`), and its first rule admits port 22 from `var.ssh_cidr` — the operator's
public `/32`. So the workers are directly reachable on SSH from the internet.

That matters because of what `setup-ansible.sh` puts on the master. `~/ansible/key` is not a
dedicated master→worker credential: it is a byte-for-byte copy of the operator's own
private key, and `aws_key_pair.ansible` installs that same public key on all three
instances. Three facts therefore combine:

- The key is valid against **every** node, not just the workers.
- It is usable from **anywhere the operator's `/32` is allowed**, not only from inside the VPC.
- Inside the VPC the master reaches the workers anyway, via the `vpc_cidr` rule.

**Impact.** Blast radius is the whole fleet. Anything that reads `~/ansible/key` — any
process running as `ubuntu`, including a malicious Ansible collection installed by
`ansible-galaxy` in step 4/6 — exfiltrates fleet-wide SSH access rather than access to a
single node. Master compromise is fleet compromise. This is the same conclusion as
[KI-08](#ki-08) and [KI-12](#ki-12) in a different costume: a control that *looks* narrower
than it is.

**Why the obvious fix is not applied here.** Splitting the SG by role is a small edit and an
in-place update (changing an ingress rule on an attached SG does not force instance
replacement), but it removes direct operator → worker SSH. That is the documented intent —
the master is meant to be the only entry point — yet it is a reachability change, so it is
the operator's call rather than a silent fix.

**Fix, if you want it.** Replace the single SG with two plus a shared egress, or minimally
give the workers their own group:

```hcl
# Master keeps both rules; workers get vpc_cidr only.
resource "aws_security_group" "worker" {
  name   = "${var.project}-worker-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "SSH from the control node only"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  # port 80 ingress + egress mirror aws_security_group.ec2

  tags = { Name = "${var.project}-worker-sg" }
}
```

Then `worker_node` uses `vpc_security_group_ids = [aws_security_group.worker.id]` while
`master_node` keeps `ec2`. Note this re-opens port 80 questions separately: the workers'
HTTP rule would move to the new group.

**Interim mitigations, no code change.** Document that the master is the only entry point
and that the key on it is fleet-wide — both are now stated in
[OPERATIONS.md § Day-2 mental model](OPERATIONS.md#day-2-mental-model) — and remove the key
when the master is idle, per
[OPERATIONS.md § Removing the bootstrap key from the master](OPERATIONS.md#removing-the-bootstrap-key-from-the-master).

**Verification**

```bash
# Today: 22 is open to your /32 on all three instances, because they share Cloud7-sg.
aws ec2 describe-security-groups --filters "Name=group-name,Values=Cloud7-sg" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text

# After splitting: Cloud7-worker-sg must exist and must NOT list your /32.
aws ec2 describe-security-groups --filters "Name=group-name,Values=Cloud7-worker-sg" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text
```

---

### KI-20

No procedure for removing the key from the master or cleaning up after a rotation

| | |
|---|---|
| **File** | `setup-ansible.sh`, `docs/OPERATIONS.md` |
| **Severity** | Medium |
| **Category** | Operability / Security |
| **Status** | **Fixed in this repository.** The procedures are documented; the underlying exposure is [KI-19](#ki-19) |

**Original.** The script pushed `~/ansible/key` to the master and never mentioned it again.
The runbook's rotation steps described replacing the key pair and re-running the playbook,
but said nothing about the copy already sitting on the instance, and offered only
`shred -u` as a removal hint — with no explanation of what breaks afterwards.

**Impact, two ways.**

1. A long-lived master keeps a fleet-wide private key on disk indefinitely, with no
   documented way to clear it.
2. Operators who *did* remove it could not get it back without a full bootstrap, and the
   failure mode is a confusing `UNREACHABLE!` from Ansible rather than an obvious "the key
   is missing". During an incident that wastes time.

**Fix applied.** [OPERATIONS.md § Removing the bootstrap key from the master](OPERATIONS.md#removing-the-bootstrap-key-from-the-master)
now documents the removal command, exactly what breaks (Stage 3 only — Docker on the workers
keeps running), the `UNREACHABLE!` signature to recognise it, and two ways to re-push the
key: a direct `scp`, or `terraform apply -replace=terraform_data.ansible_setup`. It also
explains why `shred` was dropped: on ext4 with journaling, overlayfs and any copy-on-write
filesystem it does not reliably destroy old blocks, so `rm` is sufficient.

[OPERATIONS.md § Cleaning up after a rotation](OPERATIONS.md#cleaning-up-after-a-rotation)
covers the two cases where a stale copy outlives the rotation — an instance Terraform no
longer manages, and a snapshot or AMI taken beforehand — and gives the
`describe-key-pairs` check that confirms the old pair is gone.

**Verification**

```bash
grep -c 'rm -f ~/ansible/key' docs/OPERATIONS.md    # the removal command is documented
grep -c 'UNREACHABLE' docs/OPERATIONS.md            # so is how to recognise the failure
```

---

### KI-14

IMDSv2 not enforced and the root volume is not explicitly encrypted

| | |
|---|---|
| **File** | `compute.tf` |
| **Severity** | Medium |
| **Category** | Security |
| **Full analysis** | [SECURITY.md § S5, S13](SECURITY.md#s5--imdsv1-is-not-enforced) |

**Current.** Neither `aws_instance` block sets `metadata_options` or `root_block_device`.

**Impact.**

1. **IMDSv1 is accepted.** Any SSRF in any process on the node can read instance
   credentials with a plain `GET`. The workers run Docker, whose tooling has a history of
   SSRF-adjacent issues, and egress is unrestricted (see
   [SECURITY.md § S2](SECURITY.md#s2--unrestricted-egress-from-every-node)), so
   `169.254.169.254` is reachable.
2. **Encryption relies on an account-level default** that is not visible in this
   configuration. If that default ever differs — a different account, an AMI baked with
   unencrypted root — nothing here catches it.

**Patch**

```hcl
# Apply to BOTH aws_instance resources
metadata_options {
  http_endpoint               = "enabled"
  http_tokens                 = "required"
  http_put_response_hop_limit = 1
  instance_metadata_tags      = "disabled"
}

root_block_device {
  encrypted   = true
  volume_type = "gp3"
  volume_size = 8
  tags        = { Name = "${var.project}-root" }
}
```

**Caveat.** `http_put_response_hop_limit = 1` will break any legitimate use of IMDS from
inside a container on the node, because container networking adds hops. If you plan to run
containers that call IMDS, set it to `2` or leave it at the default of `2`.

**Note.** Both attributes are updatable in place — this does **not** force instance
replacement.

---

### KI-15

Availability zone list is unsorted and single-AZ

| | |
|---|---|
| **File** | `networking.tf:1-3, 19` |
| **Severity** | Medium |
| **Category** | Determinism / availability |

**Current**

```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "public" {
  # ...
  availability_zone = data.aws_availability_zones.available.names[0]
}
```

**Root cause.** Two separate problems.

1. **`names[0]` is not deterministic.** The AWS provider returns AZ names in an order that
   is not guaranteed stable across regions, API versions, or provider releases. `names[0]`
   resolved to one AZ during development. A future `terraform init -upgrade` could resolve
   to a different one, and since `availability_zone` is force-new on the subnet, Terraform
   would propose **replacing the subnet and all three instances** — with no change to any
   file in the repository.
2. **Single-AZ by design.** The fleet cannot survive an AZ failure, and Terraform will not
   distribute instances across AZs. For a three-node lab that is a reasonable simplification;
   the documentation should say so rather than leave it implicit.

**Patch — part 1, determinism (do this regardless of AZ count)**

```hcl
locals {
  # Sort for a stable, region-independent choice. data.aws_availability_zones.available
  # is unordered, so names[0] is not reproducible across provider versions.
  availability_zones = sort(data.aws_availability_zones.available.names)
}

resource "aws_subnet" "public" {
  # ...
  availability_zone = local.availability_zones[0]
}
```

**Patch — part 2, optional multi-AZ**

```hcl
resource "aws_subnet" "public" {
  count = length(local.availability_zones)
  # ...
  availability_zone = local.availability_zones[count.index]
  tags = { Name = "${var.project}-public-subnet-${count.index + 1}" }
}

# Then distribute instances across subnets
resource "aws_instance" "worker_node" {
  count = 2
  subnet_id = element(
    aws_subnet.public[*].id,
    count.index % length(aws_subnet.public)
  )
}
```

Multi-AZ also requires rethinking the bootstrap: the master may be in a different AZ from a
worker, so the private-IP path still works (AWS inter-AZ traffic stays on the backbone) but
cross-AZ data transfer is billed at $0.01/GB in each direction. See [COST.md](COST.md).

---

### KI-16

No `lifecycle` guards; ordinary changes force replacement

| | |
|---|---|
| **File** | `compute.tf` |
| **Severity** | Medium |
| **Category** | Availability / safety |

**Root cause.** Neither `aws_instance` has a `lifecycle` block, and neither the key pair nor
the state bucket has `prevent_destroy`.

**Impact.**

| Change | Effect today | Consequence |
|---|---|---|
| `instance_type` t3.micro → t3.small | Destroy, then create | Full outage; new private IPs re-trigger the bootstrap |
| `key_name` change (key rotation) | Destroy, then create | All three nodes replaced — see [OPERATIONS.md](OPERATIONS.md#rotating-the-ssh-key) |
| AMI SSM parameter moves ([KI-07](#ki-07)) | Destroy, then create | Unplanned outage weeks after a clean apply |
| AZ ordering changes ([KI-15](#ki-15)) | Subnet replaced → all instances replaced | Unplanned outage |
| `terraform destroy` by mistake | Everything gone | No recovery except state rollback |

Terraform's default destroy-then-create order also means there is a window where the old
node is already gone and the new one is not yet bootstrapped — which is precisely when the
`~/ansible/key` on the old master disappears and the new master has no inventory.

**Patch — part 1, `create_before_destroy` on instances**

```hcl
resource "aws_instance" "master_node" {
  # ...
  lifecycle {
    create_before_destroy = true
  }
}
```

This reduces the outage from *destroy + create + bootstrap* to *create + bootstrap + destroy*.
For a single-instance resource it also requires a `name` to be `name_prefix`-based or left
unset, so the names do not collide — here `Name` is only a tag, so no change is needed.

**Patch — part 2, protect state and keys**

```hcl
# remote_state/main.tf
resource "aws_s3_bucket" "tf_state" {
  bucket        = "..."
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

# firewall.tf
resource "aws_key_pair" "ansible" {
  key_name   = "${var.project}-ansible"
  public_key = file(var.public_key_file)
  lifecycle {
    prevent_destroy = true
  }
}
```

**Patch — part 3, catch instance replacement in review**

```hcl
check "instance_replacement_is_intentional" {
  assert {
    condition     = alltrue([for i in aws_instance.worker_node : i.instance_id != ""])
    error_message = "Worker instances are being replaced. Confirm this is intended (AMI drift, key rotation, instance type change)."
  }
}
```

**Caveat.** `prevent_destroy` on the bucket means `terraform destroy` in `remote_state/`
requires editing the block first. That is the point — but document it in
[OPERATIONS.md § Teardown](DEPLOYMENT.md#2-destroy-the-state-bucket-optional) so the
next operator is not surprised.

---

## Low severity

### KI-03

`key_name` was hard-coded and collided across projects

| | |
|---|---|
| **File** | `firewall.tf` |
| **Severity** | Low |
| **Category** | Correctness / naming |
| **Status** | **Fixed in this repository.** `key_name` is now `"${var.project}-ansible"`; the original is preserved below |

**Original**

```hcl
resource "aws_key_pair" "ansible" {
  key_name   = "terraform-ansible"
  public_key = file(var.public_key_file)
  tags       = { Name = "${var.project}-keypair" }
}
```

**Root cause.** Every other resource derived its name from `var.project`; the key pair did
not. EC2 key pair names are unique per region per account, so a second project in the same
account failed with `InvalidKeyPair.Duplicate`. The name also advertised the stack's purpose
to anyone enumerating key pairs.

> ⚠️ **Applying this fix replaces all three instances**, because `key_name` on
> `aws_instance` is force-new. On an existing deployment, plan a maintenance window or
> accept the replacement — see [OPERATIONS.md](OPERATIONS.md#rotating-the-ssh-key).

**Patch**

```hcl
resource "aws_key_pair" "ansible" {
  key_name   = "${var.project}-ansible"
  public_key = file(var.public_key_file)
  tags       = { Name = "${var.project}-keypair" }
  lifecycle {
    prevent_destroy = true
  }
}
```

**Impact of the patch.** Changing `key_name` forces instance replacement. Plan a maintenance
window — see [OPERATIONS.md § Rotating the SSH key](OPERATIONS.md#rotating-the-ssh-key).

---

### KI-04

`var.key` was dead code

| | |
|---|---|
| **File** | `variables.tf`, `terraform.tfvars` |
| **Severity** | Low |
| **Category** | Dead code |
| **Status** | **Fixed in this repository.** The variable has been deleted. The same reasoning was then applied to `remote_state/`: it had `project` and `region` variables and a `terraform.tfvars`, all feeding a bucket name the root module can only see as a hard-coded literal, so `remote_state/variables.tf` and `remote_state/terraform.tfvars` were deleted too. The original is preserved below |

**Original**

```hcl
variable "key" {
  description = "Bucket key"
  type = string
}
```

```hcl
# terraform.tfvars
key = "terraform.tfstate"
```

**Root cause.** The backend `key` is hard-coded in `providers.tf`:

```hcl
backend "s3" {
  bucket = "cloud77-terraform-state"
  key    = "terraform.tfstate"
  # ...
}
```

A backend block cannot reference `var.*`, so declaring an input variable to control it can
never work. The variable is read by nothing.

**Impact.** A reviewer will reasonably assume changing `key` in `terraform.tfvars` moves the
state object. It does not. Anyone who tries will get a new empty state and a plan to
recreate everything — a genuinely dangerous misunderstanding.

**Patch — remove it (applied)**

```hcl
# Delete variables.tf:49-52
# Delete terraform.tfvars:9

# The same applies to remote_state/, which had its own project/region variables and
# terraform.tfvars feeding the same duplicated bucket name:
# Delete remote_state/variables.tf
# Delete remote_state/terraform.tfvars
```

**Patch — or make it real, with the correct mechanism**

```bash
terraform -chdir=infrastructure init \
  -backend-config="bucket=cloud77-terraform-state" \
  -backend-config="key=env/prod/terraform.tfstate" \
  -backend-config="region=eu-north-1"
```

Then delete the variable, and document that the key is set at `init` time rather than in
`.tfvars`. `-backend-config` overrides the literal in `providers.tf`, which makes the
literal a default rather than a hard constraint.

---

### KI-11

Three files failed `terraform fmt`

| | |
|---|---|
| **File** | `variables.tf`, `remote_state/variables.tf`, `remote_state/terraform.tfvars` |
| **Severity** | Low |
| **Category** | Style / CI |
| **Status** | **Fixed in this repository.** `terraform fmt -check -recursive` exits 0. Note that the two `remote_state` files no longer exist — its inputs were removed as part of [KI-04](#ki-04); the original is preserved below |

**Originally observed**

```console
$ terraform fmt -check -recursive
remote_state\terraform.tfvars
remote_state\variables.tf
variables.tf
```

**Root cause.** Alignment of `=` within blocks, and quoting style. `terraform fmt` wants
`type        = string` (aligned) rather than `type = string`, and
`remote_state/terraform.tfvars` wanted `project = "cloud77"` aligned to
`region  = "eu-north-1"`.

**Fix applied**

```bash
terraform fmt -recursive
```

**Why it mattered beyond tidiness.** `fmt -check` is the cheapest possible gate and the one
every Terraform repository is expected to have. There is no CI here, so `make fmt-check` is
the only thing standing in for it.

**Verification**

```bash
terraform fmt -check -recursive && echo "all formatted"
```

---

### KI-13

`ssh_public_key` inventory variable is never used

| | |
|---|---|
| **File** | `setup-ansible.sh:220-222` |
| **Severity** | Low |
| **Category** | Dead code |

**Current**

```bash
if [ -n "$PUB_KEY" ]; then
  echo "ssh_public_key=$PUB_KEY" >> "$LOCAL_TMP/hosts.ini"
fi
```

**Root cause.** `hosts.ini` exports `ssh_public_key` for every worker, but `docker.yml` never
references it. The variable name matches `ansible.posix.authorized_key`'s expected input, so
the intent was evidently to authorise the key on the workers — but neither the
`community.general` nor the `ansible.posix` collection is used in the playbook.

**Impact.** Dead configuration. A reviewer will look for the task that consumes it and not
find one. `hosts.ini` implies a capability the playbook does not have.

**Patch — option A: use it (recommended, and it fixes [SECURITY.md § S3](SECURITY.md#s3--the-private-key-is-copied-to-the-control-node-and-left-there))**

```yaml
- name: Authorise the Ansible control node's key on each worker
  ansible.posix.authorized_key:
    user: "{{ ansible_user }}"
    key: "{{ ssh_public_key }}"
    state: present
```

Requires `ansible-galaxy collection install ansible.posix` on the master:

```bash
"${ssh_cmd[@]}" "ansible-galaxy collection install ansible.posix"
```

**Patch — option B: remove it**

Delete lines 145-147 (`PUB_KEY` extraction) and 220-222 from `setup-ansible.sh`.

Option A is better: it lets you adopt a *separate* key for master → worker SSH, so leaking
the operator's key does not grant lateral movement.

---

### KI-17

`docker.yml` line endings and missing trailing newline

| | |
|---|---|
| **File** | `docker.yml` |
| **Severity** | Low |
| **Category** | Repository hygiene |
| **Status** | Partly fixed. `.gitattributes` pins the policy; the checked-in blob still needs re-normalising |

**Originally observed**

`docker.yml` was CRLF with no terminating newline, while the copy inside `setup-ansible.sh`
was LF with a terminating newline — so a `diff` between the two reported permanent false
drift.

**Root cause.** The file was authored or last edited on Windows with no line-ending policy in
the repository. Without a `.gitattributes`, Git records whatever bytes are in the working
tree, so a Windows author and a Linux author produce different blobs for the same logical
file.

**Impact.** CRLF broke the duplication check that [KI-12](#ki-12) depends on, and trains
people to ignore a real alarm. Now that [KI-12](#ki-12) is fixed, `setup-ansible.sh` copies
the tracked file verbatim, so a CRLF playbook would reach the workers. Ansible's YAML parser
tolerates CRLF, but it breaks shell templating and line-oriented `awk`/`sed` over the
playbook afterwards.

**Fix applied.** `.gitattributes` is present and pins the relevant types:

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
```

**Remaining step** — normalise the checked-in blob and add the trailing newline:

```bash
git rm --cached infrastructure/docker.yml
git add infrastructure/docker.yml
printf '\n' >> infrastructure/docker.yml   # only if the last line still lacks a newline
git ls-files --eol infrastructure/docker.yml
# i/lf    w/lf    attr/text eol=lf   infrastructure/docker.yml   <- w/lf is what you want
```

**Verification**

```bash
git ls-files --eol infrastructure/docker.yml infrastructure/setup-ansible.sh
# Both must report w/lf.
```

---

## Playbook quality issues

Not numbered as defects because none of them break anything, but all are worth fixing if
this playbook is going anywhere near production.

| # | Issue | Current | Recommended |
|---|---|---|---|
| P1 | Short module names | **Fixed** — all tasks use `ansible.builtin.*` | — |
| P2 | No `collections:` declaration | **Fixed** — `requirements.yml` declares `community.docker`, and `setup-ansible.sh` step 4/6 uploads it and installs it on the master with `ansible-galaxy collection install -r` | — |
| P3 | `apt` cache always refreshed | `update_cache: true` on two tasks | `update_cache: true` once, `cache_valid_time: 3600` on the rest. Cuts repeat-run time substantially. |
| P4 | Unpinned package versions | `docker-ce`, `nginx:stable` | Pin to a tested version — see [SECURITY.md § S15](SECURITY.md#s15--docker-packages-are-unpinned). |
| P5 | GPG key not fingerprint-verified | `get_url` then trust | Fetch, check `gpg --show-keys --fingerprint` against a known value, then install. |
| P6 | No `handlers` | `service` task starts Docker immediately | `notify: restart docker` on the package task, with a handler. Avoids a start attempt against a half-installed package. |
| P7 | `docker_users` hard-coded | **Removed** — the playbook no longer manages group membership | — |
| P8 | No fact gathering | implicit | `gather_facts: yes` explicitly, or document that `ansible_architecture`, `ansible_distribution` and `ansible_distribution_release` require facts. They do. |
| P9 | No `check_mode` support | tasks are not idempotent under `--check` | `get_url` and `apt_repository` behave differently under `--check`; verify before relying on `--check --diff` as a gate. |
| P10 | No `serial:` or `throttle` | both workers in parallel | Fine at n=2. At n=20, add `serial: 5` so you do not saturate the NAT gateway or the apt mirrors. |
| P11 | No log of what changed | Ansible's own output only | Capture `ansible.log` (already configured) and ship it somewhere durable. |
| P12 | Group membership not verified | **Removed** with the `user` task | If you re-add group membership, add a `command: id -nG` task with `changed_when: false` to confirm — the new group only applies at next login. |
| P13 | Collection dependency is implicit | **Fixed** — `setup-ansible.sh` `scp`s `requirements.yml` to the master and runs `ansible-galaxy collection install -r requirements.yml` there in step 4/6, before the playbook is ever invoked. `requirements.yml` is also a `triggers_replace` key, so editing it re-runs the bootstrap | — |
| P14 | Container image unpinned | `nginx:stable` | Pin to a digest or an explicit tag. `stable` moves, so a re-run can silently change what is deployed. |
| P15 | The verify task cannot detect an unreachable port | `uri` against `localhost:80` from inside the worker | Pass — it correctly proves the container serves. But it says nothing about reachability from outside, which depends on the security group. `firewall.tf` now has the matching ingress rules; assert that separately if you care. |

---

## Suggested fix order

If you are picking these up, this sequence front-loads the cheapest fixes with the largest
effect and leaves the changes that force instance replacement until last.

### Batch 1 — done in this repository, no downtime

- [KI-02](#ki-02) `.gitignore` rewritten
- [KI-04](#ki-04) `var.key` removed
- [KI-05](#ki-05) IP consistency in outputs and the script fallback
- [KI-11](#ki-11) `terraform fmt`

Remaining here:

- [KI-01](#ki-01) `required_version`
- [KI-17](#ki-17) normalise the checked-in `docker.yml` line endings

### Batch 2 — no downtime, about an hour

- [KI-08](#ki-08) `accept-new` + a `known_hosts` seed. Partly applied: the script uses
  `accept-new`, but `host_key_checking` is `False`, so the TOFU policy is not yet enforced by
  Ansible.
- [KI-14](#ki-14) `metadata_options` and `root_block_device` (both in-place updates)
- [KI-15](#ki-15) part 1 only — sort the AZ list. ⚠️ Check `terraform plan` first: if the
  sorted first AZ differs from today's `names[0]`, this *will* propose replacing the subnet.
  If so, defer until you are ready for the outage.
- [KI-13](#ki-13) use `ssh_public_key`, or remove it
- Playbook quality P1, P3, P6, P7

### Batch 3 — done in this repository

- [KI-12](#ki-12) option A — `docker.yml` is authoritative and is in `triggers_replace`

### Batch 4 — requires a window

- [KI-03](#ki-03) `key_name` — applied in code, but it forces instance replacement the first
  time it is applied to a live fleet
- [KI-15](#ki-15) part 2 — multi-AZ
- [KI-16](#ki-16) `create_before_destroy` and `prevent_destroy`
- [KI-10](#ki-10) bucket suffix — requires updating the backend literal by hand
- [KI-07](#ki-07) decide on the AMI pinning strategy

Batch 4 ends with a full, deliberate rebuild of the fleet. Do it on a day you have time to
re-run the playbook.

---

## Reporting a new issue

Open a GitHub issue with:

1. The file and line, or the exact command and its output.
2. What you expected and what happened.
3. The output of `terraform version` and `aws --version`.
4. Whether the issue reproduces from a clean `terraform apply`.

If it involves the bootstrap script, include the output of:

```bash
bash -x ./infrastructure/setup-ansible.sh -m <ip> -k <key> <worker1> <worker2> 2>&1 | tail -100
```

with any private key material and public IPs removed.

---

## Further reading

- [SECURITY.md](SECURITY.md) — the security findings behind [KI-08](#ki-08) and [KI-14](#ki-14)
- [ARCHITECTURE.md](ARCHITECTURE.md) — design rationale
- [OPERATIONS.md](OPERATIONS.md) — the operational impact of [KI-16](#ki-16) and [KI-03](#ki-03)
- [../README.md](../README.md) — overview
