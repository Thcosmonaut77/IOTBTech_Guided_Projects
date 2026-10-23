import { MigrationInterface, QueryRunner } from 'typeorm';

// Baseline schema for a fresh Phase 3 database. It uses IF NOT EXISTS so the
// same migration can also baseline a database that was created by the old
// TypeORM synchronize setting. New schema changes must be separate migrations.
const UP: string[] = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  `DO $$ BEGIN
    CREATE TYPE "users_role_enum" AS ENUM (
      'finance_admin', 'accountant', 'ap_officer', 'ar_officer',
      'treasury_officer', 'financial_controller', 'auditor'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "email" character varying NOT NULL,
    "password" character varying NOT NULL,
    "firstName" character varying NOT NULL,
    "lastName" character varying NOT NULL,
    "role" "users_role_enum" NOT NULL DEFAULT 'accountant',
    "isActive" boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_users_email" UNIQUE ("email"),
    CONSTRAINT "PK_users" PRIMARY KEY ("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "chart_of_accounts_type_enum" AS ENUM (
      'asset', 'liability', 'equity', 'revenue', 'expense'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "chart_of_accounts_subType_enum" AS ENUM (
      'current_asset', 'non_current_asset', 'current_liability',
      'non_current_liability', 'shareholders_equity', 'operating_revenue',
      'operating_expense', 'other_income', 'other_expense'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "code" character varying NOT NULL,
    "name" character varying NOT NULL,
    "type" "chart_of_accounts_type_enum" NOT NULL,
    "subType" "chart_of_accounts_subType_enum",
    "parentId" character varying,
    "isActive" boolean NOT NULL DEFAULT true,
    "description" text,
    "balance" numeric(15,2) NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_chart_of_accounts_code" UNIQUE ("code"),
    CONSTRAINT "PK_chart_of_accounts" PRIMARY KEY ("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "journal_entries_status_enum" AS ENUM (
      'draft', 'posted', 'approved', 'rejected'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "entryNumber" character varying NOT NULL,
    "entryDate" date NOT NULL,
    "description" text,
    "status" "journal_entries_status_enum" NOT NULL DEFAULT 'draft',
    "totalDebit" numeric(15,2) NOT NULL DEFAULT 0,
    "totalCredit" numeric(15,2) NOT NULL DEFAULT 0,
    "approvedById" character varying,
    "approvedAt" timestamp,
    "createdById" character varying NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_journal_entries_entryNumber" UNIQUE ("entryNumber"),
    CONSTRAINT "PK_journal_entries" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "journal_entry_lines" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "journalEntryId" character varying NOT NULL,
    "accountId" character varying NOT NULL,
    "debit" numeric(15,2) NOT NULL,
    "credit" numeric(15,2) NOT NULL,
    "description" text,
    CONSTRAINT "PK_journal_entry_lines" PRIMARY KEY ("id"),
    CONSTRAINT "FK_journal_entry_lines_entry" FOREIGN KEY ("journalEntryId")
      REFERENCES "journal_entries"("id"),
    CONSTRAINT "FK_journal_entry_lines_account" FOREIGN KEY ("accountId")
      REFERENCES "chart_of_accounts"("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "userId" character varying NOT NULL,
    "action" character varying NOT NULL,
    "entity" character varying NOT NULL,
    "entityId" character varying NOT NULL,
    "changes" jsonb,
    "ipAddress" character varying(45),
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "vendors" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "vendorCode" character varying NOT NULL,
    "name" character varying NOT NULL,
    "contactPerson" character varying,
    "email" character varying,
    "phone" character varying,
    "address" character varying,
    "taxId" character varying,
    "outstandingBalance" numeric(15,2) NOT NULL DEFAULT 0,
    "isActive" boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_vendors_vendorCode" UNIQUE ("vendorCode"),
    CONSTRAINT "PK_vendors" PRIMARY KEY ("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "ap_invoices_status_enum" AS ENUM (
      'draft', 'pending', 'approved', 'paid', 'cancelled'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "ap_invoices" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "invoiceNumber" character varying NOT NULL,
    "vendorId" character varying NOT NULL,
    "invoiceDate" date NOT NULL,
    "dueDate" date NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "paidAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "outstandingAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "status" "ap_invoices_status_enum" NOT NULL DEFAULT 'pending',
    "description" text,
    "approvedById" character varying,
    "approvedAt" timestamp,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_ap_invoices_invoiceNumber" UNIQUE ("invoiceNumber"),
    CONSTRAINT "PK_ap_invoices" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ap_invoices_vendor" FOREIGN KEY ("vendorId")
      REFERENCES "vendors"("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "ap_payments" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "invoiceId" character varying NOT NULL,
    "paymentDate" date NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "referenceNumber" character varying,
    "notes" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_ap_payments" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ap_payments_invoice" FOREIGN KEY ("invoiceId")
      REFERENCES "ap_invoices"("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "customers" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "customerCode" character varying NOT NULL,
    "name" character varying NOT NULL,
    "contactPerson" character varying,
    "email" character varying,
    "phone" character varying,
    "address" character varying,
    "outstandingBalance" numeric(15,2) NOT NULL DEFAULT 0,
    "isActive" boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_customers_customerCode" UNIQUE ("customerCode"),
    CONSTRAINT "PK_customers" PRIMARY KEY ("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "ar_invoices_status_enum" AS ENUM (
      'draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "ar_invoices" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "invoiceNumber" character varying NOT NULL,
    "customerId" character varying NOT NULL,
    "invoiceDate" date NOT NULL,
    "dueDate" date NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "paidAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "outstandingAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "status" "ar_invoices_status_enum" NOT NULL DEFAULT 'draft',
    "description" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_ar_invoices_invoiceNumber" UNIQUE ("invoiceNumber"),
    CONSTRAINT "PK_ar_invoices" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ar_invoices_customer" FOREIGN KEY ("customerId")
      REFERENCES "customers"("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "ar_credit_notes" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "creditNoteNumber" character varying NOT NULL,
    "invoiceId" character varying NOT NULL,
    "creditNoteDate" date NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "reason" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_ar_credit_notes_creditNoteNumber" UNIQUE ("creditNoteNumber"),
    CONSTRAINT "PK_ar_credit_notes" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ar_credit_notes_invoice" FOREIGN KEY ("invoiceId")
      REFERENCES "ar_invoices"("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "ar_receipts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "invoiceId" character varying NOT NULL,
    "receiptDate" date NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "referenceNumber" character varying,
    "notes" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_ar_receipts" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ar_receipts_invoice" FOREIGN KEY ("invoiceId")
      REFERENCES "ar_invoices"("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "budgets_status_enum" AS ENUM (
      'draft', 'pending', 'approved', 'rejected'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "budgets" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "name" character varying NOT NULL,
    "fiscalYear" integer NOT NULL,
    "department" character varying,
    "totalAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "status" "budgets_status_enum" NOT NULL DEFAULT 'draft',
    "approvedById" character varying,
    "approvedAt" timestamp,
    "notes" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_budgets" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "budget_lines" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "budgetId" character varying NOT NULL,
    "accountId" character varying NOT NULL,
    "plannedAmount" numeric(15,2) NOT NULL,
    "actualAmount" numeric(15,2) NOT NULL DEFAULT 0,
    "variance" numeric(15,2) NOT NULL DEFAULT 0,
    "notes" text,
    CONSTRAINT "PK_budget_lines" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "bank_accounts" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "accountName" character varying NOT NULL,
    "accountNumber" character varying NOT NULL,
    "bankName" character varying,
    "branch" character varying,
    "currentBalance" numeric(15,2) NOT NULL DEFAULT 0,
    "currency" character varying,
    "isActive" boolean NOT NULL DEFAULT true,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_bank_accounts_accountNumber" UNIQUE ("accountNumber"),
    CONSTRAINT "PK_bank_accounts" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "cash_transactions" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "bankAccountId" character varying NOT NULL,
    "transactionDate" date NOT NULL,
    "type" character varying NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "category" character varying,
    "referenceNumber" character varying,
    "description" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_cash_transactions" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "bank_reconciliation" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "bankAccountId" character varying NOT NULL,
    "statementDate" date NOT NULL,
    "statementBalance" numeric(15,2) NOT NULL,
    "systemBalance" numeric(15,2) NOT NULL,
    "difference" numeric(15,2) NOT NULL,
    "reconcilingItems" jsonb,
    "isReconciled" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "PK_bank_reconciliation" PRIMARY KEY ("id")
  )`,

  `DO $$ BEGIN
    CREATE TYPE "fixed_assets_depreciationMethod_enum" AS ENUM (
      'straight_line', 'declining_balance'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "fixed_assets_status_enum" AS ENUM (
      'active', 'disposed', 'under_maintenance'
    );
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "fixed_assets" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "assetCode" character varying NOT NULL,
    "name" character varying NOT NULL,
    "category" character varying,
    "location" character varying,
    "purchaseDate" date NOT NULL,
    "purchaseCost" numeric(15,2) NOT NULL,
    "accumulatedDepreciation" numeric(15,2) NOT NULL DEFAULT 0,
    "netBookValue" numeric(15,2) NOT NULL DEFAULT 0,
    "usefulLifeYears" integer,
    "depreciationMethod" "fixed_assets_depreciationMethod_enum" NOT NULL DEFAULT 'straight_line',
    "status" "fixed_assets_status_enum" NOT NULL DEFAULT 'active',
    "disposedAt" timestamp,
    "disposalProceeds" numeric(15,2),
    "notes" text,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_fixed_assets_assetCode" UNIQUE ("assetCode"),
    CONSTRAINT "PK_fixed_assets" PRIMARY KEY ("id")
  )`,
];

const DOWN: string[] = [
  `DROP TABLE IF EXISTS "fixed_assets" CASCADE`,
  `DROP TABLE IF EXISTS "bank_reconciliation" CASCADE`,
  `DROP TABLE IF EXISTS "cash_transactions" CASCADE`,
  `DROP TABLE IF EXISTS "bank_accounts" CASCADE`,
  `DROP TABLE IF EXISTS "budget_lines" CASCADE`,
  `DROP TABLE IF EXISTS "budgets" CASCADE`,
  `DROP TABLE IF EXISTS "ar_receipts" CASCADE`,
  `DROP TABLE IF EXISTS "ar_credit_notes" CASCADE`,
  `DROP TABLE IF EXISTS "ar_invoices" CASCADE`,
  `DROP TABLE IF EXISTS "customers" CASCADE`,
  `DROP TABLE IF EXISTS "ap_payments" CASCADE`,
  `DROP TABLE IF EXISTS "ap_invoices" CASCADE`,
  `DROP TABLE IF EXISTS "vendors" CASCADE`,
  `DROP TABLE IF EXISTS "audit_logs" CASCADE`,
  `DROP TABLE IF EXISTS "journal_entry_lines" CASCADE`,
  `DROP TABLE IF EXISTS "journal_entries" CASCADE`,
  `DROP TABLE IF EXISTS "chart_of_accounts" CASCADE`,
  `DROP TABLE IF EXISTS "users" CASCADE`,
  `DROP TYPE IF EXISTS "fixed_assets_status_enum"`,
  `DROP TYPE IF EXISTS "fixed_assets_depreciationMethod_enum"`,
  `DROP TYPE IF EXISTS "budgets_status_enum"`,
  `DROP TYPE IF EXISTS "ar_invoices_status_enum"`,
  `DROP TYPE IF EXISTS "ap_invoices_status_enum"`,
  `DROP TYPE IF EXISTS "journal_entries_status_enum"`,
  `DROP TYPE IF EXISTS "chart_of_accounts_subType_enum"`,
  `DROP TYPE IF EXISTS "chart_of_accounts_type_enum"`,
  `DROP TYPE IF EXISTS "users_role_enum"`,
];

export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of UP) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of DOWN) {
      await queryRunner.query(statement);
    }
  }
}
