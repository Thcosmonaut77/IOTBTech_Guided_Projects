# Cost Model

What this stack costs, why, and where the money actually goes.

> **Prices are estimates.** All figures are AWS public list prices for `eu-north-1` at the
> time of writing and exclude free-tier credits, taxes, and negotiated discounts. Verify
> against the [AWS Price List API](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json)
> or the AWS Pricing Calculator before making a financial decision.

- [Summary](#summary)
- [The surprising part](#the-surprising-part)
- [Line items](#line-items)
- [Cost by runtime](#cost-by-runtime)
- [Optimisation options](#optimisation-options)
- [Cost of the security remediations](#cost-of-the-security-remediations)
- [Cost of mistakes](#cost-of-mistakes)
- [Monitoring](#monitoring)

---

## Summary

| Scenario | Monthly cost |
|---|---|
| Running 24×7 | **≈ $42** |
| Running 8 h/day, weekdays only | ≈ $11 |
| Running 24×7, stopped nightly (12 h/day) | ≈ $21 |
| Idle but allocated (all instances stopped) | ≈ $18 |
| Destroyed | ≈ $0.01 |

---

## The surprising part

**Public IPv4 addresses cost more than the compute does not apply here — but they cost
about 40% as much again.** For three `t3.micro` instances:

```text
Compute (3 × t3.micro)        $28.03/mo   67%
Public IPv4 (3 × $0.005/hr)   $10.95/mo   26%   ← usually forgotten
Storage (3 × 8 GiB gp3)        $2.11/mo    5%
S3 state                       <$1.00/mo   2%
```

Public IPv4 addresses have been billed per-hour since February 2024. This is the single most
common surprise in a small EC2 deployment, and it is why the optimisation section leads
with removing them.

---

## Line items

### Compute — 3 × `t3.micro`

`eu-north-1` on-demand Linux, 2 vCPU / 1 GiB.

| | Rate | Monthly (730 h) |
|---|---|---|
| `t3.micro` | $0.0128 / hr | $9.34 |
| **× 3** | | **$28.03** |

`t3` instances are billed per instance-hour regardless of actual CPU consumption — you are
not paying for unused vCPU. Unlimited bursting can incur a CPU-credit surcharge on
sustained high utilisation; for a Docker-hosting lab this is not a concern, but a
sustained-load workload would move you to `t4g`/`m6g` (and potentially to Savings Plans or
a Reserved Instance for a 1-year commitment at roughly a 40% discount).

### Storage — 3 × 8 GiB `gp3`

Root volumes come from the Ubuntu 24.04 AMI default.

| | Rate | Monthly |
|---|---|---|
| `gp3` | $0.088 / GiB-month | $0.704 |
| **× 3 × 8 GiB** | | **$2.11** |

`gp3` includes 3,000 IOPS and 125 MiB/s throughput in the base price, so no additional
provisioned-IOPS or throughput cost at this size. **Snapshots are not included** — a
snapshot of an 8 GiB volume costs roughly $0.40/month to retain.

### Public IPv4 — 3 addresses

Charged for every address assigned to a running instance, whether or not anything uses it.

| | Rate | Monthly (730 h) |
|---|---|---|
| Public IPv4 | $0.005 / hr | $3.65 |
| **× 3** | | **$10.95** |

All three instances have `associate_public_ip_address = true`, so all three are billed.
This is the line item that surprises people, and the one that the architecture deliberately
accepts for direct SSH access.

### S3 state bucket

| | Rate | Monthly |
|---|---|---|
| Standard storage | $0.0245 / GiB-month | ~$0.001 |
| PUT / GET / LIST | $0.005 per 1,000 | negligible |
| Versioning | no additional charge, old versions billed as storage | negligible |

One `terraform.tfstate` is a few hundred KB. With versioning enabled and a handful of
applies, total state storage is under 50 MB and the bucket costs **fractions of a cent per
month**. It is not worth optimising.

Not charged: the bucket itself, versioning, the S3 lockfile object, or the number of
`terraform apply` runs.

### Free tier

The AWS Free Tier includes 750 hours of `t3.micro` (or `t3.small`) per month across
`us-east-1`. This stack runs in `eu-north-1`, so **the free tier does not apply**. Running in
`us-east-1` would reduce the compute line by up to $9.34/month — at the cost of the region
change rippling through the AMI parameter path and every documented example.

### Data transfer

| Direction | Rate |
|---|---|
| Inbound to EC2 | Free |
| Outbound to internet | $0.09 / GB |
| Cross-AZ within region | $0.01 / GB each way |

Relevant if you add multi-AZ (which [KI-15](KNOWN-ISSUES.md#ki-15) discusses): a control
node in one AZ managing workers in another pays inter-AZ transfer on every Ansible module
execution. For a few KB per run this is pennies, but it scales with playbook size and
frequency.

---

## Cost by runtime

`t3.micro` and public IPv4 are both billed per instance-hour, so runtime dominates.

| Hours/month | Compute | IPv4 | Storage + S3 | Total |
|---|---|---|---|---|
| 730 (24×7) | $28.03 | $10.95 | $2.12 | **$42.10** |
| 365 (12 h/day) | $14.01 | $5.48 | $2.12 | **$21.61** |
| 173 (8 h/day weekdays) | $6.65 | $2.60 | $2.12 | **$11.37** |
| 44 (8 h/month) | $1.69 | $0.66 | $2.12 | **$4.47** |

Note that storage and S3 are **flat** — they do not fall when you stop the instances. At low
runtime they dominate. This is the argument for `terraform destroy` rather than
`aws ec2 stop-instances` on anything not being used daily.

### Stopping is only 40% saving

```bash
aws ec2 stop-instances --instance-ids i-0abc... i-0def... i-0ghi...
```

| | 24×7 | Stopped 12 h/day |
|---|---|---|
| Compute | $28.03 | $14.01 |
| IPv4 | $10.95 | **$10.95** |
| Storage | $2.11 | $2.11 |
| Total | $42.10 | **$27.07** |

A stopped instance does **not** release its public IPv4 address — AWS continues to bill it
while it is allocated. So stopping saves only the compute line, not the IPv4 line, and the
saving is 36%, not 50%.

Also note: stopped instances retain their EBS volumes, so the storage line continues, and
`terraform plan` still shows no drift (a stopped instance is still a managed resource).

---

## Optimisation options

Ranked by value per unit of effort.

### 1. Remove the public IPv4 addresses — saves ≈ $10.95/mo

Replace direct SSH with **SSM Session Manager**. Add an instance profile with
`AmazonSSMManagedInstanceCore`, drop `associate_public_ip_address`, and delete the SSH
ingress rules entirely.

```hcl
resource "aws_iam_role" "ssm" {
  name_prefix        = "${var.project}-ssm-"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume.json
}

data "aws_iam_policy_document" "ssm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm" {
  name_prefix = "${var.project}-"
  role        = aws_iam_role.ssm.name
}
```

```hcl
# compute.tf
iam_instance_profile = aws_iam_instance_profile.ssm.name
associate_public_ip_address = false   # no public IP at all
```

```bash
aws ssm start-session --target i-0abc...
```

**Trade-offs.** Session Manager is browser-accessible, so it removes the `/32` availability
trap ([SECURITY.md § S11](SECURITY.md#s11--single-32-ssh-source-with-no-fallback-path))
and needs no inbound ports. But `setup-ansible.sh` is built around `ssh`/`scp`, so it would
need to drive `aws ssm start-session` (no `scp` equivalent — files go via
`aws ssm send-command`) or keep SSH over a bastion. **That is a real code change, not a
drop-in.** The workers would additionally need a NAT gateway or VPC endpoints for `apt`,
adding ≈ $32/mo — which more than erases the saving.

**Verdict.** Worth it only if you also adopt private subnets and a NAT gateway, at which
point you have moved to the production topology in
[ARCHITECTURE.md § Evolution path](ARCHITECTURE.md#evolution-path). At three nodes, keep the
public IPs.

### 2. Run only during working hours — saves ≈ $30/mo

```bash
# Instance IDs are not outputs, so look them up by tag
IDS=$(aws ec2 describe-instances --filters "Name=tag:Name,Name=Cloud7-*" \
  --query 'Reservations[].Instances[].InstanceId' --output text)

aws ec2 start-instances --instance-ids $IDS

MASTER=$(terraform -chdir=infrastructure output -raw master_public_ip)
ssh -i ~/.ssh/id_ed25519 ubuntu@$MASTER 'cd ~/ansible && ansible-playbook docker.yml'
```

You cannot derive instance IDs from `terraform output` — it exposes public IPs, not IDs.
Query by `Name` tag instead. The playbook re-run is needed because Docker is enabled at
boot but the group membership from the original run is what grants non-root `docker`
access, and a stop/start cycle is a good moment to confirm it.

### 3. Schedule destruction — saves ≈ $42/mo

For anything not under active development, destroy and recreate on demand. Ten minutes of
work versus $42/month.

```bash
terraform -chdir=infrastructure destroy
# Destroying the state bucket needs force_destroy = true first — see
# OPERATIONS.md § Teardown.
terraform -chdir=remote_state apply -auto-approve      # after flipping the flag
terraform -chdir=remote_state destroy -auto-approve
# ... later ...
terraform -chdir=remote_state init && terraform -chdir=remote_state apply
terraform -chdir=infrastructure apply && ansible-playbook docker.yml
```

> ⚠️ `force_destroy = false` is the committed default, so `terraform destroy` in
> `remote_state/` fails with `BucketNotEmpty` until you flip it to `true`. That flip *is* the
> teardown — the provider purges every object version and delete marker itself, so no AWS CLI
> purge loop is involved.

### 4. Move to `us-east-1` — saves up to $9.34/mo via free tier

Only if the Free Tier matters more than the region. The AMI SSM path changes, every
documented example changes, and the region uplift disappears. Marginal.

### 5. Cheaper instance type

`t4g.micro` (ARM Graviton) is typically ~20% cheaper than `t3.micro` in the same region —
roughly $6/mo across three nodes. **Do not do this without changing the AMI lookup**: an
ARM instance cannot boot the `amd64` AMI, so you would also need the `arm64` SSM parameter
path. The playbook already handles the architecture in its apt repo line
(`ansible_architecture == 'x86_64' ? 'amd64' : 'arm64'`), so Docker itself would install
cleanly. It is a two-line change for ~$6/mo.

### What is not worth optimising

| Tempting change | Why not |
|---|---|
| Delete the S3 state bucket to save money | It costs fractions of a cent. It is your infrastructure's source of truth. |
| Downgrade EBS to `gp2` | `gp3` at 8 GiB is $2.11/mo total. The saving is noise; `gp3` is faster. |
| Reduce root volume to 4 GiB | Saves ≈ $1/mo and risks out-of-disk failures when Docker images are pulled. |
| Spot instances | Docker hosts are stateless here, so it *would* work — but interruption handling needs an ASG, and a 3-node lab gains nothing. |
| Savings Plans / Reserved | A 1-year commitment for a $28/mo line saves ~$11/mo and locks you to `t3.micro`. Wrong instrument at this scale. |

---

## Cost of the security remediations

From [SECURITY.md § Remediation plan](SECURITY.md#remediation-plan), so the security work can
be costed honestly.

| Change | Added monthly cost | Notes |
|---|---|---|
| `metadata_options` (IMDSv2) | **$0** | In-place attribute update |
| Explicit `encrypted = true` | **$0** | Already the EBS default |
| `key_name` from `var.project` | **$0** | One-time replacement |
| `accept-new` host key checking | **$0** | Script change only |
| Split security groups | **$0** | Security groups are free |
| Restrict egress | **$0** | |
| `REJECT`-only VPC Flow Logs | **≈ $1–3** | CloudWatch Logs ingestion |
| Pin AMI and Docker packages | **$0** | |
| SSM Session Manager | **$0** | SSM has no per-session charge |
| Private subnets + NAT gateway | **+ $32** | $32/mo fixed + $0.045/GB |
| Bastion host (`t3.micro`) | **+ $3.65** | 730 h + IPv4 |
| Multi-AZ | **+$0–1** | Inter-AZ data transfer only |
| **Phase 1 + 2 (all `$0` items)** | **$0** | 10 of 14 fixes are free |
| **Phase 3 (network segmentation)** | **+ $32** | The expensive one |

Ten of the fourteen remediation actions cost nothing. Only the network segmentation
proposed in Phase 3 has a real price tag, and it is the highest-value change for the
fleet's resilience.

---

## Cost of mistakes

| Mistake | Cost |
|---|---|
| Forgetting `terraform destroy` after a demo | $42/mo, accruing silently |
| Leaving instances stopped "for the weekend" | Saves 36%, not 100% — IPv4 and EBS still bill |
| Three accidental NAT gateways at $0.045/GB | The most common large surprise in AWS. Not present here, but the egress rule would not stop one being added. |
| EBS snapshots taken for debugging and forgotten | ≈ $0.40 per 8 GiB snapshot-month, plus growth if the volume grows |
| A `t3.micro` bursting credits surcharge | Requires sustained >10% CPU over 24 h. Possible with Docker builds; watch `CPUCreditBalance`. |
| Data transfer out to the internet | $0.09/GB — pulling Docker images is free inbound, but shipping logs out is not |

**A recurring NAT gateway is the one to watch for.** This stack has none, which is
deliberate. If you add private subnets per
[SECURITY.md § S4](SECURITY.md#s4--no-lateral-movement-containment), budget +$32/mo and
remember the hourly charge continues whether or not anything uses it.

---

## Monitoring

### AWS-side

```bash
# Current month to date, grouped by service.
# Substitute dates for your shell — GNU date is shown; macOS uses date -j -f,
# and PowerShell uses (Get-Date -Format yyyy-MM-dd).
aws ce get-cost-and-usage \
  --time-period Start=2026-10-01,End=2026-10-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[].[Keys.SERVICE,Metrics.BlendedCost.Amount]' \
  --output table
```

Expected shape for this stack:

```text
Amazon Elastic Compute Cloud      28.0315
Amazon Virtual Public Cloud       10.9500
Amazon Elastic Block Store         2.1120
AWS Key Management Service        0.0000
Amazon Simple Storage Service     0.0021
------------------------------------
Total                            41.0956
```

Requires `ce:GetCostAndUsage` and cost-explorer is not free beyond the AWS-provided
allowance.

### Budget alarm — set this before you deploy

```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget file://budget.json \
  --notification file://notification.json
```

```json
{
  "BudgetName": "cloud7-monthly",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "Budget": { "Amount": "50", "Unit": "USD" },
  "CostFilters": { "TagKeySet": [{ "Key": "Project", "Values": ["Cloud7"] }] }
}
```

The `CostFilters` block requires `default_tags` in the provider — which this configuration
does not have. Add it per
[SECURITY.md § S14](SECURITY.md#s14--no-mfa-or-role-assumption-enforced) before relying on
tag-based filtering, or drop `CostFilters` and budget on the whole account.

**A budget alarm at $50 is a strongly recommended companion to this repository.** The single
most likely cost outcome for a reviewer who deploys this and forgets about it is a silent
$42/month accrual.

### Per-resource breakdown

```bash
# What is actually running right now
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# How many public IPs are allocated
aws ec2 describe-addresses --query 'length(Addresses[])'
# Should be 3. Anything more means leaked Elastic IPs at $0.005/hr each.
```

---

## Further reading

- [ARCHITECTURE.md § Deliberate omissions](ARCHITECTURE.md#deliberate-omissions) — why there
  is no NAT gateway
- [SECURITY.md § Remediation plan](SECURITY.md#remediation-plan) — what each change costs
- [OPERATIONS.md § Routine maintenance calendar](OPERATIONS.md#routine-maintenance-calendar)
- [../README.md](../README.md) — overview
