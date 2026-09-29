# Business plan

Owner: the product owner (@jselvalugo).

| File | What it is |
| --- | --- |
| `deemed-health-business-plan.pdf` | The business plan, with the logo: product, market, pricing, go-to-market, team, roadmap, cost to launch, cost to run, projections, funding, risks |
| `deemed-health-cost-model.xlsx` | The cost model behind every number in the plan. Blue cells on the Assumptions sheet (and in the budget sheets) are inputs; everything else is a formula |
| `build_business_plan.py` | Rebuilds both files from the lines and assumptions it defines |

All figures are planning estimates as of 2026-09-29. Confirm legal, audit,
penetration test, and insurance costs with quotes, and the Florida FQHC count
with the HRSA UDS state data, before using the plan externally.

To rebuild after changing an input in the script:

```sh
pip install openpyxl playwright
python3 docs/business/build_business_plan.py
```

It needs LibreOffice Calc (`soffice`) to recalculate the workbook and a Chromium
for Playwright (`CHROMIUM_PATH` if not the default).
