# Cost Model

What this stack costs, why, and where the money actually goes.

> **Prices are estimates.** All figures are AWS public list prices for `eu-north-1` at the
> time of writing and exclude free-tier credits, taxes and negotiated discounts. Verify
> against the [AWS Pricing Calculator](https://calculator.aws/) before making a financial
> decision.

- [Summary](#summary)
- [The surprising part](#the-surprising-part)
- [Line items](#line-items)
- [Cost by runtime](#cost-by-runtime)
- [What this stack does not cost](#what-this-stack-does-not-cost)
- [Optimisation options](#optimisation-options)
- [Cost of the security remediations](#cost-of-the-security-remediations)
- [Deciding when to destroy](#deciding-when-to-destroy)

---

## Summary

| Scenario | Monthly |
|---|---|
| Running 24×7 | **≈ $39** |
| Running 8 h/day, weekdays only | **≈ $10** |
| Stopped but not destroyed (storage only) | **≈ $2** |
| Destroyed | **$0** |

One instance is the difference between "a lab you keep" and "a lab you run when you need
it". At 8 hours a day on weekdays the stack costs about **a quarter** of the 24×7 rate.

---

## The surprising part

For a single small instance, **the public IPv4 address is 10% of the bill and the disk is
5%**, while the compute is 85%. On Phase 1's two-instance fleet the two `t3.micro` nodes
combined cost less than the two addresses; here the balance flips because the node is
larger.

```text
Compute   1 × t3.medium       $33.29/mo   86%
Public IPv4 address            $3.65/mo    9%   ← usually forgotten
Storage   20 GiB gp3           $1.76/mo    5%
ECR + S3 state                <$0.50/mo   <1%
```

The public address is billed **whether or not anything connects to it**, at $0.005/hour,
and it is charged only while the instance is running (a stopped instance releases it). That
is why the "8 h/day" row is so much cheaper: it removes most of both the compute and the
address cost.

---

## Line items

### Compute — 1 × `t3.medium`

`eu-north-1` on-demand Linux, 2 vCPU / 4 GiB. This is the smallest size that comfortably runs
two Docker builds (`npm ci` + `next build`) plus PostgreSQL.

| | Rate | Monthly (730 h) |
|---|---|---|
| `t3.medium` | $0.0456 / hr | **$33.29** |

`t3` is billed per instance-hour regardless of CPU actually consumed. **Unlimited bursting**
can incur a CPU-credit surcharge under sustained high utilisation; a Docker build is a short
burst and is not a concern, but a permanently CPU-bound workload would be.

### Storage — 1 × 20 GiB `gp3`

The root volume is enlarged from the AMI's 8 GiB default so the image builds have headroom.

| | Rate | Monthly |
|---|---|---|
| `gp3` | $0.088 / GiB-month | $1.76 |
| **20 GiB** | | **$1.76** |

`gp3` includes 3,000 IOPS and 125 MiB/s throughput in the base price. **Snapshots are not
included** — a snapshot of 20 GiB costs roughly $1/month to retain.

### Public IPv4 — 1 address

| | Rate | Monthly (730 h) |
|---|---|---|
| Public IPv4 | $0.005 / hr | **$3.65** |

Billed for every hour the instance runs with an address attached. Assigned automatically
(`associate_public_ip_address = true`); there is no Elastic IP, so there is no *idle* EIP
charge either — see [KI-03](KNOWN-ISSUES.md#ki-03).

### ECR

| | Rate | Monthly |
|---|---|---|
| Repository storage | $0.10 / GiB-month | ~$0.03 (≈ 0.3 GiB of images) |
| Data transfer in | free | $0 |

Two images at roughly 150–250 MB each. Trivially small, but note that **mutable tags plus no
lifecycle policy** means layers accumulate over time — see [KI-13](KNOWN-ISSUES.md#ki-13).

### S3 state bucket

| | Rate | Monthly |
|---|---|---|
| Standard storage | $0.0245 / GiB-month | ~$0.001 |
| PUT / GET / LIST | $0.005 per 1,000 | negligible |

A Terraform state file for this stack is a few hundred KiB, versioned. Effectively free.

### Data transfer

| Flow | Cost |
|---|---|
| Docker image layer pulls (Docker Hub → host) | Free (internet ingress) |
| Image pushes to ECR | ~0.3 GiB, pennies |
| Outbound to site visitors | First 100 GiB/month free; a demo site uses a fraction |
| DNS / ACME / DuckDNS | negligible |

---

## Cost by runtime

| | 24×7 | 8 h/weekday | Stopped |
|---|---|---|---|
| Compute | $33.29 | $7.66 | $0.00 |
| Public IPv4 | $3.65 | $0.84 | $0.00 |
| Storage (20 GiB) | $1.76 | $1.76 | $1.76 |
| ECR + S3 | $0.10 | $0.10 | $0.10 |
| **Total** | **≈ $38.80** | **≈ $10.36** | **≈ $1.86** |

*8 h/weekday ≈ 168 h/month.* Stopping an instance halts compute and releases the public IP,
but the EBS volume and ECR/S3 storage keep billing.

> A stopped instance is **not** a safe way to pause this lab: on the next start it gets a new
> public IPv4, which invalidates the DuckDNS record and the certificate. Prefer
> `terraform destroy` over `stop` unless you have added an Elastic IP.

---

## What this stack does not cost

| Thing | Cost | Note |
|---|---|---|
| DuckDNS subdomain | free | Community DNS service. |
| Let's Encrypt certificate | free | Automatically renewed by certbot. |
| NAT gateway | **not used** | Would add ≈ $32/month. |
| Load balancer | **not used** | Would add ≈ $16/month. |
| RDS | **not used** | PostgreSQL runs in a container on the host. |
| CloudWatch detailed monitoring | **not enabled** | Basic monitoring is free. |

---

## Optimisation options

Ordered by saving.

| Option | Saving | Trade-off |
|---|---|---|
| **Run only when needed** (`terraform destroy` between sessions) | Up to 95% | Full rebuild each time (≈ 15 min) and a new IP. |
| **`t4g.medium` (Graviton arm64)** | ≈ 20% on compute | Ubuntu arm64 AMI; the app images must be built for arm64. |
| **`t3.small`** | ≈ 50% on compute | 2 GiB RAM is tight for a concurrent Docker build + Postgres. |
| **SSM Session Manager instead of a public IP** | ≈ 9% (the address) | No direct SSH; requires the SSM agent and IAM. |
| **Elastic IP + stopping overnight** | Removes the overnight compute | An idle EIP is itself billed at $0.005/hr when detached. |
| **Savings Plan / Reserved Instance (1 yr)** | ≈ 40% on compute | Commitment; wrong for a lab. |
| **Build in CI, pull on the host** | Removes build CPU spikes | Requires a running CI pipeline and ECR pull auth — see [KI-12](KNOWN-ISSUES.md#ki-12). |
| **Smaller root volume (8–10 GiB)** | ≈ $1/month | Risk of `no space left` during a build. |

The single most effective lever is **not running it**. At 8 h/weekday the stack is ≈ $10/month;
destroyed between sessions, it approaches $0 plus pennies of storage.

---

## Cost of the security remediations

Most of the [SECURITY.md](SECURITY.md) roadmap is free. The exceptions:

| Remediation | Monthly impact |
|---|---|
| Move the database to RDS (`db.t4g.micro`, multi-AZ off) | ≈ +$13 (single-AZ) |
| Attach an Elastic IP | +$3.65 while attached |
| Add a NAT gateway (if the host moves to a private subnet) | ≈ +$32 |
| Nightly `pg_dump` to S3 | <$0.10 |
| EBS snapshot schedule | ≈ $1–2 |
| Add a WAF | ≈ $5 + per-request |

The three highest-value security fixes — IMDSv2 enforcement, encrypted root, and taking
long-lived AWS keys off the host — are **free**.

---

## Deciding when to destroy

| If you… | Do this |
|---|---|
| Are actively developing the app | Keep it running; redeploy on the host. |
| Demonstrate it a few times a week | `destroy` after each session, rebuild from scratch (≈ 15 min). |
| Only need to reproduce a deployment | Destroy immediately after capturing evidence. |
| Are leaving it up for a reviewer | Leave it running, and budget one month. |

At 24×7 the stack is ≈ $39/month. If it has been idle for more than a day, destroying it
costs less than leaving it up — the rebuild is 15 minutes.

---

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) — the steps that incur the cost.
- [OPERATIONS.md § Teardown](OPERATIONS.md#teardown) — how to stop billing.
- [SECURITY.md § Remediation roadmap](SECURITY.md#remediation-roadmap) — the priced fixes.
