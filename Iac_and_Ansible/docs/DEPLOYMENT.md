# Deployment Guide

Step-by-step deployment from an empty AWS account to a configured three-node fleet,
with the expected output at every stage and a diagnosis for every failure.

- [Pre-flight](#pre-flight)
- [Phase 0 — Prerequisites](#phase-0--prerequisites)
- [Phase 1 — Bootstrap the state bucket](#phase-1--bootstrap-the-state-bucket)
- [Phase 2 — Configure the root module](#phase-2--configure-the-root-module)
- [Phase 3 — Plan](#phase-3--plan)
- [Phase 4 — Apply](#phase-4--apply)
- [Phase 5 — Configure the workers with Ansible](#phase-5--configure-the-workers-with-ansible)
- [Phase 6 — Verification](#phase-6--verification)
- [Manual invocation of setup-ansible.sh](#manual-invocation-of-setup-ansiblesh)
- [Redeploying / updating](#redeploying--updating)
- [Full teardown](#full-teardown)
- [Failure diagnosis](#failure-diagnosis)

---

## Before you start: where things live

The repository holds **two independent Terraform root modules**:

| Path | Role | State |
|---|---|---|
| `infrastructure/` | The fleet. This is the one you `plan` and `apply`. | remote, S3 backend |
| `remote_state/` | Bootstrap only: creates the state bucket. Run once. | local |

Every command below is written **from the repository root** and targets `infrastructure/`
via `terraform -chdir=infrastructure`. Two consequences worth internalising:

- **Never run bare `terraform apply`.** From the root it would find no configuration and
  complain; from `infrastructure/` it would work. Be explicit with `-chdir` so it does not
  matter where your shell happens to be.
- `remote_state/` is skipped in this guide except in Phase 1 and Full teardown. Those are
  the only two places it is touched.

---

## Pre-flight

Before starting, confirm you can answer "yes" to all of these:

| Check | Command | Expected |
|---|---|---|
| AWS identity resolves | `aws sts get-caller-identity` | JSON with your account ID |
| Identity has EC2 permissions | `aws ec2 describe-vpcs --region eu-north-1` | `Vpcs` array (possibly empty) |
| Identity has S3 permissions | `aws s3 ls | head -1` | No `AccessDenied` |
| Terraform is new enough | `terraform version` | **≥ 1.10** |
| AWS provider cached or downloadable | `terraform init` in `remote_state/` | Provider installed |
| SSH key exists | `ls -l ~/.ssh/id_ed25519{,.pub}` | Both files, private key `0600` |
| Region has the Ubuntu AMI | see below | Non-empty |
| `ssh_cidr` is your **current** IP | `curl -s https://checkip.amazonaws.com` | Matches your `terraform.tfvars` |

Verify the AMI path exists in your chosen region before planning. This is the single most
common "it worked on my machine" failure, because the Canonical SSM parameter tree is
region-specific:

```bash
aws ssm get-parameter \
  --region eu-north-1 \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameter.Value' --output text
```

```text
ami-0e2c8caa4b6378d8c
```

If that returns `ParameterNotFound`, either pick another region or drop the `/ebs-gp3`
segment and the `/hvm` segment per the Canonical parameter tree for that region.

---

## Phase 0 — Prerequisites

### Install the CLI tools

```bash
# Terraform — see https://developer.hashicorp.com/terraform/install
terraform -chdir=infrastructure version

# AWS CLI v2
aws --version
```

### Generate the SSH key pair (skip if you already have one)

```bash
ssh-keygen -t ed25519 -a 100 -C "cloud7-ansible" -f ~/.ssh/id_ed25519
```

```text
Generating public/private ed25519 key pair.
Enter file in which to save the key (/home/you/.ssh/id_ed25519):
Enter passphrase (empty for no passphrase):      ← leave empty, the script cannot answer a prompt
Your identification has been saved to /home/you/.ssh/id_ed25519
Your public key has been saved to /home/you/.ssh/id_ed25519.pub
```

> **Do not set a passphrase.** `setup-ansible.sh` copies the key to a temp directory and
> calls `ssh-keygen -y` non-interactively to validate it. A passphrase-protected key causes
> that check to fail, or causes every subsequent `ssh` to block on a prompt that has no TTY.
> If you require a passphrase, use `ssh-agent` and add `IdentitiesOnly=yes` — but be aware
> the agent is not inherited by `scp` inside the script on all platforms.

### Authenticate to AWS

Prefer one of:

```bash
aws sso login --profile cloud7          # recommended
export AWS_PROFILE=cloud7
```

```bash
aws configure                          # legacy
# or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

Long-lived IAM user keys work but are the wrong choice for anything you publish.

---

## Phase 1 — Bootstrap the state bucket

The root module's backend points at an S3 bucket that must exist before `terraform init`
can succeed. `remote_state/` exists solely to create it.

```bash
cd remote_state
terraform init
```

```text
Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.100.0...
Terraform has been successfully initialized!
```

There is nothing to supply on the command line. `remote_state/` has no variables and no
`.tfvars`; the bucket name (`cloud77-terraform-state`) and region (`eu-north-1`) are literals
in `main.tf`, matching the `backend` block in `providers.tf`. Change both files together or
`terraform init` in the root will fail on a missing bucket. See
[KI-10](KNOWN-ISSUES.md#ki-10).

Confirm the inputs:

```bash
terraform plan
```

```text
Terraform used the selected providers to generate the following execution plan.

  # aws_s3_bucket.tf_state will be created
  + resource "aws_s3_bucket" "tf_state" {
      + arn                          = (known after apply)
      + bucket                       = "cloud77-terraform-state"
      + bucket_domain_name           = (known after apply)
      + force_destroy                = false
      + id                           = (known after apply)
      + tags                         = (known after apply)
    }

  # aws_s3_bucket_versioning.tf_state will be created
  + resource "aws_s3_bucket_versioning" "tf_state" { ... }

  # aws_s3_bucket_server_side_encryption_configuration.tf_state will be created
  + resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" { ... }

  # aws_s3_bucket_public_access_block.tf_state will be created
  + resource "aws_s3_bucket_public_access_block" "tf_state" { ... }

Plan: 4 to add, 0 to change, 0 to destroy.
```

> The bucket name is fixed at `${var.project}-terraform-state`, so two deployments with the
> same `project` value in the same account collide. An unused `random_id.bucket_suffix`
> previously suggested this was handled; it was not, and it has been removed. See
> [KI-10](KNOWN-ISSUES.md#ki-10) for the corrected fix if you want a unique name.

Apply:

```bash
terraform apply -auto-approve
```

```text
aws_s3_bucket.tf_state: Creating...
aws_s3_bucket.tf_state: Creation complete after 3s
aws_s3_bucket_public_access_block.tf_state: Creating...
...

Apply complete! Resources: 5 added, 0 changed, 0 destroyed.

Outputs:

bucket_name = "cloud77-terraform-state"
region      = "eu-north-1"
```

Verify the hardening actually took effect — all four should be `true`/`Enabled`:

```bash
BUCKET=$(terraform output -raw bucket_name)

aws s3api get-public-access-block --bucket "$BUCKET" \
  --query 'PublicAccessBlockConfiguration'

aws s3api get-bucket-versioning --bucket "$BUCKET" --query 'Status'
aws s3api get-bucket-encryption --bucket "$BUCKET" \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm'
```

```text
{
  "BlockPublicAcls": true,
  "BlockPublicPolicy": true,
  "IgnorePublicAcls": true,
  "RestrictPublicBuckets": true
}
"Enabled"
"AES256"
```

**Back up the bootstrap state now.** This module has no backend, so its state lives in
`remote_state/terraform.tfstate`:

```bash
cp remote_state/terraform.tfstate ~/backups/remote_state-$(date +%Y%m%d).tfstate
```

Record `bucket_name`. The root module hard-codes the same string, so if it differs from
`cloud77-terraform-state` you must edit `providers.tf` before continuing.

---

## Phase 2 — Configure the root module

```bash
cd ..
cp infrastructure/terraform.tfvars.example infrastructure/terraform.tfvars
```

```hcl
region             = "eu-north-1"
vpc_cidr           = "10.0.0.0/16"
public_subnet_cidr = "10.0.1.0/24"
instance_type      = "t3.micro"
project            = "Cloud7"
ssh_cidr           = "203.0.113.10/32"   # YOUR current public IP
public_key_file    = "~/.ssh/id_ed25519.pub"
private_key_file   = "~/.ssh/id_ed25519"
ssh_user           = "ubuntu"   # must match the AMI: ubuntu for Canonical, ec2-user for Amazon Linux
```

Discover your current public IP:

```bash
curl -s https://checkip.amazonaws.com
```

> ⚠️ `ssh_cidr` is your **current** IP. If it changes — new ISP, VPN, mobile tethering,
> corporate proxy — every subsequent `setup-ansible.sh` run will fail at step 2 after
> waiting 300 seconds. If you are on a frequently-changing network, widen this to your
> ISP's range temporarily or switch to Session Manager.

Initialise, pointing at the bucket:

```bash
terraform -chdir=infrastructure init
```

```text
Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.100.0...
Terraform has been successfully initialized!
```

> If `terraform init` reports `Backend configuration changed!`, it will ask to copy the
> existing local state into the new backend. Answer **yes** if you have previously applied
> this stack locally; answer **no** if this is a genuinely new bucket.

---

## Phase 3 — Plan

```bash
terraform -chdir=infrastructure plan -out=tfplan
terraform -chdir=infrastructure show tfplan | less
```

A first plan creates **11 managed resources**:

```text
Plan: 11 to add, 0 to change, 0 to destroy.
```

Check specifically:

- `aws_subnet.public.availability_zone` — which AZ did `names[0]` resolve to?
- `aws_instance.*.ami` — which AMI ID did the SSM lookup return?
- `aws_security_group.ec2.ingress[*].cidr_blocks` — is your `/32` correct?
- `aws_key_pair.ansible.key_name` — `Cloud7-ansible` (i.e. `${var.project}-ansible`)
- No unexpected `~ update` or `destroy` lines

```bash
terraform -chdir=infrastructure show -json tfplan | jq '.resource_changes[] | select(.change.actions != ["no-op"]) | {addr, actions: .change.actions}'
```

Save the plan file for a reviewed apply:

```bash
terraform -chdir=infrastructure show tfplan > tfplan.txt   # attach to your PR if you are working through one
```

---

## Phase 4 — Apply

```bash
terraform -chdir=infrastructure apply tfplan
```

Order of events, with the output you should see:

```text
aws_vpc.main: Creating...
aws_vpc.main: Creation complete after 2s
aws_internet_gateway.igw: Creating...
aws_subnet.public: Creating...
aws_route_table.public: Creating...
aws_route_table_association.public: Creating...
aws_security_group.ec2: Creating...
aws_key_pair.ansible: Creating...
aws_instance.master_node: Creating...
aws_instance.worker_node[0]: Creating...
aws_instance.worker_node[1]: Creating...
...
aws_instance.worker_node[1]: Creation complete after 24s
terraform_data.ansible_setup: Creating...
```

Then the bootstrap script takes over the terminal:

```text
==> 1/6 Resolving master, workers and key
    master: 198.51.100.23
    workers: 10.0.1.14 10.0.1.35
    key: /home/you/.ssh/id_ed25519

==> 2/6 Waiting for SSH on the master
    reachable after 1 attempt(s)

==> 3/6 Installing Ansible on the master
    ansible 9.5.0

==> 4/6 Copying the configuration and installing collections
    Starting galaxy collection install process
    Downloading https://galaxy.ansible.com/download/community-docker-<resolved>.tar.gz to ...
    Installing 'community.docker' to '/home/ubuntu/.ansible/collections/ansible_collections'
    community.docker:<resolved> was installed successfully

==> 5/6 Verifying Ansible can reach the workers
==> 6/6 Done
worker-02 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
worker-01 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}

Apply complete! Resources: 11 added, 0 changed, 0 destroyed.

Outputs:

ansible_setup_command = <<EOT
ssh ubuntu@198.51.100.23
cd ~/ansible && ansible-playbook docker.yml
EOT
key_name             = "Cloud7-ansible"
master_public_ip     = "198.51.100.23"
private_key_file     = "~/.ssh/id_ed25519"
worker_private_ips   = [
    "10.0.1.14",
    "10.0.1.35",
]
worker_public_ips = [
    "16.0.0.1",
    "16.0.0.2",
]
```

> `reachable after 1 attempt(s)` means SSH was available immediately. A first boot on
> `t3.micro` frequently needs 2–5 attempts (20–50 s) while `cloud-init` runs. Anything
> beyond ~10 attempts suggests an `ssh_cidr` mismatch, not slowness.

Save the outputs — you will need the master IP for everything that follows:

```bash
terraform -chdir=infrastructure output -raw master_public_ip > .master_ip
MASTER=$(cat .master_ip)
echo "MASTER=$MASTER"
```

---

## Phase 5 — Configure the workers with Ansible

Terraform stopped at the Ansible boundary. Cross it manually:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@$(cat .master_ip)
```

Confirm you are on the control node and the bootstrap landed:

```bash
whoami                    # ubuntu
ansible --version | head -1
ls -la ~/ansible
```

```text
ubuntu@ip-10-0-1-9:~$ ls -la ~/ansible
total 24
drwx------ 2 ubuntu ubuntu 4096 Apr  8 14:22 ansible.cfg
-rw------- 1 ubuntu ubuntu  464 Apr  8 14:22 hosts.ini
-rw-r--r-- 1 ubuntu ubuntu 1790 Apr  8 14:22 docker.yml
-rw-r--r-- 1 ubuntu ubuntu   36 Apr  8 14:22 requirements.yml
-rw------- 1 ubuntu ubuntu  464 Apr  8 14:22 key
-rw-rw---- 1 ubuntu ubuntu  118 Apr  8 14:22 ansible.log
```

Check the inventory:

```bash
cat ~/ansible/hosts.ini
ansible-inventory --list
```

```text
{
    "_meta": { "hostvars": {} },
    "all": { "children": ["ungrouped", "workers"] },
    "workers": {
        "hosts": ["worker-01", "worker-02"],
        "vars": {
            "ansible_become": "true",
            "ansible_ssh_private_key_file": "/home/ubuntu/ansible/key",
            "ansible_user": "ubuntu",
            "ssh_public_key": "ssh-ed25519 AAAA..."
        }
    }
}
```

> Note what is *not* there: the master. `all` resolves to the two workers only. The playbook
> targets the `workers` group explicitly, so it never touches the control node. See
> [KI-09](KNOWN-ISSUES.md#ki-09).

Reachability check:

```bash
cd ~/ansible
ansible all -m ping
```

Dry run before touching anything:

```bash
ansible-playbook docker.yml --check --diff
```

Expect `ok` / `changed` in roughly this shape — eight tasks per worker, and no errors:

```text
worker-02                  | ok: [ubuntu@10.0.1.35]
worker-01                  | ok: [ubuntu@10.0.1.14]

TASK [Install prerequisites] ***********************************************
ok: [worker-01]
ok: [worker-02]

TASK [Ensure apt keyrings directory exists] *********************************
ok: [worker-01]
ok: [worker-02]

TASK [Add Docker GPG key] **************************************************
changed: [worker-01]
changed: [worker-02]

TASK [Add Docker apt repository] *******************************************
changed: [worker-01]
changed: [worker-02]

TASK [Install Docker Engine and the Python Docker SDK] *********************
changed: [worker-01]
changed: [worker-02]

TASK [Enable and start Docker] *********************************************
changed: [worker-01]
changed: [worker-02]

TASK [Run nginx container on port 80] **************************************
changed: [worker-01]
changed: [worker-02]

TASK [Verify nginx responds on port 80] *************************************
ok: [worker-01]
ok: [worker-02]

PLAY RECAP *****************************************************************
worker-01  : ok=9   changed=7   unreachable=0    failed=0
worker-02  : ok=9   changed=7   unreachable=0    failed=0
```

The exact counts depend on your starting state — a worker that already has Docker reports
fewer changes. What matters is `failed=0` and `unreachable=0`.

> The final task checks `http://localhost:80` **from inside the worker**. It proves the
> container serves; it does **not** prove the port is reachable from outside, which depends on
> the security group. See [KI-18](KNOWN-ISSUES.md#ki-18).

Apply:

```bash
ansible-playbook docker.yml
```

Then confirm idempotency — this is the real test of an Ansible playbook:

```bash
ansible-playbook docker.yml
```

```text
PLAY RECAP *****************************************************************
worker-01  : ok=9   changed=0   unreachable=0    failed=0
worker-02  : ok=9   changed=0   unreachable=0    failed=0
```

> `Run nginx container` uses `pull: true`, so it is **not** strictly idempotent: a newer
> `nginx:stable` digest upstream will report `changed` on a re-run. Pin the image if you need
> a guaranteed `changed=0` — see [P14](KNOWN-ISSUES.md#playbook-quality-issues).

`changed=0` on the second run is the property that distinguishes declarative
configuration from the Bash stage, which simply re-does everything every time.

---

## Phase 6 — Verification

### On the master

```bash
# Docker present and running on both workers
ansible all -m shell -a "systemctl is-active docker"
# active
# active

ansible all -m shell -a "docker --version"
# Docker version 27.5.1, build 41578d5
# Docker version 27.5.1, build 41578d5

# the nginx container is running and published
ansible all -m shell -a "docker ps --filter name=nginx --format '{{.Names}} {{.Status}} {{.Ports}}'"
# nginx Up 2 minutes 0.0.0.0:80->80/tcp

# enabled at boot
ansible all -m shell -a "systemctl is-enabled docker"
# enabled
# enabled

# compose plugin present (Buildx is NOT installed by this playbook)
ansible all -m shell -a "docker compose version"
# Docker Compose version v2.x.x
```

### From the operator machine

```bash
MASTER=$(cat .master_ip)

# master is reachable
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'uptime'

# Workers ARE directly reachable over SSH from your /32 (shared security group),
# but Ansible via the master is the intended path. Test the intended one:
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER \
  'ansible all -b -m shell -a "hostnamectl --static"'

# nginx is reachable from your IP — this is the check the playbook cannot do for you.
# Requires port 80 ingress in ssh_cidr. See KI-18.
WORKER=$(ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER \
  'cd ~/ansible && ansible worker-01 -m shell -a "echo {{ ansible_default_ipv4.address }}" -o')
curl -sS "http://$WORKER" | head -1
# <!DOCTYPE html>
```

### Terraform is converged

```bash
terraform -chdir=infrastructure plan
```

```text
No changes. Your infrastructure matches the configuration.
```

> ⚠️ A **no-op** plan depends on the AMI SSM parameter still resolving to the same AMI ID.
> When Canonical publishes a new 24.04 build, `terraform plan` will propose replacing all
> three instances. That is [KI-07](KNOWN-ISSUES.md#ki-07) manifesting, not a bug in your
> configuration.

---

## Manual invocation of `setup-ansible.sh`

The script is usable standalone. This is useful when you want to re-push configuration to
the master without touching Terraform state.

```bash
cd /path/to/repo

# Explicit — preferred
bash ./infrastructure/setup-ansible.sh \
  -m 198.51.100.23 \
  -u ubuntu \
  -k ~/.ssh/id_ed25519 \
  10.0.1.14 10.0.1.35

# Implicit — reads terraform output -json, needs terraform + python3 on PATH
bash ./infrastructure/setup-ansible.sh

# From a Windows workstation under Git Bash / WSL
bash ./infrastructure/setup-ansible.sh -m 198.51.100.23 -k /mnt/c/Users/you/.ssh/id_ed25519 10.0.1.14 10.0.1.35

# Help
bash ./infrastructure/setup-ansible.sh -h
```

### Options

| Flag | Meaning | Default |
|---|---|---|
| `-m IP` | Master node IP | `terraform output master_public_ip` |
| `-k FILE` | SSH private key | `terraform output private_key_file` |
| `-K BASE64` | Base64-encoded key **path** (Windows `local-exec` workaround) | — |
| `-u USER` | SSH user on the nodes | `ubuntu` |
| `-t DIR` | Terraform directory to read outputs from | script's own directory |
| `-h` | Help | — |

Positional arguments after the flags are worker IPs, space-separated.

### Environment variable equivalents

All flags have env-var fallbacks: `MASTER_IP` / `ANSIBLE_MASTER_IP`, `SSH_USER` /
`ANSIBLE_SSH_USER`, `KEY_FILE` / `ANSIBLE_SSH_KEY`, and `ANSIBLE_WORKER_IPS`
(space-separated). Precedence is **flag → env var → Terraform output**.

### How the script cleans up after itself

The private key is copied to `mktemp -d` (mode `700`), the copy is `chmod 600`, and an
`EXIT` trap removes the directory. The original key is never modified. There is currently
**no** cleanup of the copy left on the *master* at `~/ansible/key` — that persists by
design, since Ansible needs it on every run. See
[OPERATIONS.md § Rotating the SSH key](OPERATIONS.md#rotating-the-ssh-key).

---

## Redeploying / updating

### Change only worker count

```bash
# edit count = 2 -> count = 3 in compute.tf
terraform -chdir=infrastructure plan      # shows 1 to add
terraform -chdir=infrastructure apply     # new worker created, script re-runs, inventory now has worker-03
```

Verify on the master:

```bash
ansible-inventory --list | jq '.workers.hosts'
# ["worker-01", "worker-02", "worker-03"]
ansible-playbook docker.yml
```

### Change the playbook

`docker.yml` is a single tracked file. `setup-ansible.sh` `cp`s it to the master, and
`filesha256(docker.yml)` is a `triggers_replace` key, so editing it and running
`terraform apply` re-runs the bootstrap and pushes the new copy:

```bash
vim infrastructure/docker.yml
terraform -chdir=infrastructure plan      # expect terraform_data.ansible_setup to be replaced
terraform -chdir=infrastructure apply
```

That re-copies the playbook but does not **run** it. Stage 3 is still manual:

```bash
ssh ubuntu@$(cat .master_ip) 'cd ~/ansible && ansible-playbook docker.yml'
```

…or push and run in one step, without touching Terraform:

```bash
scp infrastructure/docker.yml ubuntu@$(cat .master_ip):~/ansible/docker.yml
ssh ubuntu@$(cat .master_ip) 'cd ~/ansible && ansible-playbook docker.yml'
```

### Change `instance_type`

```bash
terraform -chdir=infrastructure plan     # 3 to replace — this destroys the running nodes
terraform -chdir=infrastructure apply    # ~2 min outage, script re-runs, then re-run the playbook
```

### Change `ssh_cidr` (e.g. your IP moved)

```bash
vim infrastructure/terraform.tfvars
terraform -chdir=infrastructure apply
```

The security group updates immediately. You do **not** need to replace instances — the SG
change is in-place. Then re-run the playbook if you were disconnected mid-session.

---

## Full teardown

Two `destroy` runs are required, in this order — plus one `apply` in between to empty the
bucket.

### 1. Destroy the fleet

```bash
terraform -chdir=infrastructure destroy
```

```text
terraform_data.ansible_setup: Destroying... [id=terraform_data.ansible_setup]
aws_instance.worker_node[1]: Destroying... [id=i-0abc...]
aws_instance.worker_node[0]: Destroying... [id=i-0def...]
aws_instance.master_node: Destroying... [id=i-0ghi...]
...
Destroy complete! Resources: 11 destroyed.
```

> The S3 state bucket is **not** destroyed, because it is the backend. It survives
> deliberately. It also now contains a `terraform.tfstate` for a stack that no longer
> exists, and it bills a few cents per month.

### 2. Destroy the state bucket (optional)

Only if you want a clean slate. The bucket ships with `force_destroy = false`, so `destroy`
fails with `BucketNotEmpty` while it still holds state objects. Flipping the flag is the
whole procedure — **no AWS CLI, no manual version purge**:

```bash
# 1. remote_state/main.tf:  force_destroy = false  →  true
# 2. Record the flag. Deletes nothing; this is just where you watch the change.
terraform -chdir=remote_state apply -auto-approve
# 3. The provider purges every object version and delete marker, then deletes the bucket.
terraform -chdir=remote_state destroy -auto-approve
# 4. remote_state/main.tf:  back to force_destroy = false
```

> Step 2 is not the purge. It writes the flag to state so that step 3 plans as a pure
> deletion. The emptying happens *inside* the destroy, in the provider's delete call.
>
> **This deletes all state history, permanently and with no undo.** Versioning is what you
> would normally roll back with, and step 3 deletes it too. Do not run it unless you are
> certain the fleet from step 1 is really being retired.
>
> To deploy again afterwards, re-run the bootstrap first — `terraform -chdir=infrastructure`
> fails with `NoSuchBucket` until the bucket exists again. See [Phase 1](#phase-1--bootstrap-the-state-bucket).

### 3. Tidy up

```bash
rm -f .master_ip
rm -f infrastructure/tfplan infrastructure/tfplan.txt
```

Confirm nothing leaked:

```bash
aws ec2 describe-vpcs --filters "Name=tag:Name,Name=Cloud7-vpc" \
  --query 'Vpcs[].VpcId' --output text
# (empty)

aws ec2 describe-security-groups --filters "Name=group-name,Values=Cloud7-sg" \
  --query 'SecurityGroups[].GroupId' --output text
# (empty)

aws ec2 describe-key-pairs --query 'KeyPairs[?KeyName==`Cloud7-ansible`].KeyName' --output text
# (empty)
```

**Local-only leftovers:** the S3 backend's cached configuration in `infrastructure/.terraform/`
remains and still points at the deleted bucket — `terraform -chdir=infrastructure` fails with
`NoSuchBucket` until the bootstrap is re-run. `remote_state/terraform.tfstate` also remains,
now empty. Both are git-ignored. See [KI-06](KNOWN-ISSUES.md#ki-06) for why the bootstrap
state matters.

---

## Failure diagnosis

| Symptom | Likely cause | Fix |
|---|---|---|
| `Backend configuration changed!` on init | Bucket name/key/region changed | Answer `yes` to migrate local state, or fix the mismatch |
| `No valid credential sources found` | No AWS identity | `aws sso login` / `aws configure` |
| `InvalidParameterValue: The value of a parameter must be a valid ARN` | AMI SSM path wrong for the region | Re-run the `get-parameter` check from Pre-flight |
| `Error: Invalid function argument` on `file(var.public_key_file)` | Key missing, or `~` not expanded | `ls -l ~/.ssh/id_ed25519.pub`; confirm the variable |
| `Error acquiring the state lock` | Another apply is running, or a stale lock | Wait, or check for a leftover `.tflock` in the bucket |
| Script hangs ~300 s at `2/6` then errors | `ssh_cidr` ≠ your current IP | Update `ssh_cidr`, `terraform apply`, retry |
| `ERROR: private key '...' not found` | `~` or Windows path not resolvable | Pass `-k` with an explicit path; see `resolve_key()` |
| `ERROR: OpenSSH refuses to use the key copy` | Key is passphrase-protected | Use an unencrypted key, or load it into `ssh-agent` |
| Script step 3 fails on `apt-get install ansible` | `universe` repo disabled, or no egress | Check `apt-cache policy ansible` on the master |
| `ansible all -m ping` shows `UNREACHABLE` | SG intra-VPC rule wrong, or worker IPs stale | Confirm `vpc_cidr` covers the subnet; re-run the script |
| Playbook fails on `Add Docker apt repository` | Malformed `repo:` line, or clock skew | Verify `date -u` on the worker; test the URL with `curl` |
| Playbook `changed=0` on first run | Docker already installed (e.g. a rebuilt AMI) | Expected; not an error |
| `terraform plan` proposes replacing all instances | AMI SSM parameter moved | Pin the AMI, or accept and apply |
| `terraform plan` proposes replacing the subnet | AZ ordering changed | Sort the AZ list; see [KI-15](KNOWN-ISSUES.md#ki-15) |
| Second `apply` re-runs the script unexpectedly | A worker private IP changed | Expected; `triggers_replace` is working |

### Getting more detail from the script

The script is `set -euo pipefail`, so it aborts on the first failure. To debug:

```bash
bash -x ./infrastructure/setup-ansible.sh -m <ip> -k ~/.ssh/id_ed25519 10.0.1.14 10.0.1.35 2>&1 | tee /tmp/bootstrap.log
```

To see exactly what Ansible did on the master:

```bash
ssh ubuntu@$(cat .master_ip)
tail -100 ~/ansible/ansible.log
```

To see the instance's own boot log:

```bash
aws ec2 get-console-output --instance-id i-0abc... --region eu-north-1 \
  --output text | tail -40
```

---

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — why each resource exists
- [OPERATIONS.md](OPERATIONS.md) — day-two operations
- [SECURITY.md](SECURITY.md) — threat model
- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — every defect referenced above
- [../README.md](../README.md) — overview
