# Shvft2.0 website

Static multi-page site for www.shvft20.org. No build step: each page is an `index.html` in its own folder (`about/`, `services/`, `how-we-work/`, `training/`, `for-businesses/`, `contact/`, `governance/`), sharing `styles.css`, `site.js` and `assets/`. Our impact and resources live on the home page; `impact/` only forwards old links to `/#impact`. The header and footer are repeated in every page, so change them in all of them.

Links use root paths (`/about/`), so preview with a local server rather than opening the file:

    python3 -m http.server 8000

## Bid readiness check

The free bid readiness check sits on the home page (`#readiness`), and `readiness/report/` shows the full report from the private link we email. `readiness/` only forwards old links to `/#readiness`.

- `readiness/framework.js` holds the questions, weights, essential (pass or fail) items, capacity flags and scoring, shared by both pages. It is built from the research report "Charity and CIC bid readiness" (October 2026), kept outside this repo in `Shvft 2.0/reports/`. Change `VERSION` whenever a question or weight changes, and review the questions each October.
- Submissions go to the `shvft-readiness-submit` Supabase function (in the Refuse the Box project) and are stored in `public.shvft_readiness_submissions`, with the exact permission wording each person agreed to. The function source lives in `Shvft 2.0/supabase/functions/`.
- Emails need the `SHVFT_SENDER_EMAIL` secret set to a Brevo-verified shvft20.org address; until then submissions are saved but not emailed.

## Consortium Portal

`portal/` is the signed-in system for the partners in each consortium Shvft2.0 manages (linked as "Partner sign in" in every footer, and kept out of search engines). It is a small app with no build step: `app.js` handles sign-in, two-step verification and routing, `lib.js` the shared helpers, and each screen is a file in `views/`.

- Data lives in its own Supabase project, "Shvft2.0 Consortium Portal" (London region), never alongside another business's data. `config.js` holds its public key; what anyone can see is enforced by row level security in the database, not by the pages.
- Roles: platform administrator, consortium lead, accountable body, delivery partner manager, hub or session worker, funder observer and youth voice. Young people's records are visible only to the partners linked to them, and only after two-step sign-in. Funder and youth voice views are counts only.
- Young people are registered through `register_young_person()`, which checks name, date of birth and postcode across the whole consortium so nobody is counted twice. Returns are submitted and reviewed through `submit_return()` and `review_return()`; the dashboard comes from `consortium_progress()`.
- Invitations and reset links come from the `portal-admin` function (source in `Shvft 2.0/supabase/functions/`), which returns a one-time link to pass on.
- Bids: a bid workspace is a consortium at the `bid` stage, so invited partners only ever see that bid. `views/bid.js` holds the checklist, uploads (every version kept), review with standard return comments, and the readiness view; partners see their own items and the overall percentage only. `convert_bid()` turns a won bid into the live consortium; `close_bid()` marks it not won. Checklist templates and the partner library (approved documents with an expiry date, reused by `apply_bid_template()` until they lapse) are in `views/library.js`, for Shvft2.0 staff only. Reminders show on each person's home screen for items due within a week or overdue; email reminders need a portal email sender first.
- Targets and budget (`views/targets.js`): the lead uploads programme documents (PDF, Word or Excel, every upload versioned) and runs the `extract-programme-data` function, which reads them with the Claude API and saves each target and budget line with its source passage; quotes that aren't in the document are flagged. The lead reviews each item, and `confirm_extraction()` stays blocked until `intake_review()`'s checks pass (partner targets add up, targeted share meets the minimum, budget equals the grant, nothing unallocated). Changes create new versions (`superseded_by`), nothing is deleted, and only partners whose figures changed confirm again with `confirm_partner_allocation()`. A bid can't be `mark_bid_submitted()` until every partner has confirmed. The function needs an `ANTHROPIC_API_KEY` secret in the portal project.
- Extraction reads documents as written: each line keeps the document's own wording, figure and unit, its section (e.g. Universal or Targeted), whether it's an output or an outcome, its priority and evidence text, and whether it's a yearly or a project-lifetime target (lifetime targets have no year). Outputs and outcomes link to organisations only where the document names them (`named_organisations`); the lead can tick others in review. Links live in `commitment_organisations` and drive the dashboard's "Outputs and outcomes by organisation" chart. Whether the targeted-share minimum applies every year or on average is set per consortium (`targeted_share_basis`).
- People can hold extra roles (org admin, finance, operations, reporting, safeguarding, bid contributor, hub worker) in `membership_roles`, on top of their main role. Budgets are visible to the lead, the accountable body, and a partner's own org admin and finance people.
- Access rule tests for intake live in `Shvft 2.0/supabase/tests/portal_intake_rls.sql`; run them in the SQL editor and expect "PASS".
- Every consortium starts in demo mode (`allow_real_records = false`). Switch it in the database only once the DPIA and data processing agreements are signed.

## Design and accessibility

- Icons live in `assets/icons.svg` (line icons in currentColor). Use `<svg><use href="/assets/icons.svg#i-name"/></svg>` inside `<span class="ico g|p|o">`.
- The brand gradient is kept for headline accent words (`.grad-text`) and the "2.0" in the wordmark only.
- Easy read (the "Aa" button in every header) switches to Atkinson Hyperlegible, larger text, more spacing and no motion (same page colours). A line in each page's `<head>` applies the saved choice before first paint; keep it when adding pages.
- Keep sentences short (aim for under 15 words) and use lists rather than long paragraphs.
- Partner logos live in `assets/partners/`; the strip scrolls sideways with a Pause button and stays still for reduced motion and Easy read.
