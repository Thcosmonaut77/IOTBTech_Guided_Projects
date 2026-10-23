# Operations

Day-2 tasks for the Phase 3 stack. Commands assume the project root unless noted.

---

## Status

```bash
# Pipeline
gh run list --workflow "Build, Push to ECR and Deploy to EC2" --limit 5
gh run view <run-id> --log

# Host
ssh -i ~/.ssh/id_ed25519 ubuntu@$(terraform -chdir=Infrastructure output -raw server_public_ip)
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
cd ~/zeetafin
cat .active_color .deployed_tag .last_good_tag .previous_tag 2>/dev/null
docker inspect --format '{{.Config.Image}}' "zeetafin-be-$(cat .active_color)"
docker logs --tail 80 "zeetafin-be-$(cat .active_color)"
sudo nginx -t && cat /etc/nginx/zeetafin-upstreams.conf
sudo certbot certificates
df -h /

# Site
curl -sI https://$(terraform -chdir=Infrastructure output -raw app_url | sed 's#https://##') | head -1
```

`docker inspect` is the quickest way to confirm which commit is actually running. It must
match the image tag in the last successful workflow. `.active_color` names the colour that
nginx currently points at, and only that colour's containers are running after a
successful deploy.

---

## Deploying a change

1. Edit the application under `Application/`.
2. Commit and push to `main`.
3. Watch the workflow.
4. Verify `docker inspect` shows the new SHA.

Every push to `main` triggers the pipeline, including Infrastructure-only changes. The
workflow still deploys the current application images. Apply Terraform separately:

```bash
terraform -chdir=Infrastructure plan
terraform -chdir=Infrastructure apply
```

`setup-docker.sh` re-runs only when one of its triggers changes: host IP, script contents,
`deploy.sh` contents, `nginx.cfg` contents or the domain. To force a re-run:

```bash
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap
```

---

## Rollback

### Automatic rollback

The workflow records the last externally verified tag in `~/zeetafin/.last_good_tag`. If
the host deploy succeeds but the runner's external health check fails, the workflow runs:

```bash
cd ~/zeetafin && bash deploy.sh --rollback
```

`--rollback` prefers `.last_good_tag`, falls back to `.previous_tag`, and otherwise does
nothing. It deploys that tag into the inactive colour, so the failed colour is left alone
and removed only after the rollback colour is healthy. No operator action is needed.

### Image rollback (manual)

Use a previous commit SHA that is still in ECR:

1. **Actions → Build, Push to ECR and Deploy to EC2 → Run workflow**.
2. Set `image_tag` to the previous SHA.
3. Run.

The `build-and-push` job is skipped by design, so the old tag is not overwritten. Only
`test` and `deploy` run.

Or from the host:

```bash
cd ~/zeetafin
AWS_REGION=eu-north-1 \
ECR_REGISTRY=<registry> \
ECR_REPOSITORY=7/zeetafin-ci \
bash deploy.sh --rollback
```

### Blue/green state files

`deploy.sh` keeps four dotfiles in `~/zeetafin`:

| File | Meaning |
|---|---|
| `.active_color` | `blue` or `green`; the colour nginx currently serves |
| `.deployed_tag` | Image tag of the active colour |
| `.previous_tag` | Tag that was active before the most recent deploy |
| `.last_good_tag` | Tag that last passed the external health check |

Deleting them does not break deployment; the script treats a missing `.active_color` as a
fresh install and starts on blue. Inspect them before diagnosing a stuck switch.

### Infrastructure rollback

Terraform has no versioned releases here. Revert the `.tf` change, plan, and apply. The
state bucket has S3 versioning; recovering an older state object is possible but is an
outage-level operation. Take a state backup first:

```bash
aws s3 cp s3://docker77-phase3-terraform-state/phase3/terraform.tfstate /tmp/tfstate.bak
```

### Database rollback

There is none. The database volume is not backed up. A bad migration or a `destroy`
loses the data. See [KI-04](KNOWN-ISSUES.md#ki-04). Add `pg_dump` to a cron job or a
managed database before storing anything important.

---

## Rotating secrets

### CI AWS role (OIDC)

There is no long-lived key to rotate. The role ARN changes only if the OIDC provider, the
role name or the repository/branch trust changes:

1. Apply the Terraform change that alters `github_oidc.tf` or its variables.
2. Update `AWS_ROLE_ARN` in GitHub Secrets with `terraform output -raw github_oidc_role_arn`.
3. Run a deployment to confirm.

No stored credential can leak, because none is stored.

### Pinned host key

`EC2_HOST_KEY` pins the host identity for the deploy job. Refresh it whenever the host is
replaced or the instance is rebuilt from a new key pair:

```bash
ssh-keyscan -H "$(terraform -chdir=Infrastructure output -raw server_public_ip)"
```

Replace the secret with the new line. A stale value fails the deploy with
`Host key verification failed` or `EC2_HOST_KEY does not cover`, which is intended: the
pipeline should not silently trust a new host.

### SSH key

1. Generate a new key pair.
2. Update `public_key_file` in `terraform.tfvars` and apply. Terraform replaces the EC2
   key pair (`key_name` change is a replacement of the key pair resource; confirm the plan).
3. Update `EC2_SSH_KEY` in GitHub Secrets.
4. Update your local `ssh` command.
5. Run a deployment to confirm.

The old public key stops working when the key pair is replaced. Do not delete the private
key until the new one is proven.

### Database password and JWT secret

This is **not** a one-step rotation. The existing Postgres volume stores the password hash,
and the running container has the old value.

1. Choose a maintenance window; the application will restart.
2. Generate new values.
3. Change the password inside Postgres with `ALTER USER`.
4. Update `~/zeetafin/.env`.
5. Run `deploy.sh` with the current `IMAGE_TAG` so the backend restarts with the new
   `DB_PASSWORD` and `JWT_SECRET`.
6. Rotating `JWT_SECRET` invalidates all sessions.

`setup-docker.sh -f` regenerates `.env` but does **not** change the password inside an
existing database. Use it only on a fresh volume.

### DuckDNS token

Update `duckdns_token` in `terraform.tfvars` and re-run the bootstrap. The token is passed
as a CLI argument today, so it is visible in the process list and Terraform logs; see
[KI-07](KNOWN-ISSUES.md#ki-07).

---

## Logs and diagnostics

| What | Command |
|---|---|
| Backend | `docker logs -f "zeetafin-be-$(cat ~/zeetafin/.active_color)"` |
| Frontend | `docker logs -f "zeetafin-fe-$(cat ~/zeetafin/.active_color)"` |
| Database | `docker logs -f zeetafin-db` |
| Upstreams | `cat /etc/nginx/zeetafin-upstreams.conf` |
| nginx | `sudo journalctl -u nginx -n 100 --no-pager` |
| nginx config | `sudo nginx -T` |
| TLS | `sudo certbot certificates` |
| Disk | `df -h /`; `docker system df` |
| Host boot | `sudo cloud-init status --long` |
| Workflow | `gh run view <id> --log` |

### Disk pressure

The host has a 20 GiB root disk. Docker images, logs and the database share it.

```bash
docker system df
docker image prune -f          # dangling images only
docker builder prune -f        # build cache, not used on the host in Phase 3
journalctl --disk-usage
sudo journalctl --vacuum-time=7d
```

Do not `docker system prune -a` on the host unless you accept pulling both images again.
The database volume is never touched by prune commands.

### Container keeps restarting

```bash
C="zeetafin-be-$(cat ~/zeetafin/.active_color)"
docker inspect --format '{{.State.ExitCode}} {{.State.Error}}' "$C"
docker logs --tail 200 "$C"
```

The most common cause is the backend starting before Postgres is ready. `deploy.sh` waits
for `pg_isready` before starting the backend, but a restart of the host starts containers
in an arbitrary order; the backend's entrypoint runs migrations and seeds with retries,
which usually covers it. If not, restart the backend after the database is healthy:

```bash
docker restart "$C"
```

---

## Updating the application dependencies

```bash
cd Application/Backend/ZeetaFin-BE
npm install <package>          # updates package.json and package-lock.json
npm run build                  # optional local check

cd ../../Frontend/ZeetaFin-FE
npm install <package>
npm run build
```

Commit both `package.json` and `package-lock.json`. The Dockerfiles use `npm ci`, which
fails when the lockfile is out of sync. The pipeline builds and deploys automatically.

Do not run `npm install` on the host. CI owns the build.

---

## Replacing the host

Changing `instance_type`, the AMI or the subnet replaces the instance. The root disk,
database and `.env` are lost. The new host gets a new public IP, so `EC2_HOST` and the
DuckDNS record must be updated. `APP_BASE_URL` (the hostname) does not change.

```bash
# 1. Back up the database first (see below)
# 2. Apply the replacement
terraform -chdir=Infrastructure apply

# 3. Update the EC2_HOST GitHub secret
# 4. Re-point DNS if not using the DuckDNS token
terraform -chdir=Infrastructure apply -replace=terraform_data.bootstrap

# 5. Run the workflow to deploy
```

### Backing up the database

Create a dump from the running container:

```bash
ssh ubuntu@<host> \
  "docker exec zeetafin-db pg_dump -U postgres zeetafin" > zeetafin-$(date +%F).sql
```

Restore into a fresh volume:

```bash
cat zeetafin-YYYY-MM-DD.sql | ssh ubuntu@<host> \
  "docker exec -i zeetafin-db psql -U postgres -d zeetafin"
```

This is a manual procedure. Nothing schedules it.

---

## Scaling

This stack is single-host by design. `t3.medium` is the default. `t3.small` is usually
enough now that CI builds the images; the host only pulls and runs them.

Vertical scaling means `instance_type` change, which replaces the host and loses the
database unless it is backed up. Horizontal scaling needs a load balancer, multiple hosts,
a shared database and a shared session/JWT strategy. None of that exists here.

---

## Teardown

```bash
terraform -chdir=Infrastructure destroy
terraform -chdir=remote_state destroy
```

Order matters: destroy the main module before the state bucket. `force_delete = true` on
the ECR repository lets Terraform remove images with the repository. The instance root
volume and database are deleted with the instance.

If destroy fails on the S3 bucket because it is not empty:

```bash
aws s3 rm s3://docker77-phase3-terraform-state --recursive
terraform -chdir=remote_state destroy
```

Check for leftovers:

```bash
aws ec2 describe-instances --filters "Name=tag:Name,Values=DockerCI-Server" \
  --query 'Reservations[].Instances[].State.Name'
aws ecr describe-repositories --query 'repositories[?contains(repositoryName, `zeetafin`)]'
```

---

## Cost control

The stack costs roughly $39/month at `t3.medium` running 24×7. To stop spending without
losing the database, stop the instance instead of destroying it:

```bash
aws ec2 stop-instances --instance-ids $(terraform -chdir=Infrastructure output -raw instance_id)
```

A stopped instance keeps the EBS volume billed (≈ $1.76/month) but not the compute. The
public IP changes on start, so `EC2_HOST`, DNS and the certificate may need attention.

See [README.md § Cost](../README.md#cost).
