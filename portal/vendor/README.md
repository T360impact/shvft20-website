# Vendored libraries

Third-party code the portal loads, served from this site rather than a CDN,
so the Content Security Policy in `../index.html` can allow scripts from
this site only. Each file is the exact release the portal used from a CDN
before (checked byte for byte on 3 November 2026), apart from supabase-js,
which the CDN served as many small modules and is bundled here into one.

| File | Package | Licence | Source | SHA-256 |
| --- | --- | --- | --- | --- |
| `supabase-js-2.45.4.mjs` | @supabase/supabase-js 2.45.4 (auth-js 2.65.0, postgrest-js 1.16.1, realtime-js 2.10.2, storage-js 2.7.0, functions-js 2.4.1) | MIT | npm, bundled with esbuild 0.24.0: `export { createClient } from "@supabase/supabase-js"`, `--format=esm --platform=browser --target=es2020 --minify --legal-comments=eof` | `d1f9db06d2174500dadc3d47bacc6a413597c03c50129f0d223cdeed0f337378` |
| `pdf-3.11.174.min.js` | pdfjs-dist 3.11.174, `build/pdf.min.js` | Apache-2.0 | npm | `5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946` |
| `pdf.worker-3.11.174.min.js` | pdfjs-dist 3.11.174, `build/pdf.worker.min.js` | Apache-2.0 | npm | `feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b` |
| `jszip-3.10.1.min.js` | jszip 3.10.1, `dist/jszip.min.js` | MIT or GPL-3.0 (MIT used) | npm | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| `xlsx-0.20.3.mjs` | SheetJS Community Edition 0.20.3, `package/xlsx.mjs` | Apache-2.0 | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (SheetJS's own release; npm stops at 0.18.5) | `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |

To update one: fetch the new release from the same source, check its
checksum against the upstream release, replace the file (new version in the
name), update the import in the portal and this table. Never edit a vendored
file by hand.
