# The Gilded Ace client

React, TypeScript, Vite, Tailwind CSS, shadcn/ui and Recharts. The dashboard imports the checked-in study snapshot at build time.

Use Node.js 22.12 or newer. From this directory:

```sh
npm ci
npm run dev
npm run build
npm run copy:html
```

The build runs lint and TypeScript checks, then creates a self-contained `dist/index.html`. Double-click it to open locally, or serve it from a static host. The last command copies that build to the repository’s `dashboard.html` and `index.html`.

To refresh the snapshot after rerunning analysis scripts 01–05, run `python scripts/export_react_data.py` from the repository root. This uses the local Parquet inputs and processed results. The checked-in snapshot supports app builds without Python or the raw dataset.
