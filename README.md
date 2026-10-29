# Shvft2.0 website

Static multi-page site for www.shvft20.org. No build step: each page is an `index.html` in its own folder (`about/`, `services/`, `how-we-work/`, `training/`, `for-businesses/`, `contact/`, `governance/`), sharing `styles.css`, `site.js` and `assets/`. Our impact and resources live on the home page; `impact/` only forwards old links to `/#impact`. The header and footer are repeated in every page, so change them in all of them.

Links use root paths (`/about/`), so preview with a local server rather than opening the file:

    python3 -m http.server 8000

## Bid readiness check

The free bid readiness check sits on the home page (`#readiness`), and `readiness/report/` shows the full report from the private link we email. `readiness/` only forwards old links to `/#readiness`.

- `readiness/framework.js` holds the questions, weights, essential (pass or fail) items, capacity flags and scoring, shared by both pages. It is built from the research report "Charity and CIC bid readiness" (October 2026), kept outside this repo in `Shvft 2.0/reports/`. Change `VERSION` whenever a question or weight changes, and review the questions each October.
- Submissions go to the `shvft-readiness-submit` Supabase function (in the Refuse the Box project) and are stored in `public.shvft_readiness_submissions`, with the exact permission wording each person agreed to. The function source lives in `Shvft 2.0/supabase/functions/`.
- Emails need the `SHVFT_SENDER_EMAIL` secret set to a Brevo-verified shvft20.com address; until then submissions are saved but not emailed.
