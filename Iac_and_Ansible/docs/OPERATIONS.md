# Operations Runbook

Day-two procedures for operating, scaling, rotating and destroying this stack.

- [Daily health check](#daily-health-check)
- [Configuration drift](#configuration-drift)
- [Scaling the fleet](#scaling-the-fleet)
- [Rotating the SSH key](#rotating-the-ssh-key)
- [Rebuilding a single node](#rebuilding-a-single-node)
- [State management](#state-management)
- [Backups](#backups)
- [Upgrading Terraform](#upgrading-terraform)
- [Upgrading the AWS provider](#upgrading-the-aws-provider)
- [Patching the nodes](#patching-the-nodes)
- [Log locations](#log-locations)
- [Teardown](#teardown)
- [Emergency procedures](#emergency-procedures)
- [Routine maintenance calendar](#routine-maintenance-calendar)

---

## Daily health check

Ninety seconds. Run from the operator machine.

```bash
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)

# 1. Terraform agrees with reality
terraform -chdir=infrastructure plan | tail -3
# Expect: No changes.

# 2. All three instances are running
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
            "Name=tag:Name,Name=Cloud7-*" \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# 3. Docker is healthy on both workers, via the control node
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER \
  'cd ~/ansible && ansible all -m shell -a "systemctl is-active docker && docker --version"'

# 4. No unexpected Ansible failures in the log
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'grep -c FAILED ~/ansible/ansible.log'
```

### What "healthy" means

| Signal | Healthy | Investigate if |
|---|---|---|
| `terraform plan` | `No changes.` | Any `~ update` or `-/+ replace` on instances |
| Instance count | 3 `running` | Fewer than 3, or any `pending`/`stopped` |
| SSH to master | Connects within 2 s | Timeout |
| `ansible all -m ping` | 2 × `SUCCESS` | Any `UNREACHABLE` |
| `systemctl is-active docker` | `active` ×2 | `inactive` or `failed` |
| `grep -c FAILED ansible.log` | 0 | Non-zero and recent |

### Day-2 mental model

Three things to internalise before reading the rest of this runbook:

1. **The master is the only supported entry point.** All three instances share one security
   group, so the firewall *permits* direct SSH from your IP to the workers as well as the
   master. That is a consequence of the shared SG, not an intended workflow. Treat the
   master as the only way in, and reach workers from there.
2. **`~/ansible/key` on the master is a fleet-wide credential, not a worker-only one.** It is
   a byte-for-byte copy of *your* key, and the same public key is installed on all three
   instances, all of which accept port 22 from your `/32`. Anything that reads that file —
   including a malicious Ansible collection — gets SSH to the whole fleet, not just to the
   workers. Full analysis in
   [SECURITY.md § S3](SECURITY.md#s3--the-private-key-is-copied-to-the-control-node-and-left-there).
3. **Master compromise is fleet compromise.** There is no lateral-movement containment
   between the nodes. This is inherent to the jump-host design and is why the key's removal
   procedure below matters for a long-lived master.

---

## Configuration drift

### Detecting it

```bash
terraform -chdir=infrastructure plan -detailed-exitcode
```

| Exit code | Meaning | Action |
|---|---|---|
| `0` | No changes | None |
| `1` | Error | Read the error |
| `2` | **Changes present** | Triage before applying |

Triage by change type:

| Plan line | Meaning | Usually safe? |
|---|---|---|
| `~ update in place` | A mutable property drifted | ✅ Yes, apply |
| `-/+ replace` on `aws_instance` | AMI, subnet or type changed | ⚠️ Destroys the node |
| `-/+ replace` on `aws_subnet` | AZ ordering or CIDR changed | ⚠️ Cascades to all instances |
| `- destroy` | Something was deleted manually | ❌ Recreate, or decide you want it gone |

### Reconciling manual changes

Someone changed something in the console. Pick a side:

**Terraform wins** — delete the console change by re-applying:

```bash
terraform -chdir=infrastructure apply -auto-approve
```

**Console wins** — bring that intent into HCL, commit it, then re-plan:

```bash
# 1. Edit the .tf file to match reality
# 2. terraform plan   → should now be a no-op
# 3. terraform apply   → records the current state without changes
```

Never leave Terraform and reality disagreeing. The longer the drift persists, the more
likely the next `apply` produces an outage you did not intend.

### Drift you should ignore

- Changes to the AWS **default security group** — Terraform does not manage it.
- Ubuntu's own unattended-upgrades installing packages — invisible to Terraform, expected.
- `~/.ssh/authorized_keys` on the nodes — managed outside Terraform by design.

---

## Scaling the fleet

### Add workers

```bash
# compute.tf: count = 2  →  count = 4
terraform -chdir=infrastructure plan
terraform -chdir=infrastructure apply
```

What happens automatically:

1. Two instances are created in parallel.
2. `terraform_data.ansible_setup` sees `worker_ips` change and re-runs.
3. The script regenerates `~/ansible/hosts.ini` with `worker-03` and `worker-04`.

What you must still do by hand:

```bash
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'cd ~/ansible && ansible-playbook docker.yml'
```

Verify:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER \
  'cd ~/ansible && ansible-inventory --list | jq -r ".workers.hosts[]"'
```

> Worker names come from `count.index + 1`, which means removing an element from the middle
> of the count is not a supported operation — you cannot remove `worker-02` while keeping
> `worker-03`. Scale at the tail, or accept that names will be reassigned to different
> physical instances.

### Scale to zero workers

```bash
# count = 2  →  count = 0
terraform -chdir=infrastructure apply
```

The master survives and keeps its inventory, but `ansible all -m ping` will match nothing
and the playbook will report `skipping: no hosts matched`. That is expected, not an error.

---

## Rotating the SSH key

The private key exists in **three** places. All three must be replaced together or the
stack breaks.

| Location | Purpose | Replaced by |
|---|---|---|
| `~/.ssh/id_ed25519` (+ `.pub`) | Operator machine | You |
| EC2 key pair `Cloud7-ansible` (`${var.project}-ansible`) | Injected into instances by the cloud-init/AMI agent | Terraform, on `key_name` change |
| `~/ansible/key` on the master | Used by Ansible to reach workers | `setup-ansible.sh` |

### Procedure

```bash
# 1. Generate the new key
ssh-keygen -t ed25519 -a 100 -C "cloud7-ansible-$(date +%Y%m%d)" -f ~/.ssh/id_ed25519_new

# 2. Point Terraform at the new key
#    terraform.tfvars:
#      public_key_file  = "~/.ssh/id_ed25519_new.pub"
#      private_key_file = "~/.ssh/id_ed25519_new"

# 3. Change the key pair name so Terraform replaces it rather than trying to mutate it.
#    firewall.tf:
#      key_name = "Cloud7-ansible-2026q1"

terraform -chdir=infrastructure plan
```

Expect the key pair to be replaced and **all three instances to be replaced**, because
`key_name` on `aws_instance` is a force-new attribute. There is no way to rotate an EC2 key
pair without recreating the instances.

```bash
terraform -chdir=infrastructure apply          # ~2 minutes, three nodes down

# 4. The bootstrap re-runs automatically (master_ip and worker_ips both change),
#    which pushes the new private key to the master.
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)

# 5. Re-run the playbook
ssh -i ~/.ssh/id_ed25519_new ubuntu@$MASTER 'cd ~/ansible && ansible-playbook docker.yml'

# 6. Remove the old key from your agent and disk
ssh-add -d ~/.ssh/id_ed25519
rm ~/.ssh/id_ed25519{,.pub}
ssh-keygen -i -f ~/.ssh/id_ed25519_new.pub > ~/.ssh/id_ed25519.pub
```

### Emergency rotation (suspected key compromise)

Assume the old key is burned and act in this order:

```bash
# 1. Immediately cut off the old access path — revoke SSH from your IP is not enough
#    if the key itself leaked. Change the SG first:
#    terraform.tfvars: ssh_cidr = "203.0.113.99/32"   (a trusted IP, or none at all)
terraform -chdir=infrastructure apply

# 2. Now rotate the key as above.
```

If you need to lock yourself out on purpose, set `ssh_cidr` to an address you do not
control. The instances stay up, SSH stops working, and you regain access by setting it back
— useful for containing an incident while the key is replaced.

### Removing the bootstrap key from the master

Optional, and worth doing on any master you intend to keep for more than a few days. The
key at `~/ansible/key` is a copy of your own key and is valid against all three nodes (see
[Day-2 mental model](#day-2-mental-model)), so it is the highest-value file on the instance.

```bash
# Check what is actually there first
ssh ubuntu@$MASTER 'ls -l ~/ansible/'

# Remove it. shred is not worth the trouble here: on ext4 with journaling, on overlayfs,
# and on any copy-on-write filesystem, shred does not reliably destroy the old blocks.
# rm is sufficient.
ssh ubuntu@$MASTER 'rm -f ~/ansible/key && echo removed'
```

**What breaks.** Stage 3 only. `ansible-playbook docker.yml` now fails to connect, because
`hosts.ini` still points `ansible_ssh_private_key_file` at the file you just deleted:

```
UNREACHABLE! => {"msg": "Failed to connect to the host via ssh: ... Permission denied ..."}
```

Nothing else is affected. Terraform still works, the master is still reachable with your
laptop key, and Docker on the workers keeps running — the key was only ever needed to *reach*
the workers, not to keep them alive.

**How to get it back.** Re-push the key without a full bootstrap run:

```bash
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)
scp -i ~/.ssh/id_ed25519 ~/.ssh/id_ed25519 ubuntu@$MASTER:~/ansible/key
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'chmod 600 ~/ansible/key'
```

Or let Terraform do it, which also re-runs the rest of the bootstrap:

```bash
terraform -chdir=infrastructure apply -replace=terraform_data.ansible_setup
```

**Do not delete it and forget.** The most common mistake is removing the key, needing to
re-run the playbook weeks later during an incident, and having to hunt for a private key.
Leave a note in your own runbook, or simply remove it as part of teardown instead.

### Cleaning up after a rotation

The planned rotation above replaces all three instances, so the old copy of the key is
destroyed along with them and there is nothing extra to clean. Two cases do leave a stale
copy behind:

- **An instance that outlived the rotation.** If you stopped, orphaned, or manually
  re-created a node outside Terraform, it may still hold the old key in its
  `~/.ssh/authorized_keys` and possibly in `~/ansible/key`. Terminate it rather than trying
  to scrub it.
- **A snapshot or AMI** taken before the rotation contains the old `authorized_keys`
  entry. Delete old snapshots once you are past the point of needing to roll back.

Verify nothing unexpected still accepts the old key:

```bash
aws ec2 describe-key-pairs --key-names Cloud7-ansible-2026q1   # the old pair should be gone
```

---

## Rebuilding a single node

### Rebuild a worker

```bash
# Target one index
terraform -chdir=infrastructure apply -replace='aws_instance.worker_node[0]'
```

Then:

1. The worker's private IP changes.
2. `triggers_replace.worker_ips` fires → `setup-ansible.sh` re-runs → inventory updated.
3. Docker is **not** reinstalled automatically — Stage 3 is manual:

```bash
ssh ubuntu@$(terraform -chdir=infrastructure output -raw master_public_ip) \
  'cd ~/ansible && ansible-playbook docker.yml'
```

### Rebuild the master

```bash
terraform -chdir=infrastructure apply -replace=aws_instance.master_node
```

This is destructive to your control plane: the new master has an empty `~/ansible`, no
private key and no inventory. The bootstrap re-runs and repopulates all of it, so recovery
is automatic — but only if `setup-ansible.sh` can reach the new master, which requires
`ssh_cidr` to still be correct.

```bash
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'cd ~/ansible && ansible-playbook docker.yml'
```

### Force the bootstrap to re-run without changing anything

```bash
terraform -chdir=infrastructure apply -replace=terraform_data.ansible_setup
```

Useful after editing `setup-ansible.sh`, or when you suspect the master's `~/ansible`
directory has drifted from the script's output.

---

## State management

### Where state lives

```bash
terraform -chdir=infrastructure state list          # 11 resources
aws s3 cp s3://cloud77-terraform-state/terraform.tfstate /tmp/state-backup.json
```

Enable versioning on the bucket if it is not already (the `remote_state` module does this,
but verify):

```bash
aws s3api get-bucket-versioning --bucket cloud77-terraform-state --query Status
```

### Inspect state without changing it

```bash
terraform -chdir=infrastructure show
terraform -chdir=infrastructure show -json | jq '.values.root_module.resources[] | {addr, type}'
terraform -chdir=infrastructure state show aws_instance.master_node
terraform -chdir=infrastructure state show -no-sensitive aws_instance.master_node
```

### Recover a specific state version

S3 versioning is the recovery mechanism. List versions:

```bash
aws s3api list-object-versions \
  --bucket cloud77-terraform-state \
  --prefix terraform.tfstate \
  --query 'Versions[].[VersionId,LastModified,IsLatest]' --output table
```

Roll back:

```bash
# 1. Preserve the current state first — never skip this
aws s3 cp s3://cloud77-terraform-state/terraform.tfstate \
  s3://cloud77-terraform-state/terraform.tfstate.before-rollback

# 2. Restore the good version
aws s3api list-object-versions --bucket cloud77-terraform-state \
  --prefix terraform.tfstate --query 'Versions[?IsLatest==`false`].VersionId|[0]'

aws s3api get-object --bucket cloud77-terraform-state \
  --key terraform.tfstate --version-id <VERSION_ID> /tmp/restored.tfstate

# 3. Overwrite the live state
aws s3 cp /tmp/restored.tfstate s3://cloud77-terraform-state/terraform.tfstate

# 4. Re-init so the local cache matches
terraform -chdir=infrastructure init -reconfigure
terraform -chdir=infrastructure plan
```

> ⚠️ `terraform init -reconfigure` discards the local backend cache. Do **not** use
> `-migrate-state` here; you have just replaced the authoritative object.

### Import an existing stack into this state

If you created the resources by hand or lost your state:

```bash
terraform -chdir=infrastructure import aws_vpc.main vpc-0abc123
terraform -chdir=infrastructure import aws_internet_gateway.igw igw-0abc123
terraform -chdir=infrastructure import aws_subnet.public subnet-0abc123
terraform -chdir=infrastructure import aws_route_table.public rtb-0abc123
terraform -chdir=infrastructure import aws_route_table_association.public rtbassoc-0abc123
terraform -chdir=infrastructure import aws_security_group.ec2 sg-0abc123
terraform -chdir=infrastructure import aws_key_pair.ansible Cloud7-ansible
terraform -chdir=infrastructure import aws_instance.master_node i-0abc123
terraform -chdir=infrastructure import 'aws_instance.worker_node[0]' i-0def456
terraform -chdir=infrastructure import 'aws_instance.worker_node[1]' i-0ghi789
terraform -chdir=infrastructure import terraform_data.ansible_setup terraform_data.ansible_setup
```

Find the IDs:

```bash
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=Cloud7-vpc" \
  --query 'Vpcs[].[VpcId,SubnetIds]' --output table
```

`terraform_data` has no real ID, so import it with any string or skip it — a `plan` will
show it as needing replacement, which is harmless because re-running the bootstrap is
idempotent from Terraform's point of view.

### Moved blocks destroy and recreate — use `moved` blocks

If you ever rename or move a resource between files (Terraform does not care about files,
only addresses), add a `moved` block instead of letting Terraform propose replacement:

```hcl
moved {
  from = aws_instance.worker
  to   = aws_instance.worker_node
}
```

Without it, Terraform will destroy and recreate the instance because the address changed.

### Workspaces

The backend is a single flat key with no `workspace_key_prefix` set, so Terraform uses the
default `env:` prefix:

```bash
terraform -chdir=infrastructure workspace new staging     # → s3://cloud77-terraform-state/env:/staging/terraform.tfstate
terraform -chdir=infrastructure workspace list
```

Nothing in this configuration is environment-aware — there is no per-env `instance_type` or
CIDR — so a workspace is only useful for running a genuinely separate, second fleet. For
real environment separation, restructure the state key instead. See
[ARCHITECTURE.md § providers.tf](ARCHITECTURE.md#providerstf--backend-and-provider).

---

## Backups

| What | Where | Backup command | Priority |
|---|---|---|---|
| Fleet state | S3 bucket, versioned | Automatic | Low — versioning is the backup |
| Bootstrap state | `remote_state/terraform.tfstate`, local | `cp` to private storage | **High** — [KI-06](KNOWN-ISSUES.md#ki-06) |
| `terraform.tfvars` | Local only, git-ignored | Store in a password manager | **High** — losing `ssh_cidr` is painful but recoverable; losing `instance_type` etc. is not |
| Private SSH key | `~/.ssh/id_ed25519` | `ssh-agent` + offline copy | **Critical** — without it you cannot SSH in |
| `setup-ansible.sh` | Git | N/A | Low |
| Ubuntu AMI | Canonical, public | N/A | None |

**Nothing in this stack contains data worth backing up** — no databases, no volumes with
state. The only irreplaceable artefact is the SSH private key. Treat losing it as a full
redeploy, which costs about ten minutes.

Recommended local backup script:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$HOME/backups/cloud7/$STAMP"
mkdir -p "$DEST"

cp remote_state/terraform.tfstate "$DEST/" 2>/dev/null || true
cp infrastructure/terraform.tfvars "$DEST/" 2>/dev/null || true
aws s3 cp s3://cloud77-terraform-state/terraform.tfstate "$DEST/terraform.tfstate.json"

aws s3 rm "s3://cloud77-terraform-state/backups/$STAMP/" --recursive 2>/dev/null || true
aws s3 cp "$DEST" "s3://cloud77-terraform-state/backups/$STAMP/" --recursive

echo "backed up to s3://cloud77-terraform-state/backups/$STAMP/"
```

> Note: storing `terraform.tfvars` backups inside the same bucket holds your `ssh_cidr`.
> Keep that bucket private (the `remote_state` module enforces this) and prefer a password
> manager.

---

## Upgrading Terraform

```bash
terraform -chdir=infrastructure version           # current
# check latest: https://developer.hashicorp.com/terraform/install

# Linux/macOS — package manager or direct download
# Windows — winget install Hashicorp.Terraform

terraform -chdir=infrastructure init -upgrade    # re-resolves providers within the existing constraint
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure plan             # review for provider-driven changes
```

Terraform does not use a state file format version you must migrate; state upgrades are
automatic on read and are **one-way**. Downgrading Terraform below the version that wrote
your state may fail. Take a state backup first:

```bash
aws s3 cp s3://cloud77-terraform-state/terraform.tfstate ~/backups/tfstate-pre-upgrade.json
```

> Do not upgrade Terraform past 1.10 on this configuration until
> [KI-01](KNOWN-ISSUES.md#ki-01) is fixed — the declared `required_version` currently
> permits versions that cannot parse `use_lockfile`, and Terraform will refuse with a
> message that does not point at the real cause.

---

## Upgrading the AWS provider

The constraint is `~> 5.0`, which permits any 5.x. That is a wide range for a provider with
this many resources, and AWS provider 5.x → 6.x included breaking changes.

```bash
# Pin exactly, upgrade deliberately
terraform -chdir=infrastructure providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64

# Or pin in providers.tf:
#   version = "~> 5.100"

terraform -chdir=infrastructure init -upgrade
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure plan    # look hard at anything touching aws_instance or aws_subnet
```

> ⚠️ `.terraform.lock.hcl` is currently **git-ignored** by the `.*` pattern in `.gitignore`.
> Until [KI-02](KNOWN-ISSUES.md#ki-02) is fixed, every teammate and every CI run resolves
> provider versions independently, which defeats the purpose of a lock file entirely.

---

## Patching the nodes

Nothing in this stack manages OS patching. Ubuntu's `unattended-upgrades` handles security
updates on its own; verify it is active:

```bash
MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)
ssh ubuntu@$MASTER 'ansible all -m shell -a "systemctl is-enabled unattended-upgrades"'
```

Force a check across the fleet:

```bash
ssh ubuntu@$MASTER 'cd ~/ansible && ansible all -b -m apt -a "update_cache=yes"'
ssh ubuntu@$MASTER 'cd ~/ansible && ansible all -b -m apt -a "upgrade=safe"'
```

For repeatable, auditable patching, add a weekly `apt` playbook and run it from a scheduler
rather than by hand — that is the natural Ansible use case this stack demonstrates.

> Note that a `terraform apply` never replaces an instance because of OS patching; patching
> is invisible to Terraform state. This is correct, and it is also why a long-lived instance
> drifts further from the AMI it was created from.

---

## Log locations

| Log | Path | Owner |
|---|---|---|
| Ansible execution log | `~/ansible/ansible.log` on the **master** | Generated by `ansible.cfg` `log_path` |
| cloud-init output | `/var/log/cloud-init-output.log` on each node | Ubuntu |
| Docker daemon log | `journalctl -u docker` on each worker | systemd |
| Terraform apply log | Local terminal, or `TF_LOG=INFO` | You |
| EC2 console output | `aws ec2 get-console-output --instance-id i-…` | AWS |
| S3 access logs | Not enabled on the state bucket | — |

Ansible's log is configured with `retry_files_enabled = False`, so there are no `.retry`
files to clean up.

```bash
# Recent Ansible activity
ssh ubuntu@$MASTER 'tail -100 ~/ansible/ansible.log'

# Just the failures
ssh ubuntu@$MASTER 'grep -n FAILED ~/ansible/ansible.log | tail -20'

# Docker problems on a worker
ssh ubuntu@$MASTER 'cd ~/ansible && ansible worker-01 -b -m shell -a "journalctl -u docker --no-pager -n 50"'
```

---

## Teardown

Destroying this stack is a two-step operation, and the order matters.

```bash
# 1. The fleet — instances, VPC, networking, security group, key pair.
#    The S3 state bucket survives, because it is the backend.
terraform -chdir=infrastructure destroy

# 2. The state bucket — only if you want a clean slate.
#    force_destroy = false means this FAILS with BucketNotEmpty while the bucket
#    still holds state objects. Versioning is enabled, so deleting current
#    objects is not enough: older versions and delete markers keep the bucket
#    non-empty. Setting force_destroy = true makes the provider purge all of
#    them during the destroy itself. No AWS CLI, no manual version purge.
#
#    a. remote_state/main.tf:  force_destroy = false  →  true
terraform -chdir=remote_state apply -auto-approve      # records the flag; deletes nothing
terraform -chdir=remote_state destroy -auto-approve    # purges every version, then deletes the bucket
#
#    b. remote_state/main.tf:  back to force_destroy = false
```

> The `apply` is not the purge — it writes the flag to state so the destroy plans as a pure
> deletion. The emptying happens inside the destroy.
>
> Step 2 **permanently deletes all state history**, versions and delete markers included.
> There is no rollback once the bucket is gone. This is the only irreversible operation in
> the whole runbook that is not recoverable from S3 versioning, because it deletes the
> versioning history itself.
>
> After step 2, `terraform -chdir=infrastructure` fails with `NoSuchBucket` until the bucket
> is recreated by the bootstrap in [Phase 1](DEPLOYMENT.md#phase-1--bootstrap-the-state-bucket).

Confirm nothing leaked, then tidy up locally:

```bash
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=Cloud7-vpc" \
  --query 'Vpcs[].VpcId' --output text     # expect empty
rm -f .master_ip
rm -f infrastructure/tfplan infrastructure/tfplan.txt
```

> ⚠️ **Before you destroy:** read [COST.md](COST.md). A running fleet costs approximately
> $42/month and many reviewers will deploy this to look at it. Destroying the state bucket
> deletes all state versions — the only recovery path is the S3 versioning history, which
> you are about to empty.

Full procedure with expected output and verification queries:
[DEPLOYMENT.md § Full teardown](DEPLOYMENT.md#full-teardown).

---

## Emergency procedures

### I locked myself out

`ssh_cidr` no longer matches your IP. You still have AWS API access, so use it:

```bash
# Option A — temporarily widen to the world (accept the risk, do it briefly)
#   terraform.tfvars: ssh_cidr = "0.0.0.0/0"
#   terraform apply && ssh in && restore your real IP && terraform apply

# Option B — no inbound SSH needed: use SSM if the instance has an instance profile
#   (this stack does not create one — see ARCHITECTURE.md omissions)

# Option C — user_data cannot be changed after launch, but cloud-init can be re-run via
#   EC2 Serial Console / VNC if enabled. It is not enabled here.
```

Option A is the only one available with the current design. This is the single strongest
argument for adding a bastion or Session Manager — see [SECURITY.md](SECURITY.md).

### A node is compromised

```bash
# 1. Cut the network immediately
#    terraform.tfvars: ssh_cidr = "0.0.0.0/0" is wrong here — instead narrow the
#    intra-VPC rule or destroy the node:
terraform -chdir=infrastructure apply -replace='aws_instance.worker_node[0]'

# 2. Preserve evidence before it disappears
aws ec2 create-snapshot --instance-id i-0abc... --region eu-north-1 \
  --snapshot-id "incident-$(date +%Y%m%d)"

# 3. Review what the node could reach
#    It held the private key with which the master reaches every other worker.
#    Treat all three nodes as suspect.

# 4. Rotate the SSH key — see "Rotating the SSH key" above
```

The flat network and shared key mean there is no lateral-movement containment in this
design. That is a deliberate simplification, and it is the reason
[SECURITY.md](SECURITY.md) ranks segmentation as the top remediation.

### Terraform state is corrupted

```bash
aws s3api list-object-versions --bucket cloud77-terraform-state \
  --prefix terraform.tfstate \
  --query 'Versions[].[VersionId,LastModified,IsLatest]' --output table
```

Roll back per [State management](#state-management). If no version is usable, the
nuclear option is to rebuild from HCL: destroy everything in AWS manually, `rm` the state
object, and `terraform apply` fresh. Expect to lose the `Name`-tag-to-instance mapping,
which is cosmetic.

### Apply is stuck on a state lock

```bash
aws s3 rm s3://cloud77-terraform-state/terraform.tfstate.tflock
```

Only do this after confirming no other `terraform` process is actually running. Removing an
active lock is how two applies corrupt state concurrently.

---

## Routine maintenance calendar

| Cadence | Task | Command |
|---|---|---|
| Daily | Health check | See [Daily health check](#daily-health-check) |
| Weekly | `terraform plan` review for drift | `terraform plan -detailed-exitcode` |
| Weekly | Patch check | `ansible all -b -m apt -a "upgrade=safe"` |
| Monthly | Review AMI drift and consider pinning | `terraform plan` |
| Monthly | Verify state versioning still enabled | `aws s3api get-bucket-versioning` |
| Quarterly | Rotate the SSH key | See [Rotating the SSH key](#rotating-the-ssh-key) |
| Quarterly | Re-run `terraform validate` and `fmt` against current tooling | `make validate` |
| Quarterly | Review [KNOWN-ISSUES.md](KNOWN-ISSUES.md) and close what's fixed | — |
| On demand | Destroy if not in use for 30+ days | See [COST.md](COST.md) |

---

## Further reading

- [DEPLOYMENT.md](DEPLOYMENT.md) — initial deployment
- [ARCHITECTURE.md](ARCHITECTURE.md) — design rationale and failure modes
- [SECURITY.md](SECURITY.md) — incident-relevant threat model
- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — defects referenced throughout
- [COST.md](COST.md) — cost optimisation
