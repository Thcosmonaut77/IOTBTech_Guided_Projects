# Operations

Day-2 tasks: access the host, deploy a change, rotate a secret, replace a host, back up the
database, and tear everything down. Each section is a runbook you can paste.

- [Accessing the host](#accessing-the-host)
- [Container lifecycle](#container-lifecycle)
- [Deploying an application change](#deploying-an-application-change)
- [Rolling back](#rolling-back)
- [Database operations](#database-operations)
- [TLS certificate operations](#tls-certificate-operations)
- [DNS operations](#dns-operations)
- [Rotating secrets and credentials](#rotating-secrets-and-credentials)
- [Replacing the host](#replacing-the-host)
- [Scaling the host](#scaling-the-host)
- [Logs, health checks and metrics](#logs-health-checks-and-metrics)
- [Terraform state operations](#terraform-state-operations)
- [Applying a bootstrap change](#applying-a-bootstrap-change)
- [Teardown](#teardown)
- [Runbook index](#runbook-index)

---

## Accessing the host

```bash
ssh -i "$(terraform -chdir=Infrastructure output -raw private_key_file)" \
    "$(terraform -chdir=Infrastructure output -raw ssh_user)@$(terraform -chdir=Infrastructure output -raw server_public_ip)"
```

**If SSH is refused**, your public IP has probably changed. The security group only permits
your *current* address (resolved at apply time). Re-read it:

```bash
terraform -chdir=Infrastructure apply -replace=aws_security_group.ec2
# or simply
terraform -chdir=Infrastructure apply
```

The SSH rule's source is `data.http.my_ip` → your IP `/32`, so a plain re-apply fixes it.

The bootstrap adds the login user to the `docker` group, so every `docker …` command below
runs without `sudo`.

---

## Container lifecycle

Everything runs as Docker containers on one host. `deploy.sh` is idempotent at the container
level: it removes and recreates `zeetafin-db`, `zeetafin-be` and `zeetafin-fe` on every run.

```bash
# what is running
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# logs
docker logs --tail 100 -f zeetafin-be
docker logs --tail 100 -f zeetafin-fe
docker logs --tail 100 -f zeetafin-db

# restart one container
docker restart zeetafin-be

# stop / start everything without recreating
docker stop zeetafin-fe zeetafin-be zeetafin-db
docker start zeetafin-db && sleep 5 && docker start zeetafin-be zeetafin-fe

# resource use
docker stats --no-stream

# shell inside a container
docker exec -it zeetafin-be sh
docker exec -it zeetafin-db psql -U postgres -d zeetafin
```

Containers carry `--restart unless-stopped`, so they come back after a host reboot. To stop
that behaviour temporarily (for maintenance), `docker update --restart no <container>`.

> The database container has **no published port**. `psql` only works via `docker exec` or
> from another container on `zeetafin-net`.

---

## Deploying an application change

The application code ships **in this repository**: the
`Application/Backend/ZeetaFin-BE/` and `Application/Frontend/ZeetaFin-FE/` trees are tracked
here, are the source of truth, and `setup-docker.sh` uploads them to `~/zeetafin/` on the host.

The clean way — re-upload and rebuild in one step:

```bash
# 1. edit the code locally, then bump the revision marker
#    in Infrastructure/terraform.tfvars
app_source_revision = "2"

# 2. apply: the trigger changes, so the bootstrap re-uploads and rebuilds
terraform -chdir=Infrastructure apply
```

`deploy.sh` recreates the containers and waits for the database before starting the backend.
Downtime is the couple of seconds between `docker rm -f` and the new container being up.

### Skipping the full re-upload

To rebuild after changing only a few files, copy them up directly:

```bash
scp -i ~/.ssh/id_ed25519 -r Application/Backend/ZeetaFin-BE/src \
  ubuntu@<ip>:~/zeetafin/ZeetaFin-BE/
ssh -i ~/.ssh/id_ed25519 ubuntu@<ip> \
  'docker build -t zeetafin-be:latest ~/zeetafin/ZeetaFin-BE && ~/zeetafin/deploy.sh'
```

Bumping `app_source_revision` is what keeps Terraform's view aligned with what is actually
running, so prefer the apply path; the ad-hoc `scp` path does not update the revision.

### If the change is in the infrastructure, not the app

Edit the file under `Infrastructure/` (or `Application/`), then:

```bash
terraform -chdir=Infrastructure apply
```

`bootstrap.tf` hashes `setup-docker.sh`, `deploy.sh` and `nginx.cfg`, and also watches
`app_source_revision`, so a change to any of them re-runs the whole bootstrap.

---

## Rolling back

There is no image history on the host beyond what you tag by hand, and no automatic
rollback. Two options:

**By tag (recommended — tag before every deploy):**

```bash
# before deploying, keep the previous build
docker tag zeetafin-be:latest zeetafin-be:previous

# to roll back
docker tag zeetafin-be:previous zeetafin-be:latest
./deploy.sh
```

**By source revision:**

Keep the application under version control **locally**. To roll back, check out the
known-good revision in `Application/`, bump `app_source_revision`, and re-apply:

```bash
cd Application/Backend/ZeetaFin-BE && git checkout <known-good-sha> && cd -
# bump app_source_revision in Infrastructure/terraform.tfvars
terraform -chdir=Infrastructure apply
```

There is no git history on the host — the source is whatever you last uploaded.

The ECR copy of an older build is the durable rollback source: `docker pull <repo>:backend@<digest>`
restores a specific image regardless of local state.

---

## Database operations

The data lives in the `zeetafin-pgdata` Docker volume on the root disk. **It is deleted by
`terraform destroy` and by replacing the instance.** Snapshot or dump before either.

### Backup

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<ip>

# logical dump to a file on the host
docker exec zeetafin-db pg_dump -U postgres zeetafin | gzip > ~/zeetafin-$(date +%F).sql.gz

# pull it to your workstation
scp -i ~/.ssh/id_ed25519 ubuntu@<ip>:~/zeetafin-$(date +%F).sql.gz .
```

### Restore

```bash
gunzip -c zeetafin-2026-01-01.sql.gz | ssh -i ~/.ssh/id_ed25519 ubuntu@<ip> \
  'docker exec -i zeetafin-db psql -U postgres -d zeetafin'
```

### Interactive

```bash
docker exec -it zeetafin-db psql -U postgres -d zeetafin
\dt                 # list tables
\du                 # list roles
SELECT count(*) FROM users;
```

### The seed user

The backend's entrypoint runs `seed.ts` on every boot and creates a
`FINANCE_ADMIN` user if it does not exist:

| Field | Value |
|---|---|
| Email | `admin@zeeta.com` |
| Password | `admin123` |
| Name | Admin User |
| Role | `FINANCE_ADMIN` |

If a re-deploy unexpectedly recreates a deleted user, that is why. **Change this password
immediately after the first login** — it is a known, published default and the schema
synchronises on boot (`synchronize: true`), so the seed will re-create the account whenever
it is missing.

An EBS snapshot is the volume-level backup and is strictly better for a real deployment:

```bash
aws ec2 create-snapshot --volume-id <vol-id> --description "zeetafin pre-change"
```

---

## TLS certificate operations

certbot's systemd timer renews certificates automatically and reloads nginx on success.

```bash
# what exists, and when it expires
sudo certbot certificates

# dry-run the renewal path (safe, no rate-limit cost)
sudo certbot renew --dry-run

# force a renewal now
sudo certbot renew --force-renewal

# after any manual nginx.conf edit
sudo nginx -t && sudo systemctl reload nginx

# the timer
systemctl list-timers | grep certbot
```

### If a renewal leaves nginx down

`certbot renew` runs `nginx -t` before reloading and refuses to reload a broken config, so a
renewal cannot itself break the site — but a hand-edited config can. Check:

```bash
sudo nginx -t
sudo journalctl -u certbot --since "24 hours ago"
sudo tail -50 /var/log/letsencrypt/letsencrypt.log
```

See [KI-04](KNOWN-ISSUES.md#ki-04) for the renewal edge case.

---

## DNS operations

The public name `zeetafin.duckdns.org` must resolve to the host's public IP.

**If `duckdns_token` is set**, the bootstrap updates the record automatically. To update it
by hand at any time (e.g. after replacing the host):

```bash
IP=$(terraform -chdir=Infrastructure output -raw server_public_ip)
curl "https://www.duckdns.org/update?domains=zeetafin&token=<TOKEN>&ip=$IP"
# -> OK
```

**If no token is set**, update the record in the [DuckDNS](https://www.duckdns.org) console.
Then confirm propagation:

```bash
dig +short zeetafin.duckdns.org     # must equal the server_public_ip output
```

> A stale DNS record breaks certificate renewal even though the site keeps working on the
> current certificate. See [KI-03](KNOWN-ISSUES.md#ki-03).

---

## Rotating secrets and credentials

### PostgreSQL password / JWT secret

Both live in `~/zeetafin/.env` (`0600`).

> The bootstrap **preserves** `.env` across re-runs — secrets are generated only on a fresh
> host — so a normal re-apply will **not** rotate them. Run `setup-docker.sh -f` to
> force-regenerate both, or rotate in place as below.

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<ip>
cd ~/zeetafin

# rotate the JWT secret (invalidates all sessions)
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env

# rotate the database password as well
NEW_DB_PW=$(openssl rand -hex 24)
docker exec zeetafin-db psql -U postgres -c "ALTER USER postgres PASSWORD '$NEW_DB_PW';"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_DB_PW/" .env

./deploy.sh
```

Order matters when rotating the DB password: change it in PostgreSQL **first**, then in
`.env`, then redeploy, so the backend restart picks up the new value.

### EC2 key pair

```bash
ssh-keygen -t ed25519 -a 100 -C "zeetafin-rotated" -f ~/.ssh/id_ed25519_new
# point public_key_file at the new .pub, then:
terraform -chdir=Infrastructure apply            # rotates the EC2 key pair
```

Changing the key pair does **not** touch the instance, but the AMI instance already has the
old public key in `authorized_keys` — updating the key pair in AWS does not update a running
instance. Rotate in place instead:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_new.pub ubuntu@<ip>   # adds the new key, keeps the old
```

### AWS credentials used for the ECR push

`aws configure` on the host writes long-lived keys to `~/.aws/credentials`. Prefer not to
use it (see [SECURITY.md](SECURITY.md)). If you did:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<ip>
aws configure          # re-enter, or:
rm -f ~/.aws/credentials && aws configure    # clear and re-do
```

---

## Replacing the host

Any change to `instance_type`, `ami`, or `root_block_device` forces replacement. The new
host is a blank Ubuntu instance and the bootstrap runs from scratch, which means:

1. **A new public IP.** Update DuckDNS (or rely on the token).
2. **An empty database.** The `zeetafin-pgdata` volume was on the old root disk. Restore
   from a dump or snapshot.

```bash
# 0. back up first
docker exec zeetafin-db pg_dump -U postgres zeetafin | gzip > backup.sql.gz

# 1. change e.g. instance_type in terraform.tfvars
terraform -chdir=Infrastructure apply

# 2. restore the data
gunzip -c backup.sql.gz | ssh -i ~/.ssh/id_ed25519 ubuntu@<new-ip> \
  'docker exec -i zeetafin-db psql -U postgres -d zeetafin'
```

To force a fresh host without changing the config:

```bash
terraform -chdir=Infrastructure apply -replace=aws_instance.docker
```

---

## Scaling the host

This stack is single-host by design. Vertical scaling is a one-line change:

```hcl
instance_type = "t3.large"    # 2 vCPU / 8 GiB, for a bigger Docker build
```

`terraform apply` replaces the host — see [Replacing the host](#replacing-the-host). Horizontal
scaling is out of scope: there is no load balancer, no shared database and no session store.
See [ARCHITECTURE.md](ARCHITECTURE.md#what-this-architecture-deliberately-does-not-do).

---

## Logs, health checks and metrics

There is **no monitoring stack**. The available signals are:

| Signal | Command |
|---|---|
| Container status | `docker ps` |
| Backend log | `docker logs zeetafin-be` |
| Frontend log | `docker logs zeetafin-fe` |
| Database log | `docker logs zeetafin-db` |
| nginx access/error | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |
| TLS renewal | `sudo journalctl -u certbot` |
| Host resources | `htop`, `df -h`, `free -m`, `docker stats` |
| Instance health (AWS) | `aws ec2 describe-instance-status --instance-ids <id>` |

A minimal external check (from your workstation or a cron job):

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://zeetafin.duckdns.org/api/
```

`200` is healthy. Treat non-`200` and certificate-expiry (`openssl s_client`) as the two
alerts worth wiring up first. CloudWatch alarms and an uptime monitor are the obvious
additions; they are not part of this build.

---

## Terraform state operations

The state lives in S3 (`docker77-terraform-state`), locked with `use_lockfile`.

```bash
terraform -chdir=Infrastructure state list          # 10 resources
terraform -chdir=Infrastructure state show aws_instance.docker
terraform -chdir=Infrastructure output -json
```

### Back up state

```bash
aws s3 cp s3://docker77-terraform-state/terraform.tfstate ./tfstate-backup-$(date +%F).json
```

S3 versioning on the bucket means previous states are recoverable even without a manual copy.

### If a lock is stuck

`use_lockfile` writes `.tflock` next to the state. If a run died mid-apply:

```bash
terraform -chdir=Infrastructure force-unlock <LOCK-ID>   # the ID the error printed
```

### Importing a resource created by hand

```bash
terraform -chdir=Infrastructure import aws_instance.docker i-0abc123…
terraform -chdir=Infrastructure import aws_ecr_repository.zeetafin 7/zeetafin
```

### The bootstrap resource

`terraform_data.bootstrap` is not infrastructure; it is a trigger. If it drifts or you need
it to re-run:

```bash
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap
```

---

## Applying a bootstrap change

| File changed | What to run |
|---|---|
| `Infrastructure/*.tf` | `terraform fmt && terraform -chdir=Infrastructure apply` |
| `Infrastructure/setup-docker.sh` | `terraform -chdir=Infrastructure apply` (the `filesha256` trigger re-runs it) |
| `Application/deploy.sh` / `Application/nginx.cfg` | `terraform -chdir=Infrastructure apply` |
| Application source (local `Application/` tree) | bump `app_source_revision` then `terraform -chdir=Infrastructure apply` (see [Deploying an application change](#deploying-an-application-change)) |
| `terraform.tfvars` | `terraform -chdir=Infrastructure apply` (review the plan first) |

Before applying, always:

```bash
terraform fmt -check -recursive
terraform -chdir=Infrastructure validate
terraform -chdir=Infrastructure plan
```

---

## Teardown

```bash
# tear down the stack (instance, ECR, networking)
terraform -chdir=Infrastructure destroy

# tear down the state bucket too (destructive, irreversible)
cd remote_state && terraform destroy
```

`terraform destroy` removes the ECR repository even with images in it
(`force_delete = true`) and deletes the root disk with the `zeetafin-pgdata` volume. **Back
up the database first.**

Confirm nothing is still billing:

```bash
aws ec2 describe-instances --filters "Name=tag:Name,Values=Docker-*" \
  --query 'Reservations[].Instances[].State.Name'
aws ecr describe-repositories --query 'repositories[].repositoryName'
```

---

## Runbook index

| I want to… | Section |
|---|---|
| Log into the host | [Accessing the host](#accessing-the-host) |
| Fix "SSH refused" | [Accessing the host](#accessing-the-host) |
| See what is running | [Container lifecycle](#container-lifecycle) |
| Deploy a code change | [Deploying an application change](#deploying-an-application-change) |
| Undo a bad deploy | [Rolling back](#rolling-back) |
| Back up / restore the DB | [Database operations](#database-operations) |
| Renew or debug TLS | [TLS certificate operations](#tls-certificate-operations) |
| Point DNS at a new IP | [DNS operations](#dns-operations) |
| Rotate the DB/JWT secret | [Rotating secrets and credentials](#rotating-secrets-and-credentials) |
| Change instance type | [Scaling the host](#scaling-the-host) |
| Force a fresh host | [Replacing the host](#replacing-the-host) |
| Recover terraform state | [Terraform state operations](#terraform-state-operations) |
| Destroy everything | [Teardown](#teardown) |

---

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) — the initial build.
- [SECURITY.md](SECURITY.md) — why the manual steps stay manual.
- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — the defects behind several of these runbooks.
- [COST.md](COST.md) — deciding when to tear down.
