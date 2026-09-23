---
name: word-2016
description: Draft or fill a Word 2016 document using observed structure, grounded user facts and native verification.
---

Read `skills/word-2016/references/authoring.md` for supported authoring boundaries.
Read native document pages and use their item IDs; unseen pages are unknown. Ask missing facts through ask_user.
Preserve the chosen template via the approved native copy flow. Use apply_operation for each supported native change; scratch code and JSON are not applied documents.
Read references/calculations.md to use run_script for pure JavaScript transform(input) calculations. Code results are not applied documents. For approved Python execution, read references/python.md; preserve native approval and readback.

For Python-based authoring/data preparation, read `skills/word-2016/references/python.md`. Local execution is part of this same plan, receipt review and native Office approval flow.
