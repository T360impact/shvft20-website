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
- Every consortium starts in demo mode (`allow_real_records = false`). Switch it in the database only once the DPIA and data processing agreements are signed.

## Design and accessibility

- Icons live in `assets/icons.svg` (line icons in currentColor). Use `<svg><use href="/assets/icons.svg#i-name"/></svg>` inside `<span class="ico g|p|o">`.
- The brand gradient is kept for headline accent words (`.grad-text`) and the "2.0" in the wordmark only.
- Easy read (the "Aa" button in every header) switches to Atkinson Hyperlegible, larger text, more spacing and no motion (same page colours). A line in each page's `<head>` applies the saved choice before first paint; keep it when adding pages.
- Keep sentences short (aim for under 15 words) and use lists rather than long paragraphs.
- Partner logos live in `assets/partners/`; the strip scrolls sideways with a Pause button and stays still for reduced motion and Easy read.
