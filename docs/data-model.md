# Data model

Source of truth: `artifacts/app/prisma/schema.prisma`. This document explains the two layers,
conventions, and the ERD.

## Conventions

- **Money** is integer cents in `Int` (Postgres `integer`, ±$21,474,836.47 per row). Parsing
  never goes through floats (`src/domain/money.ts`).
- **Percentages** are integer basis points: `10000 = 100%`.
- **Dates** (`txnDate`, grant dates, effective ranges) are Postgres `DATE`, handled as UTC
  midnight in code.
- **Every table carries `orgId`.** MVP runs as a single org.
- **Sign convention for `TransactionLine.amountCents`:** the *natural* amount for the account's
  type. An expense line is positive when it increases expense (a debit), an income line is
  positive when it increases income (a credit). A credit to an expense account (refund /
  reversal) is therefore negative. `postingType` preserves the raw debit/credit side so the
  original journal can always be reconstructed: `debit` on Expense/Asset/COGS/OtherExpense →
  positive; `credit` on those → negative; the reverse for Income/Liability/Equity/OtherIncome.

## Layer A — source mirror (read-only to the app)

Populated only by `ImportService` through a `DataSource` adapter (CSV today, QBO later). Rows are
never edited in the UI. Changed source rows are versioned in `SourceRowVersion`; removed rows are
soft-deleted with `deletedAt` (see story 12). Unique key: `(orgId, sourceSystem, externalId)`.

`ImportBatch → Account | TrackingClass | TrackingLocation | Party | Transaction → TransactionLine`

`TransactionLine` is the atomic unit; everything derived points back to it.

## Layer B — overlay (user-owned) and materialized output

- `Program`, `Grant`, `GrantProgram`, `GrantBudgetLine` — configuration.
- `CrosswalkRule` — maps source lines to a `GrantBudgetLine` (first match by priority).
- `AllocationRule` + `AllocationTarget` — splits a matched pool across programs / budget lines.
- `ComputeRun` + `AllocatedLine` — output of the engine. Invariant (enforced by
  `assertAllocationBalanced(runId)`): for each source line, Σ `AllocatedLine.amountCents` equals
  `TransactionLine.amountCents` exactly. Splits use largest-remainder rounding, ties to the
  lowest target `sortOrder` (`src/domain/split.ts`).
- `AuditEvent` — before/after JSON for every overlay mutation.
- `PeriodLock`, `SavedView`, `Narrative` — see stories 09, 08, 10.

### Delete semantics

- Overlay → source: **never cascades.** `AllocatedLine.sourceLineId`, `Account`, etc. are
  `onDelete: Restrict`. Deleting a `ComputeRun` deletes only its `AllocatedLine`s.
- Source: `ImportBatch` cannot be deleted while any mirrored row references it (FK Restrict), and
  `assertImportBatchDeletable()` additionally refuses if a succeeded/superseded `ComputeRun`
  lists it in `sourceBatchIds`.
- `Grant` delete cascades to its budget lines / grant-programs / narratives, but is blocked
  (Restrict) if any `AllocatedLine` references it — recompute first or archive instead.

## ERD

```mermaid
erDiagram
  Org ||--o{ ImportBatch : has

  ImportBatch ||--o{ Account : imports
  ImportBatch ||--o{ TrackingClass : imports
  ImportBatch ||--o{ TrackingLocation : imports
  ImportBatch ||--o{ Party : imports
  ImportBatch ||--o{ Transaction : imports
  ImportBatch ||--o{ SourceRowVersion : records

  Transaction ||--|{ TransactionLine : contains
  Party o|--o{ Transaction : "header party"
  Account ||--o{ TransactionLine : posts_to
  TrackingClass o|--o{ TransactionLine : tagged
  TrackingLocation o|--o{ TransactionLine : tagged
  Party o|--o{ TransactionLine : "line party"

  Grant ||--o{ GrantProgram : funds
  Program ||--o{ GrantProgram : funded_by
  Grant ||--|{ GrantBudgetLine : budgets
  Program o|--o{ GrantBudgetLine : default_program

  GrantBudgetLine ||--o{ CrosswalkRule : target
  AllocationRule ||--|{ AllocationTarget : splits_to
  Program o|--o{ AllocationTarget : target
  GrantBudgetLine o|--o{ AllocationTarget : target

  ComputeRun ||--o{ AllocatedLine : produces
  TransactionLine ||--o{ AllocatedLine : source
  AllocationRule o|--o{ AllocatedLine : via
  CrosswalkRule o|--o{ AllocatedLine : via
  Program o|--o{ AllocatedLine : to
  Grant o|--o{ AllocatedLine : to
  GrantBudgetLine o|--o{ AllocatedLine : to

  ComputeRun ||--o{ PeriodLock : locks
  ComputeRun ||--o{ Narrative : basis
  Grant ||--o{ Narrative : about

  Account {
    string id PK
    string orgId
    enum sourceSystem
    string externalId
    string number
    string name
    enum type
  }
  TransactionLine {
    string id PK
    string transactionId FK
    int lineNumber
    string accountId FK
    string classId FK
    string locationId FK
    string partyId FK
    int amountCents
    enum postingType
  }
  Grant {
    string id PK
    string name
    string funder
    date startDate
    date endDate
    int awardAmountCents
    enum restrictionType
    enum status
  }
  GrantBudgetLine {
    string id PK
    string grantId FK
    string code
    string name
    int budgetCents
    string programId FK
    int sortOrder
  }
  AllocationRule {
    string id PK
    json matchers
    enum method
    string driverKey
    int priority
    date effectiveFrom
    date effectiveTo
  }
  AllocationTarget {
    string id PK
    string allocationRuleId FK
    int sortOrder
    string programId FK
    string grantBudgetLineId FK
    int shareBps
  }
  AllocatedLine {
    string id PK
    string computeRunId FK
    string sourceLineId FK
    int pieceIndex
    string programId FK
    string grantId FK
    string grantBudgetLineId FK
    int amountCents
    enum status
  }
  ComputeRun {
    string id PK
    string configHash
    string[] sourceBatchIds
    enum status
    json warnings
    boolean isCurrent
  }
```
