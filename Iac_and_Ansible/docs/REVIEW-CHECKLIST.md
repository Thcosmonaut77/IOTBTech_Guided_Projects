# Review Checklist

A structured path through this repository for appraisers. Each section states what to look
for, where, and what a *good* answer looks like — so you can form your own judgement rather
than reading mine.

- [Before you start](#before-you-start)
- [Phase 1 — Does it work? (10 min)](#phase-1--does-it-work-10-min)
- [Phase 2 — Is it correct? (30 min)](#phase-2--is-it-correct-30-min)
- [Phase 3 — Is it well-built? (30 min)](#phase-3--is-it-well-built-30-min)
- [Phase 4 — Is it secure? (30 min)](#phase-4--is-it-secure-30-min)
- [Phase 5 — Is it operable? (20 min)](#phase-5--is-it-operable-20-min)
- [Phase 6 — Is the documentation honest? (15 min)](#phase-6--is-the-documentation-honest-15-min)
- [Cross-cutting questions](#cross-cutting-questions)
- [Where I would push back on myself](#where-i-would-push-back-on-myself)
- [Scoring sheet](#scoring-sheet)

---

## Before you start

**What this repository claims to be.** A three-node Ubuntu EC2 fleet on AWS, provisioned
with Terraform, with the control node bootstrapped by Bash and the workers configured by
Ansible — deliberately showing both paradigms and the boundary between them.

**What it is not.** Production infrastructure. It is not highly available, not segmented,
not cost-optimised at scale, and not audited. Every one of those omissions is listed with
its rationale in [ARCHITECTURE.md § Deliberate omissions](ARCHITECTURE.md#deliberate-omissions).

**The thing to be most curious about.** [KI-12](KNOWN-ISSUES.md#ki-12) — which *was* the
headline defect and is now **fixed in this repository**. `docker.yml` used to exist both as a
tracked file and as a heredoc inside `setup-ansible.sh`, and editing the tracked file
silently did nothing. The script now `cp`s the tracked file and `filesha256(docker.yml)` is a
`triggers_replace` key, so there is exactly one copy. Read that issue to see the failure mode,
then confirm the fix rather than taking it on trust.

Still open and worth attention: [KI-01](KNOWN-ISSUES.md#ki-01) (the version constraint
permits a Terraform that cannot parse the backend) and
[KI-06](KNOWN-ISSUES.md#ki-06) (`remote_state/` state is one unversioned local file).

**A fair warning about the documentation.** Seven documents totalling several thousand
lines were written by the same author as the code, describing the same code. That is a
structural weakness of self-review: nothing here is independently verified. Where the docs
make a specific factual claim — a resource count, an expected output, a price — check it
rather than trusting it. The [Known Issues](KNOWN-ISSUES.md) catalogue is the most likely
document to be accurate and useful, because each entry was found by reading the
configuration rather than by recalling intent.

---

## Phase 1 — Does it work? (10 min)

**Goal:** confirm the code runs, and that the documented commands are real.

```bash
terraform -chdir=infrastructure version          # must be >= 1.10 — see KI-01
terraform fmt -check -recursive   # reports 3 files — see KI-11
terraform -chdir=infrastructure validate         # expect: Success!
```

Read these files end to end. They all live in `infrastructure/`; the `remote_state/`
module has only `main.tf` and `outputs.tf`.

| File | Lines | What to check |
|---|---|---|
| `infrastructure/providers.tf` | 20 | Backend config, provider config, the version constraint |
| `infrastructure/variables.tf` | 47 | Nine variables, each with a `description`; types are explicit |
| `infrastructure/networking.tf` | 37 | VPC → IGW → subnet → route table → association |
| `infrastructure/firewall.tf` | 50 | Four ingress rules (22, 80), one egress rule, key pair |
| `infrastructure/compute.tf` | 26 | AMI lookup, master (no count), workers (`count = 2`) |
| `infrastructure/ansible.tf` | 19 | `terraform_data` + `local-exec` + `triggers_replace` |
| `infrastructure/outputs.tf` | 32 | Six outputs, each with a description |
| `infrastructure/docker.yml` | 83 | Eight tasks, `hosts: workers`, `become: true` |
| `infrastructure/requirements.yml` | 18 | Collection pin for `community.docker` |
| `infrastructure/setup-ansible.sh` | 243 | The real work |

**Questions to answer:**

- Does every variable in `variables.tf` actually get used? (`var.key` used to be declared
  and never used; it has been deleted. See [KI-04](KNOWN-ISSUES.md#ki-04).)
- Does `compute.tf` reference anything that does not exist?
- Is there a resource with no `tags`? Is there a `Name` tag on everything that should have
  one?
- Do the `Name` tags consistently derive from `var.project`? (They do now, including the key
  pair's `key_name` — see [KI-03](KNOWN-ISSUES.md#ki-03).)

**A good outcome:** you can describe the dependency graph of the eleven resources from
memory after one read. [ARCHITECTURE.md § Execution graph](ARCHITECTURE.md#execution-graph)
has it written out — check it against your own derivation rather than assuming it is right.

---

## Phase 2 — Is it correct? (30 min)

**Goal:** find the bugs. There are seventeen catalogued; a good review finds several that are
*not* catalogued.

### 2a — Version constraints

- [ ] Does `required_version` cover every feature used?
      (`use_lockfile` needs 1.10, `terraform_data` needs 1.4. Declared: `>= 1.5`.
      See [KI-01](KNOWN-ISSUES.md#ki-01).)
- [ ] Is the AWS provider constraint (`~> 5.0`) appropriate, or too loose for a
      reproducibility-focused project?

### 2b — Reproducibility

- [ ] Is the AMI pinned? (`stable/current` is a moving target. See
      [KI-07](KNOWN-ISSUES.md#ki-07).)
- [ ] Is the availability zone deterministic? (`names[0]` on an unordered list. See
      [KI-15](KNOWN-ISSUES.md#ki-15).)
- [ ] Would a fresh `terraform plan` be a no-op today? What would make it not a no-op?
- [ ] Is `.terraform.lock.hcl` committed? (**It is now** — the broad `.*` pattern in
      `.gitignore` was replaced and the lock file is explicitly negated. See
      [KI-02](KNOWN-ISSUES.md#ki-02).)

### 2c — Dead code and unused configuration

All four original items have been resolved; confirm rather than assume.

- [ ] ~~`var.key` — declared, set in `terraform.tfvars`, referenced nowhere.~~ **Deleted.**
      See [KI-04](KNOWN-ISSUES.md#ki-04).
- [ ] ~~`random_id.bucket_suffix` — generated, never interpolated into the bucket name.~~
      **Deleted**, along with the `random` provider requirement. The bucket-name collision it
      pretended to solve is still real. See [KI-10](KNOWN-ISSUES.md#ki-10).
- [ ] ~~`ssh_public_key` in `hosts.ini` — exported, never consumed by the playbook.~~
      **Removed.** See [KI-11](KNOWN-ISSUES.md#ki-11).
- [ ] ~~`docker.yml` at the repo root — read by humans, never by the script.~~ **Now `cp`'d
      by the script** and checksummed in `triggers_replace`. See
      [KI-12](KNOWN-ISSUES.md#ki-12).
- [ ] Anything else? Look for: a variable set but defaulted, a `data` source whose result
      is not used, an output nobody reads, a task whose output is discarded.

### 2d — Consistency between code and documentation

- [ ] Does `ansible.tf` pass worker **private** IPs while `outputs.tf` says to feed the
      inventory **public** IPs? (Yes. See [KI-05](KNOWN-ISSUES.md#ki-05).)
- [ ] Does the bucket name in `providers.tf` match what `remote_state/` creates? (They agree
      by coincidence, not by wiring — `"cloud77-terraform-state"` literal vs
      `"${var.project}-terraform-state"` with `project = "cloud77"`.)
- [ ] Do the outputs' `description` fields state what the values are actually for?

### 2e — Failure behaviour

Read `setup-ansible.sh` and answer:

- [ ] What happens if the master's public IP is wrong? (30 attempts × 10 s = ~300 s, then
      exit 1. That fails the `terraform apply` **after** the instances are created — correct,
      and better than the `user_data` alternative where the apply would have gone green.)
- [ ] What happens if `python3` is absent? (Only matters on the manual path, since Terraform
      supplies all three inputs.)
- [ ] Is the `EXIT` trap guaranteed to clean up the temp key copy? (`set -euo pipefail` plus
      `trap cleanup EXIT` — yes, including on `exit 1` inside the trap's own function.)
- [ ] Does `resolve_key` ever return a path outside the intended directories? (It globs
      `/mnt/*/Users/*/.ssh/` and `/mnt/*/home/*/.ssh/`. Broad, but read-only and then
      permission-checked.)
- [ ] What does `WORKER_IPS=("$@")` do if a stray argument is passed? (Treats it as a worker.
      Silent. Fragile.)

### 2f — Blast radius

- [ ] What is the *worst* thing that happens if someone runs `terraform apply` with a typo'd
      `vpc_cidr`? (Subnet replacement → all three instances replaced. No `prevent_destroy`
      anywhere. See [KI-16](KNOWN-ISSUES.md#ki-16).)
- [ ] Is anything irreversible? (The state bucket, once emptied. Everything else is
      recreatable in ~10 minutes.)

---

## Phase 3 — Is it well-built? (30 min)

**Goal:** judge the engineering, not the bugs.

### 3a — Structure

- [ ] Is the concern-per-file split sensible?
      (`networking` / `firewall` / `compute` / `ansible` / `outputs` — yes, conventional and
      readable.)
- [ ] Is `remote_state/` correctly modelled as a separate root module rather than a child
      module? (Yes — a child module cannot provide a backend.)
- [ ] Is anything in the wrong file? (The key pair is in `firewall.tf`. It is neither
      networking nor compute. Defensible — it is access control — but arguable.)

### 3b — Naming and tags

- [ ] Is naming consistent? (`${var.project}-vpc`, `-igw`, `-public-subnet`, `-public-rt`,
      `-sg`, `-keypair`; instances use `-Master-Server` / `-Worker-Server1`. Two conventions
      for the same project. Minor.)
- [ ] Would a cost-allocation tag schema work here? (No `default_tags`, so no.)

### 3c — The provisioning trigger — the best idea in the repository

- [ ] Is `terraform_data` the right vehicle for a bare `local-exec`? (Yes. Better than
      bolting a `local-exec` onto an unrelated resource.)
- [ ] Are the four `triggers_replace` keys the *right* four? (`master_ip`, `worker_ips`,
      `filesha256(setup-ansible.sh)`, `filesha256(docker.yml)` — yes for stage 2. The playbook
      was added to close [KI-12](KNOWN-ISSUES.md#ki-12).)
- [ ] Is using `filesha256` on the script a good idea? (Yes — it means editing the bootstrap
      re-runs the bootstrap. Under-used.)
- [ ] What is *not* in `triggers_replace` that should be? (`ssh_user`, and arguably the
      playbook's variables. Note that the `playbook` trigger re-copies the file but does not
      run it — stage 3 is still manual by design.)

### 3d — The `-K` base64 workaround

- [ ] Understand what problem it solves. (`local-exec` on Windows cannot export environment
      variables to the child process, so an env-var approach silently yields an empty value.)
- [ ] Is base64 the right fix? (It works and it is simple. But it puts an obfuscated string
      on the command line, which lands in plan output and apply logs — see
      [SECURITY.md § S8](SECURITY.md#s8--base64-obfuscated-key-path-on-the-command-line) —
      and it looks like secret smuggling to a reviewer.)
- [ ] Would passing the path directly work, given `resolve_key()` already handles Windows
      paths? (Probably. That is the recommended patch.)

### 3e — The Bash script as a piece of software

~240 lines of Bash with no shellcheck gate in CI. Check:

- [ ] `set -euo pipefail` — present.
- [ ] `trap cleanup EXIT` — present, and `cleanup` ends with `return 0` so a failed `rm -rf`
      in a trap cannot mask the original exit code. That is a detail most scripts get wrong.
- [ ] Quoting discipline. (Consistently quoted throughout — `printf '%s\n' "$candidate"`,
      `"${WORKER_IPS[*]}"`, `"$SSH_USER@$MASTER_IP:$REMOTE_DIR/"`. Good.)
- [ ] Are the positional worker IPs safe? (`shift $((OPTIND - 1))` then `"$@"` — correct, and
      correctly quoted.)
- [ ] Does it depend on non-portable tools? (`mapfile`, `base64 -d`, `mktemp`, `seq`,
      `python3`. All present in a default GNU/Linux and Git Bash, except `python3` in Git
      Bash, which is why the fallback path can fail there.)
- [ ] Is there a lint gate? (`make check` runs `shellcheck` locally, but there is no CI. See
      the [Makefile](../Makefile).)
- [ ] Is the heredoc for `ansible.cfg` and the inventory quoted (`<<'EOF'`)? (Yes — so `${{ }}`
      Ansible templating is not expanded by Bash. Correct and important.)
- [ ] Does the script copy the tracked `docker.yml` rather than carrying its own copy? (Yes —
      `cp "$DIR/docker.yml"`. This is the [KI-12](KNOWN-ISSUES.md#ki-12) fix.)

### 3f — The playbook

- [ ] Short module names vs FQCN. (Fixed — all tasks use `ansible.builtin.*`. See P1 in
      [KNOWN-ISSUES.md](KNOWN-ISSUES.md#playbook-quality-issues).)
- [ ] Is the `community.docker` dependency declared and installed? (Yes — `requirements.yml`
      pins `>=3.4.0,<4.0.0`; `setup-ansible.sh` step 4/6 uploads it and runs
      `ansible-galaxy collection install -r requirements.yml` **on** the master, and it is a
      `triggers_replace` key. P2 and P13.)
- [ ] Is `update_cache: yes` repeated on two tasks? (Yes — wasteful. P3.)
- [ ] Are Docker packages version-pinned? (No. P4 / [S15](SECURITY.md#s15--docker-packages-are-unpinned).)
- [ ] Is the GPG key fingerprint verified? (No — only downloaded and trusted. P5.)
- [ ] Is `hosts: workers` the right target declaration? (Yes — it is now explicit. It used to
      be `hosts: all`, which only worked because the inventory contains nothing else. See
      [KI-09](KNOWN-ISSUES.md#ki-09).)
- [ ] Would a second run be a genuine no-op? (**Yes** — this is the playbook's strongest
      property and the clearest contrast with the Bash stage. `changed=0` is the test.)
- [ ] Is `ansible_distribution_release` used correctly in the repo line? (Yes —
      `{{ ansible_distribution_release }}` resolves to `noble`. And the architecture
      ternary handles both `amd64` and `arm64`, so the playbook is portable even though the
      AMI lookup is not.)

---

## Phase 4 — Is it secure? (30 min)

**Goal:** assess the security posture independently, then compare with
[SECURITY.md](SECURITY.md).

Full analysis is in [SECURITY.md](SECURITY.md). Check specifically:

### 4a — The finding that matters

- [ ] Read `SSH_OPTS` in `setup-ansible.sh:164` and `host_key_checking` in the generated
      `ansible.cfg`.
- [ ] `StrictHostKeyChecking=no` + `UserKnownHostsFile=/dev/null` means the SSH transport is
      encrypted but **unauthenticated**, and records nothing.
- [ ] Ask: what is the realistic attack? (Anyone on the network path between the operator
      and the master, or between the master and a worker. Rogue Wi-Fi, a hostile ISP, an
      attacker with S3 write access substituting the master's IP in state.)
- [ ] Ask: is the harm real? (**Yes** — `setup-ansible.sh` `scp`s the private key to the
      master during that session.)
- [ ] Would `StrictHostKeyChecking=accept-new` be sufficient, and why? (Yes: instances are
      replaced rather than rebuilt, so a changed key legitimately means a new instance.)

### 4b — Key handling

- [ ] Local temp copy: `mktemp -d`, `chmod 700`, `chmod 600` on the key, `ssh-keygen -y`
      validation, `EXIT` trap. **This is done well** — better than most implementations.
- [ ] Remote copy at `~/ansible/key`: persists for the life of the instance. Who else can
      read it? (Anyone with shell on the master.)
- [ ] **Establish its true scope before scoring the severity.** It is easy to assume this is
      a VPC-internal, master→workers-only credential. It is neither. Ask and confirm:
      - Is it the operator's own key rather than a dedicated one? (`aws_key_pair.ansible`
        installs the same public key on master *and* both workers — `compute.tf:11,22`.)
      - Do the workers accept port 22 from your `/32`? (Yes — all three share one SG whose
        first rule admits `var.ssh_cidr`.)
      - Therefore: valid against **all three** nodes, and usable from **outside** the VPC,
        not just from inside it.
- [ ] So the blast radius is the whole fleet, and anything running as `ubuntu` on the
      master — including a malicious Galaxy collection installed in step 4/6 — exfiltrates
      fleet-wide SSH access. Master compromise = fleet compromise.
- [ ] Would `chmod 400` be better than `600`? (Accepted by OpenSSH, and marginally
      tighter, but `400` and `600` both deny group and other, so it is cosmetic. `600` is
      kept. This is the *least* interesting thing to review here.)
- [ ] Is there a documented way to remove the key and get it back? (Yes —
      [OPERATIONS.md § Removing the bootstrap key from the master](OPERATIONS.md#removing-the-bootstrap-key-from-the-master).
      Check it states what breaks: Stage 3 only.)
- [ ] Would splitting the SG by role fix it for free? (Yes, and it is an in-place update
      with no instance replacement — see [KI-19](KNOWN-ISSUES.md#ki-19). Note it was
      deliberately left to the operator because it changes reachability.)
- [ ] Does the private key ever reach Terraform state or an AWS API? (**No** — only the
      public key is uploaded. This is correct and worth noting as a positive.)
- [ ] Is the key usable without a passphrase? (It must be — the script cannot answer a
      prompt. Documented as a prerequisite in
      [DEPLOYMENT.md § Phase 0](DEPLOYMENT.md#phase-0--prerequisites).)

### 4c — Network

- [ ] Is SSH restricted to a `/32`? (Yes. The single most effective control here.)
- [ ] Is there any path for lateral movement? (**None is blocked.** Flat subnet, one
      shared SG, intra-VPC SSH allowed, same key everywhere.)
- [ ] Is egress restricted? (**No** — `0.0.0.0/0` on all protocols. Combined with IMDSv1
      being available, that is a complete initial-access path for a compromised container.)
- [ ] Is IMDSv2 enforced? (**No.**)
- [ ] Would you expect flow logs? (No — and for a personal account, defensible.)

### 4d — Judgement, not checklist

- [ ] Is the overall risk **Medium**, given a personal/training account, three nodes, and
      no untrusted code? (That is the rating in [SECURITY.md § Scope](SECURITY.md#scope-and-assumptions).
      Does it hold?)
- [ ] Which single change would most improve the posture? (**SSM Session Manager** — it
      removes the `/32` availability trap, provides an authenticated path that does not
      depend on host-key verification, and works from a browser.)
- [ ] Is anything rated too low? Or too high?
- [ ] Are the *stated* trade-offs legitimate, or rationalised? (Review the "why it is there"
      paragraph under each finding. The S1 reasons are real; the conclusion that the *fix*
      requires disabling verification is not.)

---

## Phase 5 — Is it operable? (20 min)

- [ ] Can you tell what to do when `terraform apply` fails after the instances exist?
      (Yes — `triggers_replace` means only the provisioner re-runs on the next apply. This is
      a genuinely good property.)
- [ ] Is the SSH wait loop bounded? (Yes — 30 × 10 s. Bounded failure beats hanging.)
- [ ] Is there a documented runbook for the daily, weekly and quarterly tasks? (Yes,
      [OPERATIONS.md](OPERATIONS.md).)
- [ ] Is state recovery documented? (Yes, including S3 version rollback, which is the correct
      mechanism given versioning is enabled.)
- [ ] Is teardown documented — including the two-step requirement and the `force_destroy`
      trap? (Yes. Both are easy to get wrong and both are covered.)
- [ ] Is key rotation documented, including the fact that it replaces all three instances?
      (Yes, with the reason.)
- [ ] What happens if the operator's IP changes? (Locked out until `ssh_cidr` is updated.
      A real availability weakness — [S11](SECURITY.md#s11--single-32-ssh-source-with-no-fallback-path).)
- [ ] Is the cost of *not* tearing down stated? (Yes, ≈ $42/mo, with a budget-alarm
      recommendation.)

---

## Phase 6 — Is the documentation honest? (15 min)

This is the phase most likely to be skipped and most worth doing.

- [ ] Does anything in the docs claim a verification that was not performed?
      (Specifically: the `screenshots/` evidence. The docs state plainly that the author
      could not verify the image content and declined to caption them. That is the right
      call — check that it held throughout, and that no caption was invented.)
- [ ] Do the docs contain fabricated expected output? (The apply transcript, the
      `get-cost-and-usage` output and the playbook recap are illustrative, not captured. They
      are plausible and internally consistent. A stricter repo would mark them as such.)
- [ ] Are the prices marked as estimates? (Yes, with a link to the Price List API.)
- [ ] Are limitations stated as prominently as features?
      ([KNOWN-ISSUES.md](KNOWN-ISSUES.md) is linked from the README's own summary, with the
      four worst called out by name. That is the right placement.)
- [ ] Is the `terraform.tfstate` list count correct? (README says 11 managed resources.
      Count them: VPC, IGW, subnet, route table, association, SG, key pair, master,
      2 × worker, `terraform_data` = 11. Correct.)
- [ ] Is every internal link resolvable? (Check the `#` anchors resolve to real headings —
      the cross-references between documents are dense.)
- [ ] Do the Mermaid diagrams parse? (Render them. One was already broken in an early draft.)
- [ ] Is the security severity rating defensible? (See
      [Where I would push back on myself](#where-i-would-push-back-on-myself).)

---

## Cross-cutting questions

Questions that do not belong to one file, and that are usually where the real review value
is.

1. **Is the two-tool bootstrap the right architecture, or a case of demonstrating something
   at the expense of building the right thing?** The honest answer is "both". It is a
   reasonable design *and* a demonstration, and the project does not pretend otherwise. Does
   the documentation make that trade-off explicit rather than selling it as best practice?

2. **Where is the boundary between "reference implementation" and "do this in production"?**
   Is that line clear? (It should be in the README's non-goals and
   [ARCHITECTURE.md](ARCHITECTURE.md). Judge whether a reader would cross it accidentally.)

3. **What is the failure mode of this design that is *not* in
   [KNOWN-ISSUES.md](KNOWN-ISSUES.md)?** Every catalogue is incomplete. Some candidates:
   - A provider upgrade changing `availability_zone` ordering → unplanned replacement
     (catalogued as [KI-15](KNOWN-ISSUES.md#ki-15), but the *cascade* is not).
   - Two operators running `setup-ansible.sh` concurrently from different machines → the
     second overwrites the first's `~/ansible` mid-flight. Not catalogued.
   - The `-K` base64 argument exceeding a command-line length limit on Windows. Not
     catalogued.
   - `worker_public_ips` changing (e.g. on stop/start) not triggering anything, while
     `triggers_replace` watches private IPs. Asymmetric. Related to
     [KI-05](KNOWN-ISSUES.md#ki-05).

4. **What would you add that is not here at all?** Candidates worth arguing about: Terratest
   or Checkov in CI; a `versions.tf` or Renovate config for dependency updates; per-environment
   state; `prevent_destroy` on the fleet itself; a bastion; IMDSv2; an AMI build pipeline.

5. **Is 300 lines of Bash the right amount of Bash?** Could step 4 (generating
   `ansible.cfg`, `hosts.ini` and the playbook) be a Jinja template rendered locally, or an
   `ansible.cfg` committed to the repo and just `scp`'d? Almost certainly yes — the
   generation exists because the file must contain runtime values, but
   `ansible.cfg` could be static with only `hosts.ini` templated.

---

## Where I would push back on myself

Stated explicitly, because a review that only agrees is not a review.

1. **The severity ratings may be soft.** [SECURITY.md § Scope](SECURITY.md#scope-and-assumptions)
   assumes a personal account with no untrusted code. Under those assumptions nothing here
   is Critical, and several Mediums could arguably be Low. If you think the assumptions are
   wrong — or that I used them to avoid uncomfortable findings — say so. The strongest
   counter-argument to my own framing is that the *control node holds a key to both
   workers* and *nothing stops it from being compromised*, which holds regardless of account
   type.

2. **"Lab appropriate" is a phrase I avoided on purpose.** Every finding is rated on its
   merits rather than excused by the context. A reviewer might reasonably argue that
   disabling host-key checking *is* appropriate here, because the alternative is an
   unbootable bootstrap on every instance replacement. I think `accept-new` is strictly
   better, but the argument has force.

3. **The documentation is voluminous.** Seven documents, ~5,000 lines, for eleven
   resources and ~240 lines of Bash. That is arguably over-documentation, and it creates its
   own risk: a reviewer may trust the prose instead of reading the HCL, and the prose was
   written by the same person as the HCL. The README's own summary and
   [KNOWN-ISSUES.md](KNOWN-ISSUES.md) are the parts I would actually ask a reviewer to read;
   the rest is reference. If you think this is the wrong shape for the repository, say so —
   it is a defensible thing to argue.

4. **Some "expected output" is reconstructed, not captured.** The apply transcript, the
   playbook recap and the cost breakdown were written from knowledge of what those tools
   print, not copied from a real run. They are consistent with the configuration but a
   reviewer should treat them as illustrative. I did not want to invent screenshots I
   could not read, so those are the weakest evidence in the repository.

5. **`[KI-12](KNOWN-ISSUES.md#ki-12) was the finding I would not have shipped, so it has
   been fixed.** A duplicated playbook where the tracked copy is inert was an active trap,
   not a latent risk. `setup-ansible.sh` now `cp`s the tracked `docker.yml`, and
   `filesha256(docker.yml)` is a `triggers_replace` key. The same reasoning applies to the
   `.gitignore` problem below — both were cheap fixes with no downside, so documenting them
   was not the right call.

6. **The `.gitignore` needed fixing before the first commit.** Not a design question — a
   publishing blocker. As written it prevented `.terraform.lock.hcl` and
   `terraform.tfvars.example` from being tracked at all. It has been fixed in this
   repository; see [KI-02](KNOWN-ISSUES.md#ki-02).

---

## Scoring sheet

Optional, for a structured appraisal. Score 1–5 each.

| Dimension | 1 | 3 | 5 | Score |
|---|---|---|---|---|
| **Correctness** | Does not run | Runs with friction | Runs first try, converges cleanly | |
| **Reproducibility** | Different result every run | Converges, but drifts over time | Byte-identical across runs and regions | |
| **Structure** | One giant file, no organisation | Conventional file split | Clear boundaries, each file has one job | |
| **Naming & tags** | Inconsistent, untagged | Mostly consistent | Consistent, `default_tags`, greppable | |
| **Idempotency** | Re-running breaks things | Tolerates re-runs | Converges to a no-op | |
| **Error handling** | Silent failure | Fails loudly, unhelpful message | Fails loudly, actionable, bounded | |
| **Security** | Public, unauthenticated | Key-based, SSH restricted | Segmented, least privilege, audited | |
| **Operability** | Requires the author | Requires tribal knowledge | Documented runbook, self-service | |
| **Documentation** | Comments only | README | Honest, complete, includes limitations | |
| **Cost awareness** | Ignored | A budget alarm | Modelled, optimised, teardown economics | |
| **Honesty about limitations** | Hidden | Implied | Catalogued with severity and patches | |

**My own assessment, for calibration:** correctness 4, reproducibility 3, structure 4,
naming 3, idempotency 3 (stage 2 no, stage 3 yes), error handling 4, security 3,
operability 4, documentation 4, cost awareness 4, honesty 5.

The two 3s in reproducibility and idempotency are [KI-07](KNOWN-ISSUES.md#ki-07) and
[KI-12](KNOWN-ISSUES.md#ki-12) respectively — both known, both cheap to fix, both left in
place deliberately for this review.

---

## Further reading

Start with the [README](../README.md), then
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) — it is the highest-signal document here. After that,
[ARCHITECTURE.md](ARCHITECTURE.md) for intent and
[SECURITY.md](SECURITY.md) for the threat model.
