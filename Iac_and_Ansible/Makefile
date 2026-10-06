# Convenience targets. Requires GNU make and Terraform on PATH.
# Nothing here is required — every target is a thin wrapper around a documented
# command. See docs/DEPLOYMENT.md for the full manual procedure.

SHELL       := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

TF          := terraform
TF_DIR      := infrastructure
TFSTATE_DIR := remote_state
SCRIPT      := $(TF_DIR)/setup-ansible.sh
PLAYBOOK    := $(TF_DIR)/docker.yml

MASTER_IP   := $(shell $(TF) -chdir=$(TF_DIR) output -raw master_public_ip 2>/dev/null)
SSH_KEY     := $(shell $(TF) -chdir=$(TF_DIR) output -raw private_key_file 2>/dev/null || echo ~/.ssh/id_ed25519)

# ssh_user is an input variable, not an output, so it cannot be read back from
# Terraform state. Override on the command line if you changed it:
#   make playbook SSH_USER=ec2-user
SSH_USER    ?= ubuntu

# Remove the leading ~ so it can be passed to ssh -i
SSH_KEY_ABS := $(patsubst ~/.ssh/%,$(HOME)/.ssh/%,$(SSH_KEY))

.PHONY: help check fmt fmt-check validate plan apply destroy \
        bootstrap ssh workers playbook check-playbook \
        lint shellcheck ansible-lint tflint clean

## ─── Help ────────────────────────────────────────────────────────────────────

help: ## Show this help
	@echo "Cloud7 EC2 fleet — make targets"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "DANGER: 'apply', 'destroy' and 'bootstrap' change real AWS infrastructure."
	@echo "See docs/COST.md — a running fleet costs approximately USD 42/month."

## ─── Validate and lint ───────────────────────────────────────────────────────

check: fmt-check validate shellcheck ## Run every non-destructive check
	@echo "All checks passed."

fmt: ## Rewrite Terraform files with terraform fmt
	$(TF) fmt -recursive

fmt-check: ## Fail if any Terraform file is unformatted
	$(TF) fmt -check -recursive

validate: ## Validate both root modules without touching the backend
	$(TF) -chdir=$(TFSTATE_DIR) init -backend=false -input=false >/dev/null
	$(TF) -chdir=$(TFSTATE_DIR) validate
	$(TF) -chdir=$(TF_DIR)      init -backend=false -input=false >/dev/null
	$(TF) -chdir=$(TF_DIR)      validate

lint: tflint shellcheck ansible-lint ## Run all linters

tflint: ## Run tflint, if installed
	@command -v tflint >/dev/null 2>&1 \
		&& tflint --chdir=$(TF_DIR) --recursive \
		|| echo "tflint not installed, skipping"

shellcheck: ## Check the bootstrap script (bash syntax + shellcheck if available)
	bash -n $(SCRIPT)
	@command -v shellcheck >/dev/null 2>&1 \
		&& shellcheck $(SCRIPT) \
		|| echo "shellcheck not installed, syntax check only"

ansible-lint: ## Lint the playbook, if ansible-lint is installed
	@command -v ansible-lint >/dev/null 2>&1 \
		&& ansible-lint $(PLAYBOOK) \
		|| echo "ansible-lint not installed, skipping"

## ─── Plan and apply ──────────────────────────────────────────────────────────

plan: ## Show what would change (safe)
	$(TF) -chdir=$(TF_DIR) plan

apply: ## APPLY CHANGES — creates or destroys real infrastructure and costs money
	@printf '\n\033[1;31mDANGER\033[0m: this applies real changes and costs approximately USD 42/month.\n'
	@printf 'Type the word APPLY to continue, anything else aborts: '
	@read -r reply; [ "$$reply" = "APPLY" ] || { echo "Aborted."; exit 1; }
	$(TF) -chdir=$(TF_DIR) apply

destroy: ## DESTROY THE FLEET — irreversible except via state rollback
	@printf '\n\033[1;31mDANGER\033[0m: this destroys all three instances, the VPC and the security group.\n'
	@printf 'Type the word DESTROY to continue, anything else aborts: '
	@read -r reply; [ "$$reply" = "DESTROY" ] || { echo "Aborted."; exit 1; }
	$(TF) -chdir=$(TF_DIR) destroy

bootstrap: ## CREATE THE S3 STATE BUCKET — once per account and region
	@printf '\n\033[1;33mNOTE\033[0m: this creates the S3 bucket that the root module uses as its backend.\n'
	$(TF) -chdir=$(TFSTATE_DIR) init
	$(TF) -chdir=$(TFSTATE_DIR) apply

## ─── Operate ─────────────────────────────────────────────────────────────────

ssh: ## SSH to the Ansible control node
	@test -n "$(MASTER_IP)" || { echo "No master IP. Run 'make apply' first."; exit 1; }
	ssh -i "$(SSH_KEY_ABS)" "$(SSH_USER)@$(MASTER_IP)"

workers: ## List the worker private IPs
	@$(TF) -chdir=$(TF_DIR) output -json worker_private_ips \
		| python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)["value"]))'

playbook: ## Run docker.yml on the master (installs Docker on the workers)
	@test -n "$(MASTER_IP)" || { echo "No master IP. Run 'make apply' first."; exit 1; }
	ssh -i "$(SSH_KEY_ABS)" "$(SSH_USER)@$(MASTER_IP)" 'cd ~/ansible && ansible-playbook docker.yml'

check-playbook: ## Dry-run the playbook against the master
	@test -n "$(MASTER_IP)" || { echo "No master IP. Run 'make apply' first."; exit 1; }
	ssh -i "$(SSH_KEY_ABS)" "$(SSH_USER)@$(MASTER_IP)" \
		'cd ~/ansible && ansible-playbook docker.yml --check --diff'

## ─── Housekeeping ────────────────────────────────────────────────────────────

clean: ## Remove local artifacts. Never touches AWS.
	rm -f .master_ip
	rm -f $(TF_DIR)/tfplan $(TF_DIR)/tfplan.txt
	rm -rf $(TF_DIR)/.terraform/modules
	@echo "Local artifacts removed. Remote state in S3 was not touched."
