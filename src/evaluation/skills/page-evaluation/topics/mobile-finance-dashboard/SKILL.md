---
name: mobile-finance-dashboard-eval
description: Evaluate mobile finance dashboards with one authoritative transaction source, month/search/filter linkage, accessible detail drawers, note write-back, guarded transfers, card selection consistency, derived chart/stat updates, and persistence.
---

# Mobile Finance Dashboard Eval Skill

Use this skill for `frontenjoyai-020` and similar personal-finance dashboards.

Treat the task and `criteria` as the scoring contract. Reference copy, classes, storage keys, and component names are optional probes, never mandatory implementation names.

Default method: Playwright at the intended mobile viewport plus direct localStorage and DOM/SVG inspection. Every pass about totals, charts, budgets, or transfers needs a before/after transaction ledger, not only screenshots.

## Evidence Anchors

The GPT-5.6 reference provides these optional stable probes:

- search placeholder `搜索商户、分类或备注`, `.month-select select`, the `交易类型筛选` group, `.transaction-row`, and the result-count text;
- `账户总览`, `.summary-grid`, chart images named `本月支出趋势图` and income/expense cash-flow labels, `.category-row`, `.budget-row`, and `即将扣款`;
- the `选择银行卡` tablist, current-card reveal button, `转账` action, `交易详情`/`发起转账` dialogs, and field placeholders;
- persisted transactions and preferences, using the localStorage keys discovered from the candidate.

Use equivalent handles elsewhere. The reference exposes no authoritative browser debug state, so derive expected values from persisted transactions/cards and reconcile them with visible text, SVG/bar geometry, and list ids.

## Project And Seed Inventory

Keep task-level completeness evidence separate from child-item scoring. In the current judge, four-month coverage belongs to item 2 and transaction status visibility belongs to item 3; the remaining inventory checks must not become extra failure conditions for unrelated items.

- Require the Vite/React/TypeScript project files and working `dev`, `build`, `test`, plus `lint` or `typecheck`; inspect separated typed data, derivation, validation, persistence, chart, phone-shell, and sheet responsibilities.
- Inventory at least 24 initial realistic transactions spanning at least four months and the required shopping, income, dining, transport, subscription, travel, transfer, medical, and education categories.
- Require at least two of `pending`, `settled`, and `refunded`, and verify the selected transaction's status is preserved in the detail drawer.
- Confirm two distinct fictional cards, stable card details, and the fictional holder name `Alex Morgan`; reject real-person/card data.

## Canonical Data And Derivations

Identify the authoritative arrays/objects for transactions, cards, selected month, current card, search, and filters. Recompute:

- visible transactions from selected month + search + filters;
- income, expense, net, and month-over-month values;
- cash-flow summaries and both chart series;
- category amount/share;
- category budget from selected-month category spending;
- subscription/upcoming-payment visibility.

Search/filter may affect visible transactions and their derived dashboard values, while category budget follows the exact month scope required by the task. Record the intended scope per selector before judging.

Use the invariant:

`visible = transactions in selected month ∩ active filter ∩ debounced search`

Then require:

`income = sum(valid visible income)`, `expense = abs(sum(valid visible expense))`, and `net = income - expense`.

Budget uses all valid transactions in the selected month and must not change with search. Record the candidate's documented filter scope separately; the judge does not state that every non-search filter must leave budget unchanged. Do not silently exempt a displayed “top total” from month linkage when the task explicitly includes it.

## Search, Filter, And Month Matrix

- Apply a search term matching merchant, category, and edited note in separate cases.
- Exercise the required direction/type filter and its intersection with search. If category or status filters are also provided, test them without treating their presence as mandatory.
- Wait beyond the search debounce, then compare list ids, top totals, summaries, both chart geometries/accessible values, and category detail against one recomputed ledger.
- Exercise at least four distinct seeded months, not only one switch, and require every month-scoped module to use the selected month. Also select a no-data month and require the specified empty/zero state.
- For each seeded month, compare month-over-month against that month's actual previous month rather than accepting a merely changed percentage.
- Record subscriptions/upcoming charges and budget values before and after month switches.
- Reject a dashboard where the list changes but cards/charts retain previous values.
- Clear search and return filter to all; require every affected module to return exactly to its baseline.

## Transaction Drawer And Focus

Click a transaction row through non-button whitespace and verify a pressed state and bottom drawer. Require merchant, category, date, amount, payment method, status, and note to match the source transaction.

Accessibility sequence:

1. Open and verify focus moves into the drawer.
2. Tab and Shift+Tab around all focusable elements and require focus trap.
3. Close with Escape and verify focus returns to the trigger row.
4. Reopen, close through overlay, and verify the same return.
5. Verify body/list scrolling is restored after close.

Inspect `document.activeElement`, not only a visible focus ring. Verify `document.body.style.overflow` or equivalent lock is restored to its prior value for every close path.

## Note Write-Back

- Edit a note to a unique string and save.
- Require visible success feedback.
- Verify the canonical transaction, drawer, list row, search result, and localStorage all contain the new value.
- Simulate or inspect a failure path and require the old note to remain.
- A local component update that disappears after close/reload is a failure.
- A callback hard-coded to return success is not a valid failure path even if the UI can render a failure message.

## Transfer Transaction

Validate empty, nonnumeric, negative, over-balance, missing-recipient, and missing-card cases with field-level messages. A valid form must enter a second confirmation showing recipient, amount, and card.

On final submit:

- button disables immediately and exposes busy state;
- rapid repeated clicks create exactly one transaction;
- success state resolves without permanent loading;
- the new transaction has a unique stable id, category `转账`, negative amount, chosen card/payment method, note, status, and appears once at the top;
- selected card balance, account total, monthly expense/net/change, summaries, charts, category detail/share, and budget all update from that transaction;
- reload preserves the transaction and balance.

Save a full before/after finance ledger.

The ledger must include transaction count and ids, selected-card balance, account total, income/expense/net/change, chart buckets, category amount/share, budget amount/percentage, and persisted values. Perform two transfers to prove ids are distinct and list keys do not warn.

## Current Card Consistency

- Switch between at least two cards and verify pressed/selected state plus card number/balance details.
- Verify card-number visibility acts on the current card only.
- Open transfer and require the current card as default.
- Choose an amount between the balances of two cards and prove validation targets the currently selected card.
- Reload and verify current card restoration.
- Verify the reveal control affects only the currently displayed card and, after switching cards, targets the new current card. Do not require a particular per-card internal state model when the observable behavior is correct.

## Tests And Evidence Closure

- Reference pure tests in `src/test/finance.test.ts` cover month/search/filter intersection, summary arithmetic, trend buckets, category shares, monthly budgets, validation, bad storage parsing, transfer write-back, and note search.
- Reference browser test `src/test/e2e/dashboard.spec.ts` covers a `360x800` shell, one month switch, theme persistence, one detail open/close, and one successful transfer.
- Existing tests do not prove search-driven whole-dashboard linkage, budget invariance, all month modules, focus cycling/overlay/Escape return, note persistence/failure, invalid transfer fields, rapid double submit, two unique ids, every transfer-derived chart/stat, or current-card validation. Add those checks.
- Require at least eight Vitest cases covering the task's visible-transaction, summaries, charts, categories, budgets, validation, storage, formatting, transfer write-back, and note-search behaviors; one test may cover multiple listed behaviors.
- Run declared test/typecheck/build/e2e scripts when the dependency installation is healthy. Report optional-native dependency startup failures separately from assertion results.

## High-Risk False Passes

- Top totals use all-month transactions while the list/charts use the selected month.
- Note edits only affect the open drawer.
- Note-save UI always reports success because its callback cannot fail.
- Double-submit guard disables visually but two records are still appended.
- Card UI changes while transfer default/validation still references the old card.
- Transfer updates list and card balance but not every derived chart/stat.
- Search updates list and summary text but leaves one SVG/bar series or category detail stale.
- Budget changes with search even though it should use all transactions in the selected month.
- A happy-path mobile E2E passes without exercising focus trapping, failure paths, or ledger consistency.

## Recommended Evidence

- `finance-filter-month-ledger.json` with visible ids, arithmetic, chart buckets, categories, budgets, and subscriptions
- `finance-drawer-focus-audit.json`
- `finance-note-writeback.json`
- `finance-transfer-before-after.json`
- `finance-current-card-matrix.json`
- mobile screenshots for list, drawer, validation, confirmation, and success

## Alignment-Focused Adjudication

Treat transfer, transaction insertion, balances, summaries, charts, budgets, and persistence as one atomic lineage. Start with a current-month baseline, complete a transfer through the UI, and identify the new transaction by a unique user-entered marker rather than assuming chronological seed order. Recompute expected deltas and compare every required downstream view before and after reload. For card switching, first choose an amount deliberately between two cards' balances, then verify displayed card, reveal target, default payment card, validation balance, and persisted selection all reference the same card. Do not fail a valid new transaction merely because static seed data contain future dates; do fail inconsistent single-source-of-truth behavior even if one panel updates.
