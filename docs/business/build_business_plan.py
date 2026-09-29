"""Build the Deemed Health business plan: cost model (.xlsx) and plan (.pdf).

The spreadsheet is the single source of every number. This script writes it
with live formulas, has LibreOffice recalculate it, reads the results back, and
renders the PDF from those results. Edit an input on the Assumptions sheet (or
a line below) and re-run to refresh both files.

    pip install openpyxl playwright
    python3 docs/business/build_business_plan.py

Needs LibreOffice Calc (`soffice`) on PATH and a Chromium for Playwright
(set CHROMIUM_PATH if it is not the Playwright default).
"""

from __future__ import annotations

import base64
import html
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LOGO = ROOT / "assets/brand/deemed-health-logo.png"
XLSX_OUT = HERE / "deemed-health-cost-model.xlsx"
PDF_OUT = HERE / "deemed-health-business-plan.pdf"
PLAN_DATE = "September 29, 2026"

# Brand tokens (docs/brand/design-system.md).
NAVY_900 = "043262"
BLUE_600 = "0462B6"
TEAL_500 = "0EAC97"
TEAL_700 = "0B7E6F"
GRAY_25 = "F8FAFC"
GRAY_200 = "E2E8F0"
BLUE_50 = "E8F3FD"

YEARS = [2027, 2028, 2029, 2030, 2031]  # Revenue sheet columns C..G
RUN_YEARS = [2028, 2029, 2030, 2031]  # Operating sheet columns D..G
COL = {2027: "C", 2028: "D", 2029: "E", 2030: "F", 2031: "G"}

# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------

# (defined name, label, value, number format, note)
ASSUMPTIONS = [
    ("Market", "Florida FQHC organizations (HRSA awardees + Look-Alikes)", 52, "0",
     "Planning estimate; verify against HRSA UDS state data (data.hrsa.gov) before external use"),
    ("PriceEss", "Essentials tier: annual subscription (< 20,000 patients)", 36000, "$#,##0", ""),
    ("PricePro", "Professional tier: annual subscription (20,000–60,000 patients)", 60000, "$#,##0", ""),
    ("PriceEnt", "Enterprise tier: annual subscription (> 60,000 patients)", 96000, "$#,##0", ""),
    ("MixEss", "Customer mix: Essentials", 0.40, "0%", ""),
    ("MixPro", "Customer mix: Professional", 0.40, "0%", ""),
    ("MixEnt", "Customer mix: Enterprise", 0.20, "0%", ""),
    ("ImplEss", "Implementation fee: Essentials (one-time)", 7500, "$#,##0", "Data import, SSO, training"),
    ("ImplPro", "Implementation fee: Professional (one-time)", 12500, "$#,##0", ""),
    ("ImplEnt", "Implementation fee: Enterprise (one-time)", 20000, "$#,##0", ""),
    ("Uplift", "Annual price increase (from 2029)", 0.03, "0.0%", ""),
    ("PilotDisc", "Design-partner (pilot) discount", 0.50, "0%", "Implementation fee waived for pilots"),
    ("PilotMonths", "Pilot months billed in 2027", 6, "0", "Jul–Dec 2027 (Phase 5)"),
    ("Cust2027", "Customers at year end 2027 (pilots)", 2, "0", "Pilots convert to full price Jan 2028"),
    ("Cust2028", "Customers at year end 2028", 8, "0", "General availability Jan 2028"),
    ("Cust2029", "Customers at year end 2029", 15, "0", ""),
    ("Cust2030", "Customers at year end 2030", 21, "0", ""),
    ("Cust2031", "Customers at year end 2031", 26, "0", "Half of the Florida market"),
    ("Load", "Payroll taxes and benefits (% of salary)", 0.22, "0%", "FICA, FUTA/RT-6, health, 401(k), workers' comp"),
    ("Raise", "Annual salary increase", 0.04, "0%", ""),
    ("Commission", "Sales commission (% of first-year subscription)", 0.10, "0%", ""),
    ("AWSBase", "AWS fixed monthly run cost (prod + non-prod + security)", 2500, "$#,##0", "ADR-0005 account layout, Multi-AZ, DR copies"),
    ("AWSPerCust", "AWS monthly cost per customer", 150, "$#,##0", "Compute, storage, backups"),
    ("AIPerCust", "Claude API monthly cost per customer (Deemed Assistant)", 120, "$#,##0", "Briefs, intake, panel (Phase 6)"),
    ("PayFee", "Payment processing (% of revenue)", 0.005, "0.0%", "Mostly ACH invoices"),
    ("ContLaunch", "Contingency on launch budget", 0.15, "0%", ""),
    ("ContRun", "Contingency on operating budget", 0.10, "0%", ""),
]

SCENARIOS = {
    "Conservative": {"Cust2027": 2, "Cust2028": 5, "Cust2029": 10, "Cust2030": 14, "Cust2031": 18},
    "Base": {},
    "Upside": {"Cust2027": 2, "Cust2028": 10, "Cust2029": 18, "Cust2030": 25, "Cust2031": 30},
}

# Launch period: October 2026 – December 2027 (15 months), through Phase 5 and G5.
# (category, item, basis, unit cost, quantity, gate/phase)
LAUNCH = [
    ("People", "Founder / CEO and product owner (also HIPAA security and privacy officer)", "$120k/yr × 15 mo", 10000, 15, "All"),
    ("People", "Senior full-stack engineer (TypeScript, AWS)", "$170k/yr from Jan 2027", 14167, 12, "P1–P5"),
    ("People", "Implementation & customer success lead (bilingual EN/ES, FQHC compliance)", "$95k/yr from Jun 2027", 7917, 7, "P4–P5"),
    ("People", "Sales & partnerships lead (Florida FQHC network)", "$105k/yr from Oct 2027", 8750, 3, "P5"),
    ("People", "Payroll taxes and benefits", "Load × salaries above", None, None, ""),
    ("People", "Fractional HRSA compliance advisor (catalog verification, OSV protocol)", "20 h/mo × $150", 3000, 15, "G0–G5"),
    ("People", "Fractional CISO / security advisor", "$3,500/mo from Jan 2027", 3500, 12, "G1–G5"),
    ("People", "Recruiting and background checks", "Per hire", 2500, 3, ""),
    ("Professional services & assurance", "Counsel: MSA, terms of service, customer BAA template, privacy policy", "Fixed fee", 20000, 1, "G4"),
    ("Professional services & assurance", "Counsel: Florida privacy and breach memo (FIPA §501.171, §408.051)", "Fixed fee", 7500, 1, "G4"),
    ("Professional services & assurance", "Counsel: HRSA, NPDB, and CVO regulatory memos (decision D3)", "Fixed fee", 7500, 1, "G2"),
    ("Professional services & assurance", "Counsel: design-partner pilot agreement; pricing and contract review", "Fixed fee", 6000, 1, "G5"),
    ("Professional services & assurance", "Counsel: employment, contractor, and IP assignment agreements", "Fixed fee", 3000, 1, "P1"),
    ("Professional services & assurance", "Trademark: \"Deemed Health\" USPTO filing, 2 classes", "With attorney", 2500, 1, ""),
    ("Professional services & assurance", "Independent penetration test, including retest", "Fixed fee", 25000, 1, "G4"),
    ("Professional services & assurance", "Incident response tabletop facilitation", "Fixed fee", 4000, 1, "G4"),
    ("Professional services & assurance", "SOC 2 Type I audit", "Audit firm", 20000, 1, "G5"),
    ("Professional services & assurance", "External WCAG 2.1 AA accessibility audit", "Fixed fee", 10000, 1, "G2"),
    ("Professional services & assurance", "Professional Spanish translation review (UI, help, templates)", "Fixed fee", 10000, 1, "G2"),
    ("Technology & infrastructure", "AWS non-production and security accounts", "From Jan 2027", 700, 12, "P1"),
    ("Technology & infrastructure", "AWS production (Multi-AZ RDS, Fargate, WAF, GuardDuty, DR copies)", "From Apr 2027", 1800, 9, "P4"),
    ("Technology & infrastructure", "Netlify + Neon development environments (synthetic data)", "Monthly", 150, 15, "P1"),
    ("Technology & infrastructure", "GitHub Team, Secret Protection, Code Security", "Monthly", 200, 15, "G0"),
    ("Technology & infrastructure", "AI development tools (Claude plans for the build team)", "Monthly", 400, 15, "All"),
    ("Technology & infrastructure", "Claude API: Deemed Assistant evals on synthetic data", "From Jul 2027", 300, 6, "P6 prep"),
    ("Technology & infrastructure", "Error tracking and APM under a BAA", "From Apr 2027", 300, 9, "G4"),
    ("Technology & infrastructure", "Transactional email under the AWS BAA (Amazon SES)", "From Apr 2027", 50, 9, "G4"),
    ("Technology & infrastructure", "Compliance automation platform (SOC 2 and HIPAA evidence)", "From Jan 2027", 1000, 12, "G5"),
    ("Technology & infrastructure", "Workforce IT and security (Workspace, password manager, MDM, training)", "Monthly", 200, 15, "G0"),
    ("Technology & infrastructure", "Laptops for new hires", "Per hire", 2500, 3, ""),
    ("Technology & infrastructure", "Hardware security keys (break-glass and workforce)", "One-time", 600, 1, "G1"),
    ("Business operations", "Cyber liability and technology E&O insurance ($2M)", "Bound Apr 2027", 1000, 9, "G4"),
    ("Business operations", "General liability / business owner's policy", "Monthly", 100, 15, ""),
    ("Business operations", "Accounting, bookkeeping, payroll service, tax filing", "Monthly", 700, 15, ""),
    ("Business operations", "Florida entity filings, registered agent, licenses", "One-time", 1000, 1, ""),
    ("Go-to-market", "Brand and bilingual marketing website", "Fixed fee", 12000, 1, "P5"),
    ("Go-to-market", "Sales collateral, demo video, OSV-readiness guide", "Fixed fee", 6000, 1, "P5"),
    ("Go-to-market", "CRM and sales tools", "From Jul 2027", 150, 6, "P5"),
    ("Go-to-market", "FACHC conference and Florida events (2027)", "Booth, sponsorship", 10000, 1, "P5"),
    ("Go-to-market", "Travel to pilot sites and prospects across Florida", "2027", 8000, 1, "P5"),
    ("Go-to-market", "Digital marketing ahead of general availability", "Oct–Dec 2027", 2000, 3, "P5"),
]


def _salary(base: int, start: int) -> str:
    """Salary in 2028 dollars, raised each year, zero before the start year."""
    return f"=IF({{c}}$3>={start},{base}*(1+Raise)^({{c}}$3-2028),0)"


# (category, item, basis, formula template with {c} = year column, or list of 4 numbers)
OPERATING = [
    ("People", "Founder / CEO and product owner", "$140k, +raise", _salary(140000, 2028)),
    ("People", "Senior full-stack engineer", "$177k, +raise", _salary(176800, 2028)),
    ("People", "Implementation & customer success lead", "$99k, +raise", _salary(98800, 2028)),
    ("People", "Sales & partnerships lead", "$109k base, +raise", _salary(109200, 2028)),
    ("People", "Bilingual implementation & support specialist", "From 2029", _salary(68000, 2029)),
    ("People", "Payroll taxes and benefits", "Load × salaries", "LOAD"),
    ("People", "Sales commission", "Commission × new first-year value", "=Commission*Revenue!{c}9*Revenue!{c}7"),
    ("People", "Fractional HRSA compliance advisor (regulatory watch, catalog changesets)", "$3,000/mo, +raise", "=36000*(1+Raise)^({c}$3-2028)"),
    ("People", "Fractional CISO / security advisor", "$3,500/mo", [42000, 42000, 42000, 42000]),
    ("People", "Recruiting and background checks", "Years with a hire", [0, 2500, 2500, 0]),
    ("Technology & infrastructure", "AWS (production, non-production, security, DR)", "(Base + per customer) × 12", "=(AWSBase+AWSPerCust*Revenue!{c}6)*12"),
    ("Technology & infrastructure", "Claude API for the Deemed Assistant (under BAA)", "Per customer × 12", "=AIPerCust*Revenue!{c}6*12"),
    ("Technology & infrastructure", "Error tracking, APM, and log management under BAA", "$400 + $15/customer per mo", "=(400+15*Revenue!{c}6)*12"),
    ("Technology & infrastructure", "Transactional email (Amazon SES)", "Monthly", [600, 600, 900, 900]),
    ("Technology & infrastructure", "Compliance automation platform", "Annual", [15000, 15000, 16000, 16000]),
    ("Technology & infrastructure", "Engineering tools (GitHub, Claude plans, CI minutes)", "Annual", [10800, 10800, 14400, 14400]),
    ("Technology & infrastructure", "Workforce IT and security stack", "Per seat", [3600, 4200, 4800, 4800]),
    ("Technology & infrastructure", "Equipment (new hires and refresh)", "Annual", [2000, 4500, 4500, 3000]),
    ("Assurance & professional", "SOC 2 Type II audit", "Annual", [30000, 30000, 32000, 32000]),
    ("Assurance & professional", "Annual penetration test", "Annual", [25000, 25000, 27000, 27000]),
    ("Assurance & professional", "Targeted penetration test of the assistant panel", "Phase 6 gate", [12000, 0, 0, 0]),
    ("Assurance & professional", "Accessibility re-audit and incident response tabletop", "Annual", [9000, 9000, 9000, 9000]),
    ("Assurance & professional", "Legal (customer contracts and BAAs, regulatory questions)", "Annual", [30000, 30000, 32000, 32000]),
    ("Assurance & professional", "Spanish translation of new content", "Annual", [5000, 5000, 5000, 5000]),
    ("Assurance & professional", "Cyber liability, tech E&O, and general liability insurance", "Grows with revenue", [19500, 21500, 23500, 25500]),
    ("Assurance & professional", "Accounting, tax, and payroll service", "Annual", [12000, 12000, 13000, 13000]),
    ("Go-to-market", "Conferences and sponsorships (FACHC, NACHC)", "Annual", [15000, 15000, 16000, 16000]),
    ("Go-to-market", "Digital marketing and content", "Annual", [24000, 24000, 24000, 24000]),
    ("Go-to-market", "Travel (onsite implementation and sales in Florida)", "$12k + $1.5k per new customer", "=12000+1500*Revenue!{c}9"),
    ("Go-to-market", "CRM and sales tools", "Annual", [3600, 3600, 3600, 3600]),
    ("Go-to-market", "Payment processing", "PayFee × revenue", "=PayFee*Revenue!{c}11"),
]

# --------------------------------------------------------------------------
# Workbook
# --------------------------------------------------------------------------

HEAD_FILL = PatternFill("solid", fgColor=NAVY_900)
HEAD_FONT = Font(bold=True, color="FFFFFF")
CAT_FILL = PatternFill("solid", fgColor=BLUE_50)
TOTAL_FILL = PatternFill("solid", fgColor=GRAY_25)
INPUT_FONT = Font(color=BLUE_600, bold=True)
BOLD = Font(bold=True)
THIN = Border(bottom=Side(style="thin", color=GRAY_200))
MONEY = '$#,##0;[Red]-$#,##0'


def _header(ws, row, values, widths=None):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=row, column=i, value=v)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w


def _title(ws, text, sub):
    ws["A1"] = text
    ws["A1"].font = Font(bold=True, size=14, color=NAVY_900)
    ws["A2"] = sub
    ws["A2"].font = Font(italic=True, color="64748B")


def build_workbook(path: Path, overrides: dict | None = None) -> dict:
    """Write the model. Returns cell addresses of the outputs the PDF needs."""
    overrides = overrides or {}
    wb = Workbook()
    refs: dict = {"launch_rows": [], "run_rows": []}

    # Assumptions
    ws = wb.active
    ws.title = "Assumptions"
    _title(ws, "Deemed Health · Model assumptions",
           "Blue values are inputs. Every other sheet calculates from them.")
    _header(ws, 3, ["Input", "Value", "Note"], [62, 14, 70])
    for i, (name, label, value, fmt, note) in enumerate(ASSUMPTIONS, start=4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=overrides.get(name, value))
        c.number_format, c.font = fmt, INPUT_FONT
        ws.cell(row=i, column=3, value=note)
        wb.defined_names[name] = DefinedName(name, attr_text=f"Assumptions!$B${i}")
    r = 4 + len(ASSUMPTIONS) + 1
    ws.cell(row=r, column=1, value="Blended annual subscription (list price)").font = BOLD
    ws.cell(row=r, column=2, value="=PriceEss*MixEss+PricePro*MixPro+PriceEnt*MixEnt").number_format = MONEY
    wb.defined_names["Blended"] = DefinedName("Blended", attr_text=f"Assumptions!$B${r}")
    ws.cell(row=r + 1, column=1, value="Blended implementation fee").font = BOLD
    ws.cell(row=r + 1, column=2, value="=ImplEss*MixEss+ImplPro*MixPro+ImplEnt*MixEnt").number_format = MONEY
    wb.defined_names["BlendedImpl"] = DefinedName("BlendedImpl", attr_text=f"Assumptions!$B${r + 1}")
    ws.cell(row=r + 2, column=1, value="Florida serviceable market at list price (annual)").font = BOLD
    ws.cell(row=r + 2, column=2, value="=Market*Blended").number_format = MONEY
    refs["blended"] = f"Assumptions!B{r}"
    refs["blended_impl"] = f"Assumptions!B{r + 1}"
    refs["sam"] = f"Assumptions!B{r + 2}"

    # Revenue (rows fixed; the Operating sheet refers to them by number)
    ws = wb.create_sheet("Revenue")
    _title(ws, "Deemed Health · Revenue build",
           "2027 is the paid pilot (design partners). General availability January 2028.")
    _header(ws, 3, ["Line", "Basis"] + YEARS, [44, 34, 14, 14, 14, 14, 14])
    for y in YEARS:
        ws[f"{COL[y]}3"] = y
    rows = {
        4: ("Customers at year start", "Prior year end"),
        5: ("Customers at year end", "Assumptions"),
        6: ("Average customers", "(Start + end) / 2"),
        7: ("List subscription per customer", "Blended × (1 + Uplift)^(year − 2028)"),
        8: ("Subscription revenue", "Average × list (2027: pilots at discount)"),
        9: ("New customers", "End − start"),
        10: ("Implementation revenue", "New × blended fee (waived for pilots)"),
        11: ("Total revenue", ""),
        12: ("Annual recurring revenue at year end", "End × list"),
        13: ("Share of Florida market", "End ÷ Market"),
    }
    for rr, (label, basis) in rows.items():
        ws.cell(row=rr, column=1, value=label)
        ws.cell(row=rr, column=2, value=basis)
    for y in YEARS:
        c = COL[y]
        prev = COL.get(y - 1)
        ws[f"{c}4"] = f"={prev}5" if prev else 0
        ws[f"{c}5"] = f"=Cust{y}"
        ws[f"{c}6"] = f"=({c}4+{c}5)/2"
        ws[f"{c}7"] = f"=Blended*(1+Uplift)^MAX(0,{c}3-2028)"
        if y == 2027:
            ws[f"{c}8"] = f"={c}5*Blended*(1-PilotDisc)*PilotMonths/12"
            ws[f"{c}10"] = 0
        else:
            ws[f"{c}8"] = f"={c}6*{c}7"
            ws[f"{c}10"] = f"={c}9*BlendedImpl"
        ws[f"{c}9"] = f"={c}5-{c}4"
        ws[f"{c}11"] = f"={c}8+{c}10"
        ws[f"{c}12"] = f"={c}5*{c}7"
        ws[f"{c}13"] = f"={c}5/Market"
        for rr in (7, 8, 10, 11, 12):
            ws[f"{c}{rr}"].number_format = MONEY
        for rr in (4, 5, 9):
            ws[f"{c}{rr}"].number_format = "0"
        ws[f"{c}6"].number_format = "0.0"
        ws[f"{c}13"].number_format = "0%"
    for col in range(1, 8):
        ws.cell(row=11, column=col).font = BOLD
        ws.cell(row=11, column=col).fill = TOTAL_FILL

    # Launch budget
    ws = wb.create_sheet("Launch budget")
    _title(ws, "Deemed Health · Launch budget, October 2026 – December 2027",
           "Everything needed to reach general availability: Phases 1–5 and gates G1–G5 of the implementation roadmap.")
    _header(ws, 3, ["Category", "Item", "Basis", "Unit cost", "Qty (months or units)", "Total", "Gate / phase"],
            [30, 70, 26, 13, 13, 14, 12])
    r = 4
    cat_rows: dict[str, list[int]] = {}
    salary_rows: list[int] = []
    load_row = None
    for cat, item, basis, unit, qty, gate in LAUNCH:
        ws.cell(row=r, column=1, value=cat)
        ws.cell(row=r, column=2, value=item)
        ws.cell(row=r, column=3, value=basis)
        ws.cell(row=r, column=7, value=gate)
        if unit is None:
            load_row = r
        else:
            ws.cell(row=r, column=4, value=unit).number_format = MONEY
            ws.cell(row=r, column=5, value=qty)
            for col in (4, 5):
                ws.cell(row=r, column=col).font = INPUT_FONT
            ws.cell(row=r, column=6, value=f"=D{r}*E{r}")
            if cat == "People" and "/yr" in basis:
                salary_rows.append(r)
        ws.cell(row=r, column=6).number_format = MONEY
        cat_rows.setdefault(cat, []).append(r)
        refs["launch_rows"].append(r)
        r += 1
    ws.cell(row=load_row, column=6, value="=Load*(" + "+".join(f"F{x}" for x in salary_rows) + ")")
    r += 1
    refs["launch_cats"] = {}
    for cat, rs in cat_rows.items():
        ws.cell(row=r, column=2, value=f"Subtotal: {cat}")
        ws.cell(row=r, column=6, value=f"=SUM(F{rs[0]}:F{rs[-1]})").number_format = MONEY
        for col in range(1, 8):
            ws.cell(row=r, column=col).fill = CAT_FILL
        refs["launch_cats"][cat] = f"'Launch budget'!F{r}"
        r += 1
    sub_first, sub_last = r - len(cat_rows), r - 1
    ws.cell(row=r, column=2, value="Subtotal before contingency").font = BOLD
    ws.cell(row=r, column=6, value=f"=SUM(F{sub_first}:F{sub_last})").number_format = MONEY
    refs["launch_sub"] = f"'Launch budget'!F{r}"
    ws.cell(row=r + 1, column=2, value="Contingency")
    ws.cell(row=r + 1, column=6, value=f"=ContLaunch*F{r}").number_format = MONEY
    refs["launch_cont"] = f"'Launch budget'!F{r + 1}"
    ws.cell(row=r + 2, column=2, value="Total launch budget").font = BOLD
    ws.cell(row=r + 2, column=6, value=f"=F{r}+F{r + 1}").number_format = MONEY
    for col in range(1, 8):
        ws.cell(row=r + 2, column=col).fill = TOTAL_FILL
        ws.cell(row=r + 2, column=col).font = BOLD
    refs["launch_total"] = f"'Launch budget'!F{r + 2}"

    # Operating budget
    ws = wb.create_sheet("Operating budget")
    _title(ws, "Deemed Health · Annual operating budget, 2028–2031",
           "Costs to run the business after general availability. Scaled lines follow the Revenue sheet.")
    _header(ws, 3, ["Category", "Item", "Basis"] + RUN_YEARS, [30, 66, 34, 14, 14, 14, 14])
    for y in RUN_YEARS:
        ws[f"{COL[y]}3"] = y
    r = 4
    cat_rows = {}
    salary_rows = []
    load_row = None
    for cat, item, basis, spec in OPERATING:
        ws.cell(row=r, column=1, value=cat)
        ws.cell(row=r, column=2, value=item)
        ws.cell(row=r, column=3, value=basis)
        for i, y in enumerate(RUN_YEARS):
            c = COL[y]
            if spec == "LOAD":
                load_row = r
                continue
            if isinstance(spec, list):
                cell = ws[f"{c}{r}"]
                cell.value = spec[i]
                cell.font = INPUT_FONT
            else:
                ws[f"{c}{r}"] = spec.format(c=c)
            ws[f"{c}{r}"].number_format = MONEY
        if isinstance(spec, str) and spec.startswith("=IF("):
            salary_rows.append(r)
        cat_rows.setdefault(cat, []).append(r)
        refs["run_rows"].append(r)
        r += 1
    for y in RUN_YEARS:
        c = COL[y]
        ws[f"{c}{load_row}"] = "=Load*(" + "+".join(f"{c}{x}" for x in salary_rows) + ")"
        ws[f"{c}{load_row}"].number_format = MONEY
    r += 1
    refs["run_cats"] = {}
    first_sub = r
    for cat, rs in cat_rows.items():
        ws.cell(row=r, column=2, value=f"Subtotal: {cat}")
        for y in RUN_YEARS:
            c = COL[y]
            ws[f"{c}{r}"] = f"=SUM({c}{rs[0]}:{c}{rs[-1]})"
            ws[f"{c}{r}"].number_format = MONEY
        for col in range(1, 8):
            ws.cell(row=r, column=col).fill = CAT_FILL
        refs["run_cats"][cat] = r
        r += 1
    ws.cell(row=r, column=2, value="Subtotal before contingency").font = BOLD
    ws.cell(row=r + 1, column=2, value="Contingency")
    ws.cell(row=r + 2, column=2, value="Total operating cost").font = BOLD
    for y in RUN_YEARS:
        c = COL[y]
        ws[f"{c}{r}"] = f"=SUM({c}{first_sub}:{c}{r - 1})"
        ws[f"{c}{r + 1}"] = f"=ContRun*{c}{r}"
        ws[f"{c}{r + 2}"] = f"={c}{r}+{c}{r + 1}"
        for rr in (r, r + 1, r + 2):
            ws[f"{c}{rr}"].number_format = MONEY
    for col in range(1, 8):
        ws.cell(row=r + 2, column=col).fill = TOTAL_FILL
        ws.cell(row=r + 2, column=col).font = BOLD
    refs["run_sub"], refs["run_cont"], refs["run_total"] = r, r + 1, r + 2
    run_total_row = r + 2

    # Summary
    ws = wb.create_sheet("Summary", 0)
    _title(ws, "Deemed Health · Financial summary",
           "Launch period = October 2026 – December 2027. Cash view; no financing income or taxes.")
    _header(ws, 3, ["Line", "Launch period", "2028", "2029", "2030", "2031"], [48, 16, 14, 14, 14, 14])
    labels = ["Revenue", "Costs", "Net cash flow", "Cumulative cash position",
              "Year-end customers", "Annual recurring revenue at year end",
              "Customers needed to cover the year's costs"]
    for i, lab in enumerate(labels, start=4):
        ws.cell(row=i, column=1, value=lab)
    ws["B4"] = "=Revenue!C11"
    ws["B5"] = f"={refs['launch_total']}"
    ws["B8"] = "=Revenue!C5"
    ws["B9"] = "=Revenue!C12"
    for j, y in enumerate(RUN_YEARS):
        s = "CDEF"[j]
        c = COL[y]
        ws[f"{s}4"] = f"=Revenue!{c}11"
        ws[f"{s}5"] = f"='Operating budget'!{c}{run_total_row}"
        ws[f"{s}8"] = f"=Revenue!{c}5"
        ws[f"{s}9"] = f"=Revenue!{c}12"
        ws[f"{s}10"] = f"={s}5/Revenue!{c}7"
    for s in "BCDEF":
        ws[f"{s}6"] = f"={s}4-{s}5"
        ws[f"{s}7"] = f"={s}6" if s == "B" else f"={chr(ord(s) - 1)}7+{s}6"
        for rr in (4, 5, 6, 7, 9):
            ws[f"{s}{rr}"].number_format = MONEY
        ws[f"{s}10"].number_format = "0.0"
    ws["A12"] = "Funding required (deepest cumulative cash position)"
    ws["A12"].font = BOLD
    ws["B12"] = "=-MIN(0,B7,C7,D7,E7,F7)"
    ws["B12"].number_format = MONEY
    ws["A13"] = "Recommended raise (funding required + 6 months of 2028 costs)"
    ws["A13"].font = BOLD
    ws["B13"] = "=B12+C5/2"
    ws["B13"].number_format = MONEY
    refs["summary"] = "Summary"

    for sheet in wb.worksheets:
        sheet.freeze_panes = "A4"
        for row in sheet.iter_rows(min_row=4):
            for cell in row:
                cell.border = THIN
                if cell.column in (1, 2, 3):
                    cell.alignment = Alignment(wrap_text=True, vertical="top")
    wb.save(path)
    refs["run_total_row"] = run_total_row
    return refs


def recalc(src: Path, outdir: Path) -> Path:
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx",
                    "--outdir", str(outdir), str(src)],
                   check=True, capture_output=True)
    return outdir / src.name


def read_model(path: Path, refs: dict) -> dict:
    wb = load_workbook(path, data_only=True)
    s = wb["Summary"]
    rev, la, op, asm = wb["Revenue"], wb["Launch budget"], wb["Operating budget"], wb["Assumptions"]

    def v(ref: str):
        sheet, cell = ref.rsplit("!", 1)
        return wb[sheet.strip("'")][cell].value

    m = {
        "blended": v(refs["blended"]), "blended_impl": v(refs["blended_impl"]), "sam": v(refs["sam"]),
        "launch_total": v(refs["launch_total"]), "launch_sub": v(refs["launch_sub"]),
        "launch_cont": v(refs["launch_cont"]),
        "launch_cats": {k: v(x) for k, x in refs["launch_cats"].items()},
        "funding": s["B12"].value, "raise": s["B13"].value,
        "summary": {row: [s.cell(row=row, column=c).value for c in range(2, 7)] for row in range(4, 11)},
        "revenue": {row: [rev.cell(row=row, column=c).value for c in range(3, 8)] for row in range(4, 14)},
        "launch": [[la.cell(row=r, column=c).value for c in range(1, 8)] for r in refs["launch_rows"]],
        "run": [[op.cell(row=r, column=c).value for c in range(1, 8)] for r in refs["run_rows"]],
        "run_cats": {k: [op.cell(row=r, column=c).value for c in range(4, 8)] for k, r in refs["run_cats"].items()},
        "run_sub": [op.cell(row=refs["run_sub"], column=c).value for c in range(4, 8)],
        "run_cont": [op.cell(row=refs["run_cont"], column=c).value for c in range(4, 8)],
        "run_total": [op.cell(row=refs["run_total"], column=c).value for c in range(4, 8)],
        "assumptions": {name: asm.cell(row=i, column=2).value for i, (name, *_rest) in enumerate(ASSUMPTIONS, start=4)},
    }
    return m


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

def money(x, k=False) -> str:
    if x is None:
        return "—"
    neg = x < 0
    x = abs(x)
    if k:
        s = f"${x / 1e6:,.2f}M" if x >= 1e6 else f"${x / 1e3:,.0f}k"
    else:
        s = f"${x:,.0f}"
    return f"({s})" if neg else s


def esc(s) -> str:
    return html.escape(str(s)) if s is not None else ""


def chart_svg(m: dict) -> str:
    """Grouped bars: revenue vs costs per period, direct-labeled (static print chart)."""
    periods = ["Launch\n(Q4 2026–2027)", "2028", "2029", "2030", "2031"]
    rev = m["summary"][4]
    cost = m["summary"][5]
    W, H, left, bottom, top = 660, 260, 56, 44, 16
    plot_h = H - bottom - top
    vmax = max(max(rev), max(cost)) * 1.12
    step = 500000
    group_w = (W - left - 10) / len(periods)
    bw = 34
    out = [f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" '
           f'aria-label="Revenue and costs by period; values in the table below">']
    y = 0
    while y <= vmax:
        py = top + plot_h - y / vmax * plot_h
        out.append(f'<line x1="{left}" x2="{W - 10}" y1="{py:.1f}" y2="{py:.1f}" stroke="#E2E8F0" stroke-width="1"/>')
        out.append(f'<text x="{left - 8}" y="{py + 4:.1f}" text-anchor="end" class="ax">{money(y, True) if y else "$0"}</text>')
        y += step
    for i, p in enumerate(periods):
        gx = left + i * group_w + group_w / 2
        for j, (val, color) in enumerate(((rev[i], "#0EAC97"), (cost[i], "#0462B6"))):
            x = gx - bw - 1 + j * (bw + 2)
            h = val / vmax * plot_h
            yb = top + plot_h - h
            out.append(f'<path d="M{x:.1f},{top + plot_h:.1f} V{yb + 4:.1f} Q{x:.1f},{yb:.1f} {x + 4:.1f},{yb:.1f} '
                       f'H{x + bw - 4:.1f} Q{x + bw:.1f},{yb:.1f} {x + bw:.1f},{yb + 4:.1f} V{top + plot_h:.1f} Z" fill="{color}"/>')
            out.append(f'<text x="{x + bw / 2:.1f}" y="{yb - 5:.1f}" text-anchor="middle" class="val">{money(val, True)}</text>')
        for k, line in enumerate(p.split("\n")):
            out.append(f'<text x="{gx:.1f}" y="{H - bottom + 16 + k * 13}" text-anchor="middle" class="ax">{esc(line)}</text>')
    out.append(f'<line x1="{left}" x2="{W - 10}" y1="{top + plot_h}" y2="{top + plot_h}" stroke="#64748B"/>')
    out.append("</svg>")
    return "".join(out)


def render_html(m: dict, scen: dict) -> str:
    logo = base64.b64encode(LOGO.read_bytes()).decode()
    A = m["assumptions"]
    S = m["summary"]
    R = m["revenue"]
    launch_total = m["launch_total"]
    run = m["run_total"]
    cust_be = S[10]
    cum = S[7]
    be_year = next((y for y, net in zip(["Launch", 2028, 2029, 2030, 2031], S[6]) if net >= 0), None)

    def launch_table():
        rows, cur = [], None
        for cat, item, basis, unit, qty, total, gate in m["launch"]:
            if cat != cur:
                rows.append(f'<tr class="cat"><td colspan="5">{esc(cat)}</td><td class="n">{money(m["launch_cats"][cat])}</td></tr>')
                cur = cat
            rows.append(f"<tr><td>{esc(item)}</td><td>{esc(basis)}</td><td class='n'>{money(unit) if unit else ''}</td>"
                        f"<td class='n'>{esc(qty) if qty else ''}</td><td>{esc(gate)}</td><td class='n'>{money(total)}</td></tr>")
        rows.append(f'<tr class="sub"><td colspan="5">Subtotal</td><td class="n">{money(m["launch_sub"])}</td></tr>')
        rows.append(f'<tr class="sub"><td colspan="5">Contingency ({A["ContLaunch"]:.0%})</td><td class="n">{money(m["launch_cont"])}</td></tr>')
        rows.append(f'<tr class="tot"><td colspan="5">Total launch budget</td><td class="n">{money(launch_total)}</td></tr>')
        return ("<table class='fin'><thead><tr><th>Item</th><th>Basis</th><th class='n'>Unit</th><th class='n'>Qty</th>"
                "<th>Gate</th><th class='n'>Total</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")

    def run_table():
        rows, cur = [], None
        for cat, item, basis, *vals in m["run"]:
            if cat != cur:
                rows.append(f'<tr class="cat"><td colspan="2">{esc(cat)}</td>' +
                            "".join(f"<td class='n'>{money(x)}</td>" for x in m["run_cats"][cat]) + "</tr>")
                cur = cat
            rows.append(f"<tr><td>{esc(item)}</td><td>{esc(basis)}</td>" +
                        "".join(f"<td class='n'>{money(x)}</td>" for x in vals) + "</tr>")
        rows.append("<tr class='sub'><td colspan='2'>Subtotal</td>" + "".join(f"<td class='n'>{money(x)}</td>" for x in m["run_sub"]) + "</tr>")
        rows.append(f"<tr class='sub'><td colspan='2'>Contingency ({A['ContRun']:.0%})</td>" + "".join(f"<td class='n'>{money(x)}</td>" for x in m["run_cont"]) + "</tr>")
        rows.append("<tr class='tot'><td colspan='2'>Total operating cost</td>" + "".join(f"<td class='n'>{money(x)}</td>" for x in run) + "</tr>")
        return ("<table class='fin'><thead><tr><th>Item</th><th>Basis</th>" +
                "".join(f"<th class='n'>{y}</th>" for y in RUN_YEARS) + "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>")

    def pl_table():
        heads = ["Launch<br>Q4 2026–2027", "2028", "2029", "2030", "2031"]
        lines = [("Revenue", S[4], money), ("Costs", S[5], money), ("Net cash flow", S[6], money),
                 ("Cumulative cash position", S[7], money), ("Customers at year end", S[8], lambda x: f"{x:.0f}"),
                 ("Recurring revenue at year end (ARR)", S[9], money),
                 ("Customers needed to cover the year's costs", [None] + S[10][1:], lambda x: "—" if x is None else f"{x:.1f}")]
        body = "".join(
            f"<tr class='{'tot' if lab.startswith('Cumulative') else ''}'><td>{lab}</td>" +
            "".join(f"<td class='n'>{fmt(x)}</td>" for x in vals) + "</tr>" for lab, vals, fmt in lines)
        return ("<table class='fin'><thead><tr><th></th>" + "".join(f"<th class='n'>{h}</th>" for h in heads) +
                "</tr></thead><tbody>" + body + "</tbody></table>")

    def revenue_table():
        labels = {5: ("Customers at year end", lambda x: f"{x:.0f}"), 6: ("Average customers", lambda x: f"{x:.1f}"),
                  7: ("List subscription per customer", money), 8: ("Subscription revenue", money),
                  9: ("New customers", lambda x: f"{x:.0f}"), 10: ("Implementation revenue", money),
                  11: ("Total revenue", money), 13: ("Share of the Florida market", lambda x: f"{x:.0%}")}
        body = "".join(f"<tr class='{'tot' if r == 11 else ''}'><td>{lab}</td>" +
                       "".join(f"<td class='n'>{fmt(x)}</td>" for x in R[r]) + "</tr>" for r, (lab, fmt) in labels.items())
        return ("<table class='fin'><thead><tr><th></th>" + "".join(f"<th class='n'>{y}</th>" for y in YEARS) +
                "</tr></thead><tbody>" + body + "</tbody></table>")

    def scenario_table():
        body = ""
        for name, sm in scen.items():
            netpos = [y for y, net in zip([2028, 2029, 2030, 2031], sm["summary"][6][1:]) if net >= 0]
            body += (f"<tr class='{'tot' if name == 'Base' else ''}'><td>{name}</td>"
                     f"<td class='n'>{' / '.join(f'{x:.0f}' for x in sm['summary'][8][1:])}</td>"
                     f"<td class='n'>{money(sm['summary'][9][4])}</td>"
                     f"<td class='n'>{money(sm['summary'][6][4])}</td>"
                     f"<td class='n'>{netpos[0] if netpos else 'After 2031'}</td>"
                     f"<td class='n'>{money(sm['funding'])}</td></tr>")
        return ("<table class='fin'><thead><tr><th>Scenario</th><th class='n'>Customers 2028 / 29 / 30 / 31</th>"
                "<th class='n'>ARR end 2031</th><th class='n'>2031 net cash flow</th><th class='n'>First cash-positive year</th>"
                "<th class='n'>Funding required</th></tr></thead><tbody>" + body + "</tbody></table>")

    lc = m["launch_cats"]
    use_of_funds = "".join(
        f"<tr><td>{esc(k)}</td><td class='n'>{money(v)}</td><td class='n'>{v / launch_total:.0%}</td></tr>" for k, v in lc.items())
    use_of_funds += (f"<tr><td>Contingency</td><td class='n'>{money(m['launch_cont'])}</td>"
                     f"<td class='n'>{m['launch_cont'] / launch_total:.0%}</td></tr>"
                     f"<tr class='tot'><td>Total launch budget</td><td class='n'>{money(launch_total)}</td><td class='n'>100%</td></tr>")

    be_text = (f"The base case turns cash-positive in <b>{be_year}</b>" if be_year and be_year != "Launch"
               else "The base case does not turn cash-positive by 2031")

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Deemed Health Business Plan</title>
<style>{inline_fonts()}

:root {{ --navy:#043262; --blue:#0462B6; --sky:#0BA1F1; --teal:#0EAC97; --teal7:#0B7E6F; --teal8:#0A6E61;
  --teal50:#E7F7F4; --blue50:#E8F3FD; --g25:#F8FAFC; --g100:#EEF2F6; --g200:#E2E8F0; --g500:#64748B; --g700:#334155; --g900:#0F172A; }}
@page {{ size: Letter; margin: 0.7in 0.7in 0.75in 0.7in; }}
* {{ box-sizing: border-box; }}
body {{ font-family: Inter, "Liberation Sans", system-ui, sans-serif; color: var(--g700); font-size: 10pt; line-height: 1.5; margin: 0; background:#fff; }}
h1 {{ color: var(--navy); font-size: 21pt; margin: 0 0 4pt; letter-spacing: -0.01em; }}
h2 {{ color: var(--navy); font-size: 15pt; margin: 0 0 8pt; padding-bottom: 5pt; border-bottom: 2.5pt solid var(--teal); }}
h3 {{ color: var(--navy); font-size: 11pt; margin: 14pt 0 4pt; }}
p {{ margin: 0 0 7pt; }}
ul {{ margin: 0 0 8pt; padding-left: 16pt; }} li {{ margin-bottom: 3pt; }}
section {{ break-before: page; }}
.cover {{ height: 9.4in; display: flex; flex-direction: column; justify-content: space-between; }}
.cover img {{ width: 5.2in; margin: 1.2in 0 0 -0.25in; }}
.cover .band {{ background: linear-gradient(160deg, #0BA1F1 0%, #0462B6 55%, #034491 100%); color: #fff; padding: 22pt 26pt; border-radius: 10pt; }}
.cover .band h1 {{ color: #fff; font-size: 30pt; margin-bottom: 6pt; }}
.cover .band p {{ font-size: 12pt; margin: 0; opacity: .95; }}
.cover .meta {{ font-size: 9.5pt; color: var(--g500); border-top: 1pt solid var(--g200); padding-top: 10pt; }}
.kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 10pt 0 12pt; }}
.kpi {{ border: 1pt solid var(--g200); border-top: 3pt solid var(--blue); border-radius: 6pt; padding: 8pt 10pt; break-inside: avoid; }}
.kpi.t {{ border-top-color: var(--teal); }}
.kpi b {{ display: block; font-size: 15pt; color: var(--navy); line-height: 1.2; }}
.kpi span {{ font-size: 8.5pt; color: var(--g500); }}
table {{ width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 8.6pt; }}
th {{ background: var(--navy); color: #fff; text-align: left; font-weight: 600; padding: 4pt 6pt; }}
td {{ padding: 3.2pt 6pt; border-bottom: 0.75pt solid var(--g200); vertical-align: top; }}
tr {{ break-inside: avoid; }}
.n {{ text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }}
tr.cat td {{ background: var(--blue50); color: var(--navy); font-weight: 600; }}
tr.sub td {{ background: var(--g25); }}
tr.tot td {{ background: var(--teal50); color: var(--g900); font-weight: 700; border-bottom: 1pt solid var(--teal7); }}
.note {{ background: var(--g25); border-left: 3pt solid var(--blue); padding: 7pt 10pt; font-size: 9pt; margin: 8pt 0; break-inside: avoid; }}
.warn {{ background: #FEF6E7; border-left: 3pt solid #B7791F; padding: 7pt 10pt; font-size: 9pt; margin: 8pt 0; color: #5c3d00; break-inside: avoid; }}
.two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }}
.chart {{ border: 1pt solid var(--g200); border-radius: 6pt; padding: 8pt 10pt 4pt; margin: 6pt 0 10pt; break-inside: avoid; }}
.chart .ax {{ font-size: 9px; fill: #64748B; font-family: Inter, sans-serif; }}
.chart .val {{ font-size: 9px; fill: #0F172A; font-weight: 600; font-family: Inter, sans-serif; }}
.legend {{ display: flex; gap: 14pt; font-size: 8.5pt; margin-bottom: 2pt; }}
.legend i {{ display: inline-block; width: 10pt; height: 10pt; border-radius: 2pt; margin-right: 4pt; vertical-align: -1pt; }}
.small {{ font-size: 8.5pt; color: var(--g500); }}
.pill {{ display:inline-block; font-size: 8pt; font-weight:600; padding: 1pt 6pt; border-radius: 8pt; background: var(--teal50); color: var(--teal8); }}
.pill.b {{ background: var(--blue50); color: var(--blue); }}
.pill.g {{ background: var(--g100); color: var(--g700); }}
</style></head><body>

<div class="cover">
  <img src="data:image/png;base64,{logo}" alt="Deemed Health, FQHC Compliance Software">
  <div class="band">
    <h1>Business Plan</h1>
    <p>Continuous HRSA readiness for Florida's community health centers</p>
  </div>
  <div class="meta">
    <b style="color:var(--navy)">Loogo Labs</b> · Prepared {PLAN_DATE} · Planning period October 2026 – December 2031<br>
    Confidential. Figures are planning estimates from the Deemed Health cost model
    (<i>deemed-health-cost-model.xlsx</i>), to be confirmed with vendor quotes before commitment.
  </div>
</div>

<section>
<h2>1. Executive summary</h2>
<p><b>Deemed Health</b> is compliance software for Federally Qualified Health Centers (FQHCs) and Look-Alikes.
It shows a health center where it stands against the HRSA Health Center Program requirements <b>every day, not only
at the Operational Site Visit (OSV)</b>: who is credentialed and privileged, who is enrolled with which payer, who was
screened against exclusion lists, what the board approved, which evidence is missing, and what is due next.</p>
<p>The product is being built by Loogo Labs with a small team working alongside a roster of specialized AI engineering
agents, under a gated roadmap that puts security and HIPAA controls in place before any real data arrives. The platform
core is under construction today (sign-in, tenancy, audit log, and the records framework are built on synthetic data).
We will run a paid pilot with two Florida design partners in the second half of 2027 and reach general availability in
January 2028, after the SOC 2 Type I report.</p>
<div class="kpis">
  <div class="kpi"><b>{money(launch_total, True)}</b><span>Total cost to launch (Oct 2026 – Dec 2027)</span></div>
  <div class="kpi"><b>{money(run[0], True)} → {money(run[3], True)}</b><span>Annual cost to run, 2028 → 2031</span></div>
  <div class="kpi t"><b>{money(m['funding'], True)}</b><span>Funding required (deepest cash position)</span></div>
  <div class="kpi t"><b>{money(m['raise'], True)}</b><span>Recommended raise, with a 6-month buffer</span></div>
</div>
<ul>
  <li><b>Market.</b> About {A['Market']:.0f} FQHC organizations in Florida (our operating scope). At our list prices that is a
  serviceable market of about <b>{money(m['sam'], True)}</b> in annual subscriptions.</li>
  <li><b>Model.</b> Annual subscription in three tiers ({money(A['PriceEss'])}, {money(A['PricePro'])}, {money(A['PriceEnt'])})
  plus a one-time implementation fee. Blended list price {money(m['blended'])} per customer per year.</li>
  <li><b>Plan.</b> {S[8][1]:.0f} customers by the end of 2028, {S[8][4]:.0f} by the end of 2031
  ({R[13][4]:.0%} of the Florida market), reaching {money(S[9][4], True)} ARR.</li>
  <li><b>Economics.</b> {be_text}. Cumulative cash reaches its lowest point at {money(-m['funding'], True)}.</li>
  <li><b>Key strategic point.</b> Florida alone caps the business at roughly {money(m['sam'], True)} a year. That is enough to
  build a sustainable company, but only with a lean team and high market share. Growth beyond it requires revisiting the
  Florida-only decision (roadmap D4), which is the product owner's call (§13).</li>
</ul>
</section>

<section>
<h2>2. The problem</h2>
<p>Florida's FQHCs care for well over a million patients a year, many uninsured or on Medicaid. To keep their Health Center
Program funding (or Look-Alike designation) and their FTCA malpractice coverage, each must continuously meet the program
requirements in the HRSA Health Center Program Compliance Manual (Chapters 3–20) and the FTCA deeming requirements (Chapter 21).
HRSA checks this at the Operational Site Visit and through the deeming application.</p>
<h3>What health centers deal with today</h3>
<ul>
  <li><b>Scattered evidence.</b> Credentialing files, board minutes, sliding fee policies, contracts, and screening results
  live in spreadsheets, shared drives, and separate point tools. Assembling them for an OSV takes weeks.</li>
  <li><b>Readiness only at audit time.</b> Gaps (an expired license, a missed monthly exclusion check, a board approval not in
  the minutes) are found when the reviewer finds them, when a condition on the award is the cost.</li>
  <li><b>Constant regulatory change.</b> PALs, PINs, Compliance Manual updates, the annual federal poverty guidelines, and UDS
  manual changes all shift what "compliant" means.</li>
  <li><b>Small teams.</b> A compliance officer often also runs credentialing, risk, and board support, in two languages.</li>
</ul>
<h3>What a deficiency costs</h3>
<p>An OSV finding becomes a condition on the award with a deadline to fix it; unresolved conditions can escalate to
restrictions on drawing down funds. Lapsed FTCA deeming exposes the health center and its providers to malpractice liability.
A missed exclusion hit can mean repaying Medicare and Medicaid claims. These are existential risks for organizations operating
on thin margins.</p>
</section>

<section>
<h2>3. The product</h2>
<p>Deemed Health maps every HRSA requirement to <b>evidence, an owner, a cadence, and a status</b> that is recomputed as data
changes. Its principles: readiness is continuous; <b>AI guides, humans decide</b> (it never attests, approves, signs, or submits to
HRSA); every requirement cites its regulatory source and verification date; requirements are versioned data, not code;
every action is written to an append-only audit log; personal data is minimized; the interface is in English and Spanish from
day one.</p>
<table class="fin"><thead><tr><th>Module</th><th>What it does</th><th>Release</th></tr></thead><tbody>
<tr><td>Command Center</td><td>Daily readiness across every requirement, priorities, what changed</td><td><span class="pill">MVP</span></td></tr>
<tr><td>HRSA Readiness</td><td>Requirement-by-requirement status, evidence library, findings, OSV binder export</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Providers &amp; Credentialing</td><td>Provider files, primary source verification, privileges, expirations</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Screening</td><td>OIG LEIE, SAM.gov, and Florida AHCA exclusion screening, human review of possible matches</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Enrollment</td><td>Payer enrollment, reassignment, revalidation, effective dates by provider and site</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Governance</td><td>Board roster and composition, meetings, minutes, approvals, conflict of interest</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Tasks &amp; Workflows</td><td>Every action item with owners, due dates, and recorded approvals</td><td><span class="pill">MVP</span></td></tr>
<tr><td>FTCA &amp; Risk</td><td>Deeming readiness, risk assessments, training, incidents, claims, tracking systems</td><td><span class="pill">MVP</span></td></tr>
<tr><td>Deemed Assistant</td><td>AI briefs, suggested actions, document intake, cited answers (Claude, under a BAA)</td><td><span class="pill b">2028</span></td></tr>
<tr><td>Scope &amp; Sites, Contracts, Finance &amp; Grants</td><td>Forms 5A/5B/5C, required contract provisions, sliding fee program, budget</td><td><span class="pill b">Next</span></td></tr>
<tr><td>Quality &amp; UDS, Patient Experience</td><td>QI/QA, UDS readiness and table validation, surveys, grievances</td><td><span class="pill b">Next</span></td></tr>
<tr><td>Learning, Self-Service, Administration</td><td>Required training, staff and board self-service, users, roles, audit log</td><td><span class="pill b">Next</span> <span class="pill">MVP</span></td></tr>
</tbody></table>
<div class="note"><b>What Deemed Health is not</b> (decision MR-D0, September 27, 2026): it is not an EHR or ONC-certified health IT,
it does not compute UDS tables from patient-level data, and it does not do Medicaid PPS encounter billing. It builds the compliance
side of each: UDS readiness and validation of EHR-generated tables, PPS rate, deadline, and reconciliation tracking. This keeps the
product focused, keeps PHI to a minimum, and keeps the cost of assurance manageable.</div>
</section>

<section>
<h2>4. Market</h2>
<div class="two"><div>
<h3>Florida first, and Florida only for now</h3>
<p>All customers and sites are in Florida (roadmap decision D4). That lets us go deep: the AHCA sanctioned-provider list,
Florida DOH license verification, both Florida time zones, Florida privacy and breach law (FIPA), and bilingual English/Spanish
operation are built in rather than bolted on.</p>
<ul>
  <li>~{A['Market']:.0f} FQHC organizations (HRSA awardees and Look-Alikes)</li>
  <li>Hundreds of service delivery sites statewide</li>
  <li>Buyers: CEO, compliance officer, COO, CMO, credentialing manager</li>
  <li>Channel: Florida Association of Community Health Centers (FACHC) and its conferences</li>
</ul>
</div><div>
<h3>Market size at our prices</h3>
<table class="fin"><tbody>
<tr><td>Organizations</td><td class="n">{A['Market']:.0f}</td></tr>
<tr><td>Blended list price per year</td><td class="n">{money(m['blended'])}</td></tr>
<tr class="tot"><td>Serviceable market (annual)</td><td class="n">{money(m['sam'])}</td></tr>
<tr><td>Base-case share by end of 2031</td><td class="n">{R[13][4]:.0%}</td></tr>
</tbody></table>
<p class="small">Organization count is a planning estimate; confirm with the HRSA UDS state report for Florida
(data.hrsa.gov) before external use.</p>
</div></div>
<h3>Competition</h3>
<table class="fin"><thead><tr><th>Alternative</th><th>Where it falls short for an FQHC</th></tr></thead><tbody>
<tr><td>Spreadsheets, shared drives, binders</td><td>No cadence, no alerts, no audit trail; OSV prep is manual</td></tr>
<tr><td>Credentialing platforms and CVOs</td><td>Strong on credentialing; do not cover governance, scope, FTCA, sliding fee, or HRSA readiness</td></tr>
<tr><td>General healthcare compliance suites</td><td>Built for hospitals or practices around OIG/OSHA; not mapped to the HRSA Compliance Manual or the OSV protocol</td></tr>
<tr><td>Board portals, policy tools, LMS</td><td>One slice each; no link between a board approval and the HRSA requirement it satisfies</td></tr>
<tr><td>Consultants (mock OSVs)</td><td>A snapshot, not continuous; expensive to repeat. A partner channel for us, not a rival</td></tr>
</tbody></table>
<p><b>Our edge:</b> the only product whose data model <i>is</i> the HRSA requirement set, with cited sources and versioned
updates; readiness every day; bilingual; Florida rules built in; and security built for an FQHC's business associate from day one.</p>
</section>

<section>
<h2>5. Business model and pricing</h2>
<table class="fin"><thead><tr><th>Tier</th><th>Health center size</th><th class="n">Annual subscription</th><th class="n">Implementation (one-time)</th><th class="n">Planned mix</th></tr></thead><tbody>
<tr><td>Essentials</td><td>Fewer than 20,000 patients</td><td class="n">{money(A['PriceEss'])}</td><td class="n">{money(A['ImplEss'])}</td><td class="n">{A['MixEss']:.0%}</td></tr>
<tr><td>Professional</td><td>20,000 – 60,000 patients</td><td class="n">{money(A['PricePro'])}</td><td class="n">{money(A['ImplPro'])}</td><td class="n">{A['MixPro']:.0%}</td></tr>
<tr><td>Enterprise</td><td>More than 60,000 patients</td><td class="n">{money(A['PriceEnt'])}</td><td class="n">{money(A['ImplEnt'])}</td><td class="n">{A['MixEnt']:.0%}</td></tr>
<tr class="tot"><td>Blended</td><td></td><td class="n">{money(m['blended'])}</td><td class="n">{money(m['blended_impl'])}</td><td class="n">100%</td></tr>
</tbody></table>
<ul>
  <li>All modules, unlimited users, English and Spanish. The Deemed Assistant is included and switched on per health center.</li>
  <li>Annual contracts, invoiced annually in advance; {A['Uplift']:.0%} annual price increase from 2029.</li>
  <li>Design partners (2027 pilot): {A['PilotDisc']:.0%} off the first year, implementation fee waived, in exchange for weekly
  feedback and a written confirmation that statuses matched their records (gate G5).</li>
  <li>Pricing is a hypothesis to validate with the pilots and with FACHC before general availability. Counsel reviews pricing and
  contracts at G5. Costs such as NPDB query fees and CAQH access stay with the health center.</li>
</ul>
<h3>Value to the customer</h3>
<p>A mid-size health center typically spends on several point tools (credentialing, exclusion screening, board portal, policy
management, training) plus staff time and consultant mock site visits. Deemed Health replaces much of that with one system of record
and turns weeks of OSV binder preparation into an export. The ROI case is to be quantified with design partners.</p>
</section>

<section>
<h2>6. Go-to-market</h2>
<div class="two"><div>
<h3>2027 · Design partners</h3>
<ul>
  <li>Recruit two Florida health centers (one §330 awardee, ideally one Look-Alike) as paid design partners.</li>
  <li>Weekly reviews; every readiness error is a severity-1 defect with a regression test.</li>
  <li>Build case studies and references in English and Spanish.</li>
</ul>
<h3>2028 · General availability</h3>
<ul>
  <li>Hire a sales and partnerships lead with Florida FQHC relationships (Q4 2027).</li>
  <li>FACHC conferences and sponsorships; webinars on OSV readiness and FTCA deeming.</li>
  <li>Referral partnerships with Florida FQHC consultants and CPA firms.</li>
</ul>
</div><div>
<h3>Sales motion</h3>
<ul>
  <li>Founder-led and relationship-led; 3–6 month sales cycle, often timed to budget periods and upcoming OSVs.</li>
  <li>Entry offer: a free readiness assessment against the Compliance Manual on the health center's own documents.</li>
  <li>Security package for procurement: risk analysis summary, penetration test summary, subprocessor list, SOC 2 report, BAA.</li>
</ul>
<h3>Retention</h3>
<ul>
  <li>Implementation lead owns onboarding: import with dry run, SSO, roles, training.</li>
  <li>Quarterly readiness reviews with each customer; catalog updates delivered as HRSA changes policy.</li>
</ul>
</div></div>
</section>

<section>
<h2>7. Team and operations</h2>
<p>Loogo Labs builds Deemed Health with a deliberately small human team working with a roster of 17 specialized AI engineering
agents (architecture, HRSA regulatory analysis, security and privacy, data, backend, frontend, QA, content, integrations, and domain
specialists for credentialing, screening, governance, FTCA, and finance). Humans own every decision, approval, and sign-off; the
agents draft, build, and test under the same review gates as any engineer. This is why the launch budget is a fraction of a
conventional build.</p>
<table class="fin"><thead><tr><th>Role</th><th>Start</th><th>Why</th></tr></thead><tbody>
<tr><td>Founder / CEO, product owner, HIPAA security and privacy officer</td><td>Now</td><td>Decisions, sign-offs, customers, counsel, HRSA contact</td></tr>
<tr><td>Senior full-stack engineer</td><td>Jan 2027</td><td>Reviews and owns production code, AWS, on-call</td></tr>
<tr><td>Fractional HRSA compliance advisor</td><td>Now</td><td>Human verification of every catalog entry and the OSV protocol mapping</td></tr>
<tr><td>Fractional CISO / security advisor</td><td>Jan 2027</td><td>Independent review of controls; G4, SOC 2</td></tr>
<tr><td>Implementation &amp; customer success lead (bilingual)</td><td>Jun 2027</td><td>Pilot onboarding, training, support</td></tr>
<tr><td>Sales &amp; partnerships lead</td><td>Oct 2027</td><td>Pipeline for general availability</td></tr>
<tr><td>Bilingual implementation &amp; support specialist</td><td>2029</td><td>Scale onboarding past ~10 customers</td></tr>
<tr><td>Second engineer</td><td>When ARR passes $1.5M</td><td>Next modules, on-call depth (not in the base-case costs)</td></tr>
</tbody></table>
<h3>Infrastructure</h3>
<p>Production runs on AWS under a signed BAA, US regions only (us-east-1 with disaster recovery copies in us-east-2), in isolated
production, non-production, and security accounts. Development runs on Netlify and Neon with synthetic data only. The AI provider is
Anthropic's Claude API behind a server-side gateway with masking, per-tenant switches, and no training on customer data.</p>
</section>

<section>
<h2>8. Roadmap and milestones</h2>
<p>Each phase ends at a gate: a checklist of controls that must be finished and proven before the next phase starts or more
sensitive data enters the system. Dates below are targets.</p>
<table class="fin"><thead><tr><th>Phase</th><th>What gets built</th><th>Gate</th><th>Target</th></tr></thead><tbody>
<tr><td>0 · Foundations</td><td>ADRs, security program, CI guardrails, catalog schema</td><td>G0 Build-ready</td><td>Q4 2026 (closing)</td></tr>
<tr><td>1 · Platform core</td><td>Shell, identity, tenancy, audit, evidence store, catalog, readiness engine</td><td>G1 Platform-secure</td><td>Dec 2026</td></tr>
<tr><td>2 · MVP modules</td><td>Credentialing, Screening, Enrollment, Governance, Tasks, Command Center</td><td>G2 Feature-complete</td><td>Apr 2027</td></tr>
<tr><td>3 · FTCA &amp; Risk</td><td>FTCA module and restricted-data handling</td><td>G3 Restricted-data-ready</td><td>May 2027</td></tr>
<tr><td>4 · Operational readiness</td><td>Production, penetration test, BAA and terms, incident response, insurance</td><td>G4 Ready to operate</td><td>Jun 2027</td></tr>
<tr><td>5 · Controlled pilot</td><td>Two Florida design partners under BAA; SOC 2 Type I</td><td>G5 General availability</td><td>Jul – Dec 2027</td></tr>
<tr><td>6 · Deemed Assistant</td><td>Briefs, suggested actions, document intake, assistant panel</td><td>Per-capability evals</td><td>2028</td></tr>
<tr><td>7 · Next modules</td><td>Scope &amp; Sites, Contracts, Finance &amp; Grants, Quality &amp; UDS, and more</td><td>Per-module gates</td><td>2028 – 2029</td></tr>
<tr><td>8 · Scale and assurance</td><td>SOC 2 Type II, annual testing, multi-region DR</td><td>Annual review</td><td>2028 onward</td></tr>
</tbody></table>
</section>

<section>
<h2>9. Cost to launch</h2>
<p>Everything required to go from today to general availability: October 2026 through December 2027, covering Phases 1–5 and gates
G1–G5. The gate column shows which roadmap gate each item is needed for.</p>
{launch_table()}
<p class="small">Founder salary can be deferred or accrued to reduce cash needs. Unit costs are planning estimates; confirm legal,
audit, penetration test, and insurance items with quotes.</p>
</section>

<section>
<h2>10. Cost to run</h2>
<p>Annual costs after general availability. Infrastructure, AI, travel, commission, and payment processing scale with the number of
customers; everything else is a fixed cost of operating a HIPAA business associate that sells to health centers.</p>
{run_table()}
<div class="note"><b>Cost of assurance.</b> SOC 2, penetration testing, legal, insurance, and compliance tooling are about
{money(m['run_cats']['Assurance & professional'][0] + 15000, True)} a year, a fixed cost that does not shrink with a small customer base.
It is also a selling point: FQHC procurement increasingly expects it.</div>
</section>

<section>
<h2>11. Financial projections</h2>
<div class="chart">
<div class="legend"><span><i style="background:#0EAC97"></i>Revenue</span><span><i style="background:#0462B6"></i>Costs</span></div>
{chart_svg(m)}
</div>
{pl_table()}
<h3>Revenue build</h3>
{revenue_table()}
<p class="small">Customers are added evenly through each year; pilots convert to full price in January 2028; no churn is assumed
in the base case (a lost customer delays break-even by about a year at this scale).</p>
</section>

<section>
<h2>12. Funding and scenarios</h2>
<div class="two"><div>
<h3>Funding requirement</h3>
<table class="fin"><tbody>
<tr><td>Launch budget (Q4 2026 – 2027)</td><td class="n">{money(launch_total)}</td></tr>
<tr><td>Less pilot revenue (2027)</td><td class="n">{money(-S[4][0])}</td></tr>
<tr><td>Operating losses until cash-positive</td><td class="n">{money(m['funding'] - (launch_total - S[4][0]))}</td></tr>
<tr class="tot"><td>Funding required</td><td class="n">{money(m['funding'])}</td></tr>
<tr><td>Six-month buffer (half of 2028 costs)</td><td class="n">{money(m['raise'] - m['funding'])}</td></tr>
<tr class="tot"><td>Recommended raise</td><td class="n">{money(m['raise'])}</td></tr>
</tbody></table>
<p class="small">Sources could combine founder capital, angel or seed investment, and non-dilutive options. Raising in two tranches
(launch now; operating runway at G4, once the product is proven on production) lowers dilution.</p>
</div><div>
<h3>Use of launch funds</h3>
<table class="fin"><thead><tr><th>Category</th><th class="n">Amount</th><th class="n">Share</th></tr></thead><tbody>{use_of_funds}</tbody></table>
</div></div>
<h3>Scenarios</h3>
{scenario_table()}
<p class="small">Scenarios change only the customer ramp; prices and costs stay as in the base case. Funding required is the deepest cash position through 2031; in the conservative case losses continue after 2031, so that figure is a floor, not a total.</p>
</section>

<section>
<h2>13. Risks and decisions</h2>
<table class="fin"><thead><tr><th>Risk</th><th>Mitigation</th></tr></thead><tbody>
<tr><td><b>Small market ceiling.</b> Florida alone is about {money(m['sam'], True)} a year; the base case needs {R[13][4]:.0%} of it by 2031</td><td>Lean team; high retention; decision on expansion (below)</td></tr>
<tr><td>Long sales cycles and tight FQHC budgets</td><td>Design-partner references; FACHC channel; entry readiness assessment; tiers sized to budgets</td></tr>
<tr><td>A readiness status is wrong and a customer relies on it</td><td>Every rule cites a verified catalog entry; human advisor verifies the catalog; readiness is labeled internal, never an HRSA determination; errors are severity-1 with regression tests; E&amp;O insurance</td></tr>
<tr><td>Security incident or breach of customer data</td><td>Gated roadmap, encryption, tenant isolation tests, audit log, penetration tests, SOC 2, cyber insurance, tested breach procedure</td></tr>
<tr><td>HRSA policy changes</td><td>Requirements are versioned data; a policy update is a catalog changeset, not a rewrite</td></tr>
<tr><td>AI output is wrong or overreaches</td><td>AI drafts only; never approves or submits; evals gate each capability; off by default per tenant</td></tr>
<tr><td>Key-person dependency (founder)</td><td>Documented decisions (ADRs), runbooks, advisors; second engineer once ARR passes $1.5M</td></tr>
</tbody></table>
<h3>Decisions for the product owner</h3>
<div class="warn">These are not assumed in the base case. Each needs a decision from the product owner (@jselvalugo).</div>
<ol>
  <li><b>Expansion beyond Florida (revisit D4).</b> The Florida market ceiling is the largest risk to the business. Adding states means a
  state profile, exclusion adapter, and license source per state, and the upside is large: the same product sells to health centers
  nationwide. Recommendation: decide by G5 (end of 2027) whether to add a second state in 2029, based on pilot results.</li>
  <li><b>Founder compensation during launch</b> ({money(150000, True)} in the launch budget): pay, defer, or accrue.</li>
  <li><b>Pricing validation</b> with design partners and FACHC before general availability.</li>
  <li><b>Funding path:</b> one raise of {money(m['raise'], True)}, or two tranches (launch now, runway at G4).</li>
</ol>
<p class="small" style="margin-top:14pt">Regulatory statements in this plan are planning assumptions, to be verified against current sources
and, where noted in the roadmap, confirmed by counsel. Readiness in Deemed Health is an internal measure and never an HRSA determination
or certification.</p>
</section>
</body></html>"""


def inline_fonts() -> str:
    """Inter from Google Fonts as an inline @font-face block, so print needs no network."""
    import re
    import ssl
    import urllib.request

    ua = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120"}
    try:
        ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))
        get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=ua), context=ctx, timeout=20).read()
        css = get("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap").decode()
        for url in set(re.findall(r"url\((https://[^)]+)\)", css)):
            css = css.replace(url, "data:font/woff2;base64," + base64.b64encode(get(url)).decode())
        return css
    except OSError:
        return ""  # falls back to the system sans-serif


def render_pdf(html_text: str, out: Path) -> None:
    from playwright.sync_api import sync_playwright

    exe = os.environ.get("CHROMIUM_PATH")
    with tempfile.TemporaryDirectory() as tmp:
        page_file = Path(tmp) / "plan.html"
        page_file.write_text(html_text, encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            page = browser.new_page()
            page.goto(page_file.as_uri(), wait_until="networkidle")
            page.pdf(path=str(out), format="Letter", print_background=True, display_header_footer=True,
                     header_template="<span></span>",
                     footer_template=(
                         '<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5px;color:#64748B;'
                         'padding:0 0.7in;display:flex;justify-content:space-between">'
                         "<span>Deemed Health · Business Plan · Confidential</span>"
                         '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'),
                     margin={"top": "0.7in", "bottom": "0.75in", "left": "0.7in", "right": "0.7in"})
            browser.close()


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        scen = {}
        base_refs = None
        for name, over in SCENARIOS.items():
            d = tmp / name
            d.mkdir()
            src = d / XLSX_OUT.name
            refs = build_workbook(src, over)
            out = d / "calc"
            out.mkdir()
            scen[name] = read_model(recalc(src, out), refs)
            if name == "Base":
                base_refs = refs
                shutil.copy(out / XLSX_OUT.name, XLSX_OUT)
    model = scen["Base"]
    assert base_refs is not None
    html_text = render_html(model, scen)
    (Path(os.environ.get("PLAN_HTML_OUT", tempfile.gettempdir())) / "deemed-health-business-plan.html").write_text(html_text)
    render_pdf(html_text, PDF_OUT)
    print(f"launch total {model['launch_total']:,.0f}; run {[round(x) for x in model['run_total']]}; "
          f"funding {model['funding']:,.0f}; raise {model['raise']:,.0f}")
    print(f"wrote {XLSX_OUT.relative_to(ROOT)} and {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
