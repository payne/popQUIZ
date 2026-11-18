# Question pool sources

Public-domain NCVEC question pools (errata applied), downloaded 2026-11-17 from ncvec.org.
`npm run pools` turns these into `public/pools/*.json` and `public/figures/*.png`.

| File | Pool | NCVEC file |
|---|---|---|
| tech-2026.docx | Technician 2026–2030 | 2026-2030 Technician Pool and Syllabus Public Release Feb 19 2026.docx |
| general-2023.docx | General 2023–2027 | General Class Pool and Syllabus 2023-2027 Public Release with 6th Errata Feb 4 2026.docx |
| extra-2024.docx | Extra 2024–2028 | 2024-2028 Extra Class Question Pool and Syllabus Public Release with 4th Errata Feb 4 2026.docx |

The figure PDFs are kept for reference only; figures are extracted from the images embedded in each .docx.
Pool pages: https://www.ncvec.org/index.php/2026-2030-technician-question-pool,
https://www.ncvec.org/index.php/2023-2027-general-question-pool-release,
https://www.ncvec.org/index.php/2024-2028-extra-class-question-pool-release

When NCVEC issues new errata: replace the .docx (same file name), update this table, run `npm run pools && npm test`.
