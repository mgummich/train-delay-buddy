# Frontend Plan 1 — Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full frontend scaffold — Vite + React 19, design tokens, API codegen, all lib utilities, Zustand stores, router with screen shells, MSW browser worker, i18n, and Docker — so `docker compose up` serves a working (if empty) app and `npm test` passes.

**Architecture:** Single-page React 19 app served by nginx in Docker. All design tokens live in `src/styles/tokens.css` as CSS custom properties consumed by Tailwind. API types auto-generated from `backend/openapi.yaml` via `openapi-typescript`. Stores are Zustand slices; server state is TanStack Query. The `OfflineStateLoader` component uses React 19's `use()` to block render until IndexedDB is hydrated.

**Tech Stack:** React 19, TypeScript 5 strict, Vite 6, Tailwind CSS 3, shadcn/ui, TanStack Query 5, Zustand 5, openapi-fetch, Zod, react-i18next, vite-plugin-pwa, Vitest + RTL, MSW 2, Playwright, idb

**Subsequent plans:**
- Plan 2: StartScreen (train validation form, station autocomplete, plausibility dialog)
- Plan 3: AlternativesScreen (journey creation, alternatives list, filter sheet)
- Plan 4: CompanionScreen (live polling, Perlschnur timeline, map view, offline)

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/package.json` |
| Create | `frontend/index.html` |
| Create | `frontend/vite.config.ts` |
| Create | `frontend/tsconfig.json` |
| Create | `frontend/tsconfig.node.json` |
| Create | `frontend/tailwind.config.ts` |
| Create | `frontend/postcss.config.cjs` |
| Create | `frontend/.eslintrc.cjs` |
| Create | `frontend/.prettierrc` |
| Create | `frontend/.lintstagedrc.cjs` |
| Create | `frontend/src/styles/tokens.css` |
| Create | `frontend/src/index.css` |
| Create | `frontend/public/manifest.json` |
| Create | `frontend/src/api/types.gen.ts` (generated — do not edit) |
| Create | `frontend/src/api/client.ts` |
| Create | `frontend/src/api/validation.ts` |
| Create | `frontend/src/lib/installId.ts` |
| Create | `frontend/src/lib/indexeddb.ts` |
| Create | `frontend/src/lib/datetime.ts` |
| Create | `frontend/src/lib/queryClient.ts` |
| Create | `frontend/src/store/journeyStore.ts` |
| Create | `frontend/src/store/installStore.ts` |
| Create | `frontend/src/store/uiStore.ts` |
| Create | `frontend/src/hooks/useOfflineState.ts` |
| Create | `frontend/src/components/OfflineStateLoader.tsx` |
| Create | `frontend/src/screens/StartScreen.tsx` |
| Create | `frontend/src/screens/AlternativesScreen.tsx` |
| Create | `frontend/src/screens/CompanionScreen.tsx` |
| Create | `frontend/src/screens/SettingsScreen.tsx` |
| Create | `frontend/src/screens/ErrorScreens.tsx` |
| Create | `frontend/src/router.tsx` |
| Create | `frontend/src/main.tsx` |
| Create | `frontend/src/mocks/browser.ts` |
| Create | `frontend/src/i18n/de.json` |
| Create | `frontend/src/i18n/index.ts` |
| Create | `frontend/Dockerfile` |
| Create | `frontend/.dockerignore` |
| Create | `frontend/public/sw-register.js` |
| Modify | `frontend/vitest.config.ts` (already exists — add `setupFiles` path alias check) |
| Create | `frontend/src/test/render.tsx` (RTL wrapper with all providers) |
| Create | `.husky/pre-commit` |

---

### Task 1: Project scaffold — package.json + index.html

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "verspaetungsbegleiter-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --max-warnings 0 && prettier --check src",
    "lint:fix": "eslint src --fix && prettier --write src",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "codegen": "openapi-typescript ../backend/openapi.yaml -o src/api/types.gen.ts",
    "codegen:check": "openapi-typescript ../backend/openapi.yaml --check",
    "size-limit": "size-limit"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^6.28.0",
    "@tanstack/react-query": "^5.62.0",
    "@tanstack/react-virtual": "^3.11.0",
    "zustand": "^5.0.2",
    "openapi-fetch": "^0.13.4",
    "zod": "^3.24.1",
    "react-hook-form": "^7.54.2",
    "@hookform/resolvers": "^3.10.0",
    "react-i18next": "^15.2.0",
    "i18next": "^24.2.0",
    "idb": "^8.0.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-switch": "^1.1.2",
    "@radix-ui/react-toast": "^1.2.4",
    "@radix-ui/react-popover": "^1.1.4",
    "@radix-ui/react-slot": "^1.1.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.7",
    "vite-plugin-pwa": "^0.21.1",
    "typescript": "^5.7.2",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.5.1",
    "autoprefixer": "^10.4.20",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "openapi-typescript": "^7.4.4",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "eslint-plugin-jsx-a11y": "^6.10.2",
    "@typescript-eslint/eslint-plugin": "^8.19.1",
    "@typescript-eslint/parser": "^8.19.1",
    "prettier": "^3.4.2",
    "husky": "^9.1.7",
    "lint-staged": "^15.3.0",
    "vitest": "^3.0.2",
    "@vitest/coverage-v8": "^3.0.2",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/user-event": "^14.5.2",
    "msw": "^2.7.0",
    "fake-indexeddb": "^6.0.0",
    "@playwright/test": "^1.49.1",
    "size-limit": "^11.1.6",
    "@size-limit/preset-app": "^11.1.6"
  },
  "size-limit": [
    {
      "path": "dist/assets/*.js",
      "limit": "200 KB",
      "gzip": true
    }
  ]
}
```

- [ ] **Step 2: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0F766E" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <!-- Google Fonts: Space Grotesk (Display) + IBM Plex Sans (Body) -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <title>VerspätungsBegleiter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Install dependencies**

```bash
cd frontend && npm install
```

Expected: `node_modules` created, no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/index.html frontend/package-lock.json
git commit -m "feat(frontend): add package.json and index.html scaffold"
```

---

### Task 2: TypeScript + Vite config

**Files:**
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/postcss.config.cjs`

- [ ] **Step 1: Create `frontend/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.app.json" }
  ]
}
```

Create `frontend/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

Create `frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts", "postcss.config.cjs"]
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/v1\/journeys\/[^/]+\/summary/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/v1\/stations/,
            handler: 'NetworkOnly',
          },
        ],
        navigateFallback: '/index.html',
      },
      manifest: false, // served from public/manifest.json
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/readyz': 'http://localhost:8080',
    },
  },
})
```

- [ ] **Step 3: Create `frontend/postcss.config.cjs`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npm run typecheck
```

Expected: No errors (only screens stubs exist, empty for now).

- [ ] **Step 5: Commit**

```bash
git add frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/postcss.config.cjs
git commit -m "feat(frontend): add TypeScript and Vite config"
```

---

### Task 3: ESLint + Prettier + Husky

**Files:**
- Create: `frontend/.eslintrc.cjs`
- Create: `frontend/.prettierrc`
- Create: `frontend/.lintstagedrc.cjs`
- Create: `.husky/pre-commit`

- [ ] **Step 1: Create `frontend/.eslintrc.cjs`**

```javascript
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks', 'jsx-a11y'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    'react-hooks/exhaustive-deps': 'error',
    'no-console': ['warn', { allow: ['error', 'warn'] }],
  },
  ignorePatterns: ['src/api/types.gen.ts', 'dist', 'node_modules'],
}
```

- [ ] **Step 2: Create `frontend/.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] **Step 3: Create `frontend/.lintstagedrc.cjs`**

```javascript
module.exports = {
  'src/**/*.{ts,tsx}': ['eslint --max-warnings 0', 'prettier --write'],
}
```

- [ ] **Step 4: Init Husky + add pre-commit hook**

```bash
cd frontend && npx husky init
```

Replace `.husky/pre-commit` with:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
cd frontend && npx lint-staged
```

- [ ] **Step 5: Commit**

```bash
git add frontend/.eslintrc.cjs frontend/.prettierrc frontend/.lintstagedrc.cjs .husky/pre-commit
git commit -m "feat(frontend): add ESLint, Prettier, Husky pre-commit"
```

---

### Task 4: Design tokens + Tailwind CSS + shadcn/ui

**Files:**
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/index.css`

- [ ] **Step 1: Create `frontend/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      colors: {
        'bg-app':        'var(--bg-app)',
        'bg-card':       'var(--bg-card)',
        'bg-subtle':     'var(--bg-subtle)',
        'text-primary':  'var(--text-primary)',
        'text-muted':    'var(--text-muted)',
        'text-faint':    'var(--text-faint)',
        accent:          'var(--accent)',
        'accent-hover':  'var(--accent-hover)',
        'accent-active': 'var(--accent-active)',
        'accent-soft':   'var(--accent-soft)',
        'accent-ink':    'var(--accent-ink)',
        warn:            'var(--warn)',
        'warn-soft':     'var(--warn-soft)',
        'warn-strong':   'var(--warn-strong)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
      },
      borderRadius: {
        input:  'var(--radius-input)',
        card:   'var(--radius-card)',
        sheet:  'var(--radius-sheet)',
        btn:    'var(--radius-btn)',
        badge:  'var(--radius-badge)',
      },
      boxShadow: {
        card:   'var(--shadow-card)',
        lift:   'var(--shadow-lift)',
        sheet:  'var(--shadow-sheet)',
      },
      transitionDuration: {
        fast:   'var(--motion-fast)',
        medium: 'var(--motion-medium)',
        slow:   'var(--motion-slow)',
      },
      transitionTimingFunction: {
        'expo-out': 'var(--ease-out-expo)',
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 2: Create `frontend/src/styles/tokens.css`**

```css
:root {
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;

  /* Backgrounds */
  --bg-app:    #F6F4F2;
  --bg-card:   #FFFFFF;
  --bg-subtle: #F0ECE8;

  /* Text */
  --text-primary: #1F2329;
  --text-muted:   #6B7280;
  --text-faint:   #9CA3AF;

  /* Accent */
  --accent:        #0F766E;
  --accent-hover:  #0D615B;
  --accent-active: #0B4B47;
  --accent-soft:   #E2EFEC;
  --accent-ink:    #FFFFFF;

  /* Warn */
  --warn:        #DC6B33;
  --warn-soft:   #FBEADF;
  --warn-strong: #B91C1C;

  /* Borders */
  --border-subtle: #E5E7EB;
  --border-strong: #D1D5DB;

  /* Radius */
  --radius-input: 10px;
  --radius-card:  14px;
  --radius-sheet: 22px;
  --radius-btn:   12px;
  --radius-badge: 999px;

  /* Shadows */
  --shadow-card:  0 1px 2px rgba(31,35,41,.04), 0 4px 16px rgba(31,35,41,.06);
  --shadow-lift:  0 2px 4px rgba(31,35,41,.06), 0 12px 28px rgba(31,35,41,.10);
  --shadow-sheet: 0 -8px 40px rgba(0,0,0,.18);

  /* Motion */
  --motion-fast:   150ms;
  --motion-medium: 220ms;
  --motion-slow:   300ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-app:        #111827;
    --bg-card:       #1F2933;
    --bg-subtle:     #19212E;
    --text-primary:  #E5E7EB;
    --text-muted:    #9CA3AF;
    --text-faint:    #6B7280;
    --accent:        #34D399;
    --accent-hover:  #2BBE85;
    --accent-active: #25A874;
    --accent-soft:   #15302B;
    --accent-ink:    #06241C;
    --warn:          #F97316;
    --warn-soft:     #3A2415;
    --warn-strong:   #F87171;
    --border-subtle: #2B3543;
    --border-strong: #3A4658;
    --shadow-card:   0 1px 2px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.32);
    --shadow-lift:   0 2px 4px rgba(0,0,0,.34), 0 12px 28px rgba(0,0,0,.36);
  }
}

/* ── Animations ──────────────────────────────────────────────────── */

@keyframes vb-pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--bg-card), 0 0 0 6px var(--accent-soft); }
  50%       { box-shadow: 0 0 0 4px var(--bg-card), 0 0 0 10px transparent; }
}
@keyframes vb-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
@keyframes vb-train-scroll {
  0%   { top: 20%; }
  100% { top: 80%; }
}

.vb-pulse { animation: vb-pulse 2.4s ease-in-out infinite; }
.vb-blink { animation: vb-blink 1.6s ease-in-out infinite; }
.vb-train { animation: vb-train-scroll 3s linear infinite; }

.tnum {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── Focus visible ───────────────────────────────────────────────── */

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .vb-pulse, .vb-blink, .vb-train { animation: none; }
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
}

/* ── Screen transitions ──────────────────────────────────────────── */

::view-transition-old(root) {
  animation: slide-out var(--motion-medium) var(--ease-out-expo);
}
::view-transition-new(root) {
  animation: slide-in var(--motion-medium) var(--ease-out-expo);
}

@keyframes slide-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(-16px); }
}
@keyframes slide-in {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

- [ ] **Step 3: Create `frontend/src/index.css`**

```css
@import './styles/tokens.css';
@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  font-size: 100%;
  font-family: var(--font-body);
  color: var(--text-primary);
  background-color: var(--bg-app);
}

body {
  overscroll-behavior-y: contain;
  -webkit-font-smoothing: antialiased;
}

/* iOS safe area */
.safe-top    { padding-top:    max(env(safe-area-inset-top), 16px); }
.safe-bottom { padding-bottom: max(env(safe-area-inset-bottom), 16px); }
```

- [ ] **Step 4: Init shadcn/ui**

```bash
cd frontend && npx shadcn-ui@latest init --yes --base-color slate --css-variables
```

When prompted: use `tailwind.config.ts`, globals at `src/index.css`, components at `src/components/ui`.

Then add components:

```bash
npx shadcn-ui@latest add dialog sheet switch toast popover badge button skeleton
```

- [ ] **Step 5: Verify Tailwind builds**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: build succeeds with CSS output.

- [ ] **Step 6: Commit**

```bash
git add frontend/tailwind.config.ts frontend/src/styles/tokens.css frontend/src/index.css frontend/src/components/ui/
git commit -m "feat(frontend): add design tokens, Tailwind config, shadcn/ui primitives"
```

---

### Task 5: PWA manifest

**Files:**
- Create: `frontend/public/manifest.json`
- Create: `frontend/public/favicon.svg`

- [ ] **Step 1: Create `frontend/public/manifest.json`**

```json
{
  "name": "VerspätungsBegleiter",
  "short_name": "VerspätungsB.",
  "description": "Schneller ans Ziel — ab deinem jetzigen Zug.",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F6F4F2",
  "theme_color": "#0F766E",
  "lang": "de",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 2: Create placeholder `frontend/public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0F766E"/>
  <circle cx="11" cy="20" r="2.5" fill="white"/>
  <circle cx="21" cy="20" r="2.5" fill="white"/>
  <rect x="7" y="10" width="18" height="9" rx="3" fill="white"/>
</svg>
```

Create placeholder icon directories (actual icons are design assets):

```bash
mkdir -p frontend/public/icons
# Copy favicon as placeholder — real icons come from design handoff
cp frontend/public/favicon.svg frontend/public/icons/icon-192.png 2>/dev/null || touch frontend/public/icons/icon-192.png
touch frontend/public/icons/icon-512.png
```

- [ ] **Step 3: Commit**

```bash
git add frontend/public/
git commit -m "feat(frontend): add PWA manifest and icons"
```

---

### Task 6: API types codegen

**Files:**
- Create: `frontend/src/api/types.gen.ts` (generated)

- [ ] **Step 1: Run codegen**

```bash
cd frontend && npm run codegen
```

Expected: `src/api/types.gen.ts` created from `../backend/openapi.yaml`.

- [ ] **Step 2: Verify existing test files now typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | head -20
```

Expected: 0 errors. The pre-existing `src/test/msw-handlers.ts` and `src/test/factories.ts` import from `@/api/types.gen` — they must pass.

- [ ] **Step 3: Add codegen output to `.gitignore` note**

`types.gen.ts` should be committed (CI needs it for the `--check` gate). Add to `frontend/.gitignore`:

```
dist/
node_modules/
*.local
coverage/
playwright-report/
```

Note: `src/api/types.gen.ts` is intentionally committed so CI diff-check works without running codegen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.gen.ts frontend/.gitignore
git commit -m "feat(frontend): generate API types from openapi.yaml"
```

---

### Task 7: API client (`client.ts`)

**Files:**
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Create `frontend/src/api/client.ts`**

```typescript
import createClient from 'openapi-fetch'
import type { paths } from './types.gen'
import { getInstallId } from '@/lib/installId'

let installIdCache = ''

async function resolveInstallId(): Promise<string> {
  if (!installIdCache) {
    installIdCache = await getInstallId()
  }
  return installIdCache
}

export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
})

// Inject X-Install-Id on every request
apiClient.use({
  async onRequest({ request }) {
    request.headers.set('X-Install-Id', await resolveInstallId())
    return request
  },
})

/**
 * DELETE /v1/journeys/{id} returns 404 on second call by design (non-idempotent).
 * Callers should treat 404 on DELETE as a no-op, not an error.
 */
export function isDeleteNotFound(status: number, url: string): boolean {
  return status === 404 && /\/v1\/journeys\/[^/]+$/.test(url)
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | grep -E "error|warning" | head -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(frontend): add openapi-fetch typed API client with Install-Id injection"
```

---

### Task 8: Zod validation schemas

**Files:**
- Create: `frontend/src/api/validation.ts`
- Test: `frontend/src/api/validation.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/api/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { journeyIdSchema, journeySummarySchema, safeParse } from './validation'

describe('journeyIdSchema', () => {
  it('accepts valid journeyId', () => {
    expect(journeyIdSchema.safeParse('jrn_01j2k3m4n5p6').success).toBe(true)
  })
  it('rejects short id', () => {
    expect(journeyIdSchema.safeParse('jrn_short').success).toBe(false)
  })
  it('rejects wrong prefix', () => {
    expect(journeyIdSchema.safeParse('bad_01j2k3m4n5p6q7r8').success).toBe(false)
  })
})

describe('safeParse', () => {
  it('returns valid data unchanged', () => {
    const id = 'jrn_01j2k3m4n5p6'
    expect(safeParse(journeyIdSchema, id)).toBe(id)
  })
  it('returns raw data on schema failure without throwing', () => {
    // safeParse must never throw — live journeys must not crash
    expect(() => safeParse(journeyIdSchema, 12345)).not.toThrow()
  })
})

describe('journeySummarySchema', () => {
  it('accepts minimal valid summary', () => {
    const summary = {
      eta: '2026-06-11T17:24:00Z',
      status: 'ok',
      timeGainVsOriginalMinutes: 18,
      timeGainVsCurrentRouteMinutes: null,
      minTransferBufferMinutes: 9,
      criticalTransfer: false,
      alternativeAvailable: false,
      dataConfidence: 'high',
      nextStep: null,
      dataFetchedAt: '2026-06-11T15:23:45Z',
      lastUpdatedAt: '2026-06-11T15:00:12Z',
    }
    expect(journeySummarySchema.safeParse(summary).success).toBe(true)
  })
  it('rejects unknown status value', () => {
    const bad = { status: 'pending' }
    expect(journeySummarySchema.safeParse(bad).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/api/validation.test.ts
```

Expected: FAIL — `validation.ts` does not exist.

- [ ] **Step 3: Create `frontend/src/api/validation.ts`**

```typescript
import { z } from 'zod'

export const journeyIdSchema = z.string().regex(/^jrn_[0-9a-z]{12,26}$/)

const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const stationsResponseSchema = z.object({
  stations: z.array(stationSchema),
})

export const trainResponseSchema = z.object({
  trainNumber: z.string(),
  date: z.string(),
  origin: stationSchema,
  destination: stationSchema,
  stops: z.array(z.unknown()),
  status: z.enum(['running', 'cancelled', 'unknown']),
})

const nextStepSchema = z.object({
  type: z.enum(['ride', 'transfer', 'disembark']),
  stationName: z.string(),
  stationId: z.string(),
  trainNumber: z.string().nullable(),
  platform: z.string().nullable(),
  departureTime: z.string().nullable(),
  bufferMinutes: z.number().int().nullable(),
}).nullable()

export const journeySummarySchema = z.object({
  eta: z.string(),
  status: z.enum(['ok', 'critical', 'failed']),
  timeGainVsOriginalMinutes: z.number().nullable(),
  timeGainVsCurrentRouteMinutes: z.number().nullable(),
  minTransferBufferMinutes: z.number(),
  criticalTransfer: z.boolean(),
  alternativeAvailable: z.boolean(),
  dataConfidence: z.enum(['high', 'low', 'unavailable']),
  nextStep: nextStepSchema,
  dataFetchedAt: z.string(),
  lastUpdatedAt: z.string(),
})

export type JourneySummary = z.infer<typeof journeySummarySchema>
export type NextStep = NonNullable<z.infer<typeof nextStepSchema>>

/**
 * Parse API response through schema. On failure: log the drift and return
 * raw data — never throw, because crashing a live journey is worse than
 * showing slightly stale data.
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.error('[API schema drift]', result.error.issues)
    return data as T
  }
  return result.data
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/api/validation.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/validation.ts frontend/src/api/validation.test.ts
git commit -m "feat(frontend): add Zod API validation schemas"
```

---

### Task 9: installId utility

**Files:**
- Create: `frontend/src/lib/installId.ts`
- Test: `frontend/src/lib/installId.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/installId.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getInstallId } from './installId'

// fake-indexeddb is set up in src/test/setup.ts (injected globally)

describe('getInstallId', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset IDB between tests by using unique names — handled by fake-indexeddb reset
  })

  it('generates a UUID v4 on first call', async () => {
    const id = await getInstallId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('returns the same id on subsequent calls', async () => {
    const id1 = await getInstallId()
    const id2 = await getInstallId()
    expect(id1).toBe(id2)
  })

  it('returns localStorage value if IndexedDB is empty', async () => {
    const stored = '550e8400-e29b-41d4-a716-446655440000'
    localStorage.setItem('vbb_install_id', stored)
    const id = await getInstallId()
    expect(id).toBe(stored)
  })

  it('backfills localStorage from IndexedDB value', async () => {
    const id = await getInstallId()
    expect(localStorage.getItem('vbb_install_id')).toBe(id)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/lib/installId.test.ts
```

Expected: FAIL — `installId.ts` does not exist.

- [ ] **Step 3: Create `frontend/src/lib/installId.ts`**

```typescript
import { openDB } from 'idb'

const DB_NAME   = 'vb-install'
const STORE     = 'kv'
const IDB_KEY   = 'install_id'
const LS_KEY    = 'vbb_install_id'

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE)
    },
  })
}

export async function getInstallId(): Promise<string> {
  // 1. Try IndexedDB (primary)
  try {
    const db = await getDB()
    const existing: string | undefined = await db.get(STORE, IDB_KEY)
    if (existing) {
      localStorage.setItem(LS_KEY, existing) // keep LS in sync as backup
      return existing
    }
  } catch {
    // IndexedDB unavailable (Safari private, quota exceeded, etc.)
  }

  // 2. Fall back to localStorage
  const lsId = localStorage.getItem(LS_KEY)
  if (lsId) {
    try {
      const db = await getDB()
      await db.put(STORE, lsId, IDB_KEY)
    } catch {}
    return lsId
  }

  // 3. Generate new ID
  const id = crypto.randomUUID()
  try {
    const db = await getDB()
    await db.put(STORE, id, IDB_KEY)
  } catch {}
  localStorage.setItem(LS_KEY, id)
  return id
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/lib/installId.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/installId.ts frontend/src/lib/installId.test.ts
git commit -m "feat(frontend): add installId utility with IDB+localStorage persistence"
```

---

### Task 10: IndexedDB journey cache

**Files:**
- Create: `frontend/src/lib/indexeddb.ts`
- Test: `frontend/src/lib/indexeddb.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/indexeddb.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { saveJourney, loadJourney, clearJourney, SCHEMA_VERSION } from './indexeddb'

const SAMPLE = {
  journeyId: 'jrn_01j2k3m4n5p6',
  etag: '"jrn_01j2k3m4n5p6:epoch:42"',
  summary: { eta: '2026-06-11T17:24:00Z', status: 'ok' },
  savedAt: '2026-06-11T15:00:00Z',
}

describe('indexeddb journey cache', () => {
  it('returns null when nothing saved', async () => {
    expect(await loadJourney()).toBeNull()
  })

  it('saves and loads journey', async () => {
    await saveJourney(SAMPLE)
    const loaded = await loadJourney()
    expect(loaded?.journeyId).toBe(SAMPLE.journeyId)
    expect(loaded?.etag).toBe(SAMPLE.etag)
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('drops entry when schemaVersion mismatches', async () => {
    await saveJourney(SAMPLE)
    // Simulate old schema version by patching the stored value directly
    const { openDB } = await import('idb')
    const db = await openDB('vb-app', 1)
    await db.put('journey', { ...SAMPLE, schemaVersion: 0 }, 'active')
    db.close()

    const loaded = await loadJourney()
    expect(loaded).toBeNull()
  })

  it('clearJourney removes the entry', async () => {
    await saveJourney(SAMPLE)
    await clearJourney()
    expect(await loadJourney()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/lib/indexeddb.test.ts
```

Expected: FAIL — `indexeddb.ts` does not exist.

- [ ] **Step 3: Create `frontend/src/lib/indexeddb.ts`**

```typescript
import { openDB } from 'idb'

export const SCHEMA_VERSION = 1

export interface JourneyCache {
  schemaVersion: number
  journeyId: string
  etag: string | null
  summary: unknown
  savedAt: string
}

const DB_NAME      = 'vb-app'
const JOURNEY_STORE = 'journey'
const ACTIVE_KEY    = 'active'

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(JOURNEY_STORE)
    },
  })
}

export async function saveJourney(
  data: Omit<JourneyCache, 'schemaVersion'>
): Promise<void> {
  const db = await getDB()
  await db.put(JOURNEY_STORE, { ...data, schemaVersion: SCHEMA_VERSION }, ACTIVE_KEY)
}

export async function loadJourney(): Promise<JourneyCache | null> {
  const db = await getDB()
  const raw: JourneyCache | undefined = await db.get(JOURNEY_STORE, ACTIVE_KEY)
  if (!raw) return null
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    await db.delete(JOURNEY_STORE, ACTIVE_KEY)
    return null
  }
  return raw
}

export async function clearJourney(): Promise<void> {
  const db = await getDB()
  await db.delete(JOURNEY_STORE, ACTIVE_KEY)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/lib/indexeddb.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/indexeddb.ts frontend/src/lib/indexeddb.test.ts
git commit -m "feat(frontend): add IndexedDB journey cache with schema versioning"
```

---

### Task 11: datetime utility

**Files:**
- Create: `frontend/src/lib/datetime.ts`
- Test: `frontend/src/lib/datetime.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/datetime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatTime, formatDateTime, minutesSince } from './datetime'
import { DST_SAMPLES } from '@/test/factories'

describe('formatTime', () => {
  it('formats UTC timestamp as Europe/Berlin time (summer, UTC+2)', () => {
    // 17:24 UTC = 19:24 Berlin (CEST)
    expect(formatTime(DST_SAMPLES.summerTime)).toBe('19:24')
  })

  it('formats UTC timestamp as Europe/Berlin time (winter, UTC+1)', () => {
    // 17:24 UTC = 18:24 Berlin (CET)
    expect(formatTime(DST_SAMPLES.winterTime)).toBe('18:24')
  })
})

describe('minutesSince', () => {
  it('returns positive minutes for past timestamps', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(minutesSince(twoMinutesAgo)).toBe(2)
  })

  it('returns 0 for current timestamp', () => {
    const now = new Date().toISOString()
    expect(minutesSince(now)).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/lib/datetime.test.ts
```

Expected: FAIL — `datetime.ts` does not exist.

- [ ] **Step 3: Create `frontend/src/lib/datetime.ts`**

```typescript
const BERLIN_TZ = 'Europe/Berlin'
const LOCALE    = 'de-DE'

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone:  BERLIN_TZ,
  hour:      '2-digit',
  minute:    '2-digit',
  hour12:    false,
})

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone:  BERLIN_TZ,
  dateStyle: 'short',
  timeStyle: 'short',
})

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })

/** Format ISO UTC string as HH:MM in Europe/Berlin. */
export function formatTime(isoUtc: string): string {
  return timeFormatter.format(new Date(isoUtc))
}

/** Format ISO UTC string as short date+time in Europe/Berlin. */
export function formatDateTime(isoUtc: string): string {
  return dateTimeFormatter.format(new Date(isoUtc))
}

/** Human-readable relative time ("vor 2 Minuten"). */
export function formatRelative(isoUtc: string): string {
  const diffMs  = new Date(isoUtc).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute')
  return relativeFormatter.format(Math.round(diffMin / 60), 'hour')
}

/** How many full minutes ago was this timestamp (positive = past). */
export function minutesSince(isoUtc: string): number {
  return Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60_000)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/lib/datetime.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/datetime.ts frontend/src/lib/datetime.test.ts
git commit -m "feat(frontend): add datetime utility with Europe/Berlin formatting"
```

---

### Task 12: TanStack Query client

**Files:**
- Create: `frontend/src/lib/queryClient.ts`
- Test: `frontend/src/lib/queryClient.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/queryClient.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { queryKeys } from './queryClient'

describe('queryKeys', () => {
  it('journeyFull key includes id', () => {
    expect(queryKeys.journeyFull('jrn_abc')).toEqual(['journey', 'full', 'jrn_abc'])
  })

  it('journeySummary key differs from journeyFull', () => {
    const full    = queryKeys.journeyFull('jrn_abc')
    const summary = queryKeys.journeySummary('jrn_abc')
    expect(full).not.toEqual(summary)
  })

  it('stations key includes query string', () => {
    expect(queryKeys.stations('Frank')).toEqual(['stations', 'Frank'])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/lib/queryClient.test.ts
```

Expected: FAIL — `queryClient.ts` does not exist.

- [ ] **Step 3: Create `frontend/src/lib/queryClient.ts`**

```typescript
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  0,
      gcTime:     5 * 60_000,
      retry: (failureCount, error: unknown) => {
        if (error instanceof Response && error.status < 500) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex, error: unknown) => {
        // Honour Retry-After on 429 responses
        if (error instanceof Response && error.status === 429) {
          const retryAfter = error.headers.get('Retry-After')
          if (retryAfter) {
            return parseInt(retryAfter, 10) * 1000 * 2 ** attemptIndex
          }
        }
        return Math.min(1000 * 2 ** attemptIndex, 30_000)
      },
    },
  },
})

export const queryKeys = {
  journeyFull:         (id: string) => ['journey', 'full',         id] as const,
  journeySummary:      (id: string) => ['journey', 'summary',      id] as const,
  journeyLegs:         (id: string) => ['journey', 'legs',         id] as const,
  journeyAlternatives: (id: string) => ['journey', 'alternatives', id] as const,
  stations:            (q: string)  => ['stations', q]                 as const,
  train: (number: string, date: string) => ['train', number, date]     as const,
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/lib/queryClient.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/queryClient.ts frontend/src/lib/queryClient.test.ts
git commit -m "feat(frontend): add TanStack Query client with retry + Retry-After support"
```

---

### Task 13: Zustand stores

**Files:**
- Create: `frontend/src/store/journeyStore.ts`
- Create: `frontend/src/store/installStore.ts`
- Create: `frontend/src/store/uiStore.ts`
- Test: `frontend/src/store/stores.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/store/stores.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useJourneyStore } from './journeyStore'
import { useInstallStore } from './installStore'
import { useUIStore } from './uiStore'

// Reset Zustand stores between tests
beforeEach(() => {
  useJourneyStore.setState({
    journeyId: null, etag: null, status: null, alternativeAvailable: false,
  })
  useUIStore.setState({ confirmDialogOpen: false, toasts: [] })
})

describe('journeyStore', () => {
  it('starts with null journeyId', () => {
    expect(useJourneyStore.getState().journeyId).toBeNull()
  })

  it('setJourney stores id and etag', () => {
    useJourneyStore.getState().setJourney('jrn_abc', '"etag:1"')
    const { journeyId, etag } = useJourneyStore.getState()
    expect(journeyId).toBe('jrn_abc')
    expect(etag).toBe('"etag:1"')
  })

  it('clearJourney resets all fields', () => {
    useJourneyStore.getState().setJourney('jrn_abc', '"etag:1"')
    useJourneyStore.getState().clearJourney()
    expect(useJourneyStore.getState().journeyId).toBeNull()
    expect(useJourneyStore.getState().etag).toBeNull()
  })

  it('setStatus updates status and alternativeAvailable', () => {
    useJourneyStore.getState().setStatus('critical', true)
    expect(useJourneyStore.getState().status).toBe('critical')
    expect(useJourneyStore.getState().alternativeAvailable).toBe(true)
  })
})

describe('installStore', () => {
  it('default filters have dbOnly: true', () => {
    expect(useInstallStore.getState().filters.dbOnly).toBe(true)
  })

  it('setFilters merges partial update', () => {
    useInstallStore.getState().setFilters({ dbOnly: false })
    expect(useInstallStore.getState().filters.dbOnly).toBe(false)
    expect(useInstallStore.getState().filters.safetyLevel).toBe('normal')
  })
})

describe('uiStore', () => {
  it('addToast appends with unique id', () => {
    useUIStore.getState().addToast('Something went wrong')
    const { toasts } = useUIStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.message).toBe('Something went wrong')
    expect(toasts[0]?.id).toBeTruthy()
  })

  it('removeToast removes by id', () => {
    useUIStore.getState().addToast('Error A')
    useUIStore.getState().addToast('Error B')
    const id = useUIStore.getState().toasts[0]!.id
    useUIStore.getState().removeToast(id)
    expect(useUIStore.getState().toasts).toHaveLength(1)
    expect(useUIStore.getState().toasts[0]?.message).toBe('Error B')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/store/stores.test.ts
```

Expected: FAIL — store files do not exist.

- [ ] **Step 3: Create `frontend/src/store/journeyStore.ts`**

```typescript
import { create } from 'zustand'

interface JourneyState {
  journeyId:            string | null
  etag:                 string | null
  status:               'ok' | 'critical' | 'failed' | null
  alternativeAvailable: boolean
  setJourney:           (id: string, etag: string | null) => void
  setStatus:            (status: 'ok' | 'critical' | 'failed', alternativeAvailable: boolean) => void
  setEtag:              (etag: string) => void
  clearJourney:         () => void
}

export const useJourneyStore = create<JourneyState>((set) => ({
  journeyId:            null,
  etag:                 null,
  status:               null,
  alternativeAvailable: false,

  setJourney:   (journeyId, etag) => set({ journeyId, etag }),
  setStatus:    (status, alternativeAvailable) => set({ status, alternativeAvailable }),
  setEtag:      (etag) => set({ etag }),
  clearJourney: () => set({ journeyId: null, etag: null, status: null, alternativeAvailable: false }),
}))
```

- [ ] **Step 4: Create `frontend/src/store/installStore.ts`**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface JourneyFilters {
  dbOnly:       boolean
  maxTransfers: number | null
  safetyLevel:  'aggressive' | 'normal' | 'cautious'
}

const defaultFilters: JourneyFilters = {
  dbOnly:       true,
  maxTransfers: null,
  safetyLevel:  'normal',
}

interface InstallState {
  installId:    string
  filters:      JourneyFilters
  setInstallId: (id: string) => void
  setFilters:   (filters: Partial<JourneyFilters>) => void
}

export const useInstallStore = create<InstallState>()(
  persist(
    (set) => ({
      installId: '',
      filters:   defaultFilters,
      setInstallId: (installId) => set({ installId }),
      setFilters:   (partial) =>
        set((state) => ({ filters: { ...state.filters, ...partial } })),
    }),
    {
      name:       'vb-install',
      partialize: (state) => ({ installId: state.installId, filters: state.filters }),
    }
  )
)
```

- [ ] **Step 5: Create `frontend/src/store/uiStore.ts`**

```typescript
import { create } from 'zustand'

export interface Toast {
  id:      string
  message: string
  type:    'error' | 'info'
}

interface UIState {
  confirmDialogOpen: boolean
  toasts:            Toast[]
  openConfirmDialog:  () => void
  closeConfirmDialog: () => void
  addToast:           (message: string, type?: Toast['type']) => void
  removeToast:        (id: string) => void
}

export const useUIStore = create<UIState>((set) => ({
  confirmDialogOpen: false,
  toasts:            [],

  openConfirmDialog:  () => set({ confirmDialogOpen: true }),
  closeConfirmDialog: () => set({ confirmDialogOpen: false }),
  addToast: (message, type = 'error') =>
    set((state) => ({
      toasts: [...state.toasts, { id: crypto.randomUUID(), message, type }],
    })),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
```

- [ ] **Step 6: Run test — expect pass**

```bash
cd frontend && npx vitest run src/store/stores.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/
git commit -m "feat(frontend): add Zustand stores (journey, install, ui)"
```

---

### Task 14: OfflineStateLoader + useOfflineState

**Files:**
- Create: `frontend/src/hooks/useOfflineState.ts`
- Create: `frontend/src/components/OfflineStateLoader.tsx`
- Test: `frontend/src/hooks/useOfflineState.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useOfflineState.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { Suspense } from 'react'
import { OfflineStateLoader } from '@/components/OfflineStateLoader'
import { useJourneyStore } from '@/store/journeyStore'
import { saveJourney, clearJourney } from '@/lib/indexeddb'

beforeEach(async () => {
  await clearJourney()
  useJourneyStore.setState({ journeyId: null, etag: null, status: null, alternativeAvailable: false })
})

function TestChild() {
  const { journeyId } = useJourneyStore()
  return <div data-testid="journey-id">{journeyId ?? 'none'}</div>
}

describe('OfflineStateLoader', () => {
  it('renders children without hydrating when IndexedDB is empty', async () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <OfflineStateLoader>
          <TestChild />
        </OfflineStateLoader>
      </Suspense>
    )
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull())
    expect(screen.getByTestId('journey-id').textContent).toBe('none')
  })

  it('hydrates journeyStore from IndexedDB before rendering children', async () => {
    await saveJourney({
      journeyId: 'jrn_cached01234567',
      etag:      '"cached:epoch:1"',
      summary:   {},
      savedAt:   new Date().toISOString(),
    })

    render(
      <Suspense fallback={<div>loading</div>}>
        <OfflineStateLoader>
          <TestChild />
        </OfflineStateLoader>
      </Suspense>
    )

    await waitFor(() =>
      expect(screen.getByTestId('journey-id').textContent).toBe('jrn_cached01234567')
    )
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/hooks/useOfflineState.test.tsx
```

Expected: FAIL — `OfflineStateLoader.tsx` does not exist.

- [ ] **Step 3: Create `frontend/src/hooks/useOfflineState.ts`**

```typescript
import { loadJourney } from '@/lib/indexeddb'
import { useJourneyStore } from '@/store/journeyStore'

/** Promise that resolves once IndexedDB has been read and Zustand hydrated. */
export function createOfflineStatePromise(): Promise<void> {
  return loadJourney().then((cached) => {
    if (cached) {
      useJourneyStore.getState().setJourney(cached.journeyId, cached.etag)
    }
  })
}
```

- [ ] **Step 4: Create `frontend/src/components/OfflineStateLoader.tsx`**

```typescript
import { use, useRef, type ReactNode } from 'react'
import { createOfflineStatePromise } from '@/hooks/useOfflineState'

// Singleton promise — created once, shared across renders.
// React's `use()` will suspend until it resolves.
let hydrationPromise: Promise<void> | null = null

function getHydrationPromise(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = createOfflineStatePromise()
  }
  return hydrationPromise
}

/**
 * Wraps RouterProvider. Suspends (via React 19 `use()`) until IndexedDB
 * has been read and journeyStore hydrated. This guarantees the router
 * loaders see the correct journeyId on cold start / refresh.
 *
 * Must be wrapped in <Suspense> in main.tsx.
 *
 * Do NOT use useEffect+useState here — that does not block render.
 */
export function OfflineStateLoader({ children }: { children: ReactNode }) {
  use(getHydrationPromise())
  return <>{children}</>
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/hooks/useOfflineState.test.tsx
```

Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useOfflineState.ts frontend/src/components/OfflineStateLoader.tsx frontend/src/hooks/useOfflineState.test.tsx
git commit -m "feat(frontend): add OfflineStateLoader with React 19 use() for IDB hydration"
```

---

### Task 15: Router + screen shells + i18n

**Files:**
- Create: `frontend/src/screens/StartScreen.tsx`
- Create: `frontend/src/screens/AlternativesScreen.tsx`
- Create: `frontend/src/screens/CompanionScreen.tsx`
- Create: `frontend/src/screens/SettingsScreen.tsx`
- Create: `frontend/src/screens/ErrorScreens.tsx`
- Create: `frontend/src/router.tsx`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/i18n/de.json`
- Create: `frontend/src/i18n/index.ts`

- [ ] **Step 1: Create i18n scaffold**

Create `frontend/src/i18n/de.json`:

```json
{
  "app": {
    "name": "VerspätungsBegleiter"
  },
  "start": {
    "title": "Schneller ans Ziel — ab deinem jetzigen Zug.",
    "subtitle": "Wir überwachen deine Verbindung und finden Wege, die früher ankommen — auch mit mehr Umstiegen.",
    "infoLine": "Fokus: schnellere Ankunft — kein Ticketverkauf, keine offizielle DB-App.",
    "eyebrow": "Live-Umleitung",
    "trainField": "Zugnummer",
    "destinationField": "Zielbahnhof",
    "onTrainToggle": "Ich sitze in diesem Zug",
    "onTrainSub": "Wir nehmen deine aktuelle Position als Startpunkt.",
    "submitBtn": "Beste Verbindung jetzt finden",
    "secondaryLink": "Stattdessen Start- und Zielbahnhof eingeben",
    "trainNotFound": "Zug nicht gefunden für heute",
    "noStation": "Kein Bahnhof gefunden",
    "plausibilityTitle": "Bist du in diesem Zug?",
    "plausibilityBody": "Wir konnten nicht sicher feststellen, dass du gerade in diesem Zug bist.",
    "plausibilityConfirm": "Ja, Route planen",
    "plausibilityDeny": "Nein, ich sitze nicht in diesem Zug"
  },
  "alternatives": {
    "eyebrow": "Alternativen",
    "heading": "Bessere Verbindungen gefunden",
    "currentTrain": "Dein aktueller Zug bringt dich voraussichtlich um {{time}} ans Ziel.",
    "activeRoute": "Deine derzeit überwachte Route → Ankunft {{time}}.",
    "footer": "Verbindungen werden alle 30 Sekunden neu berechnet.",
    "filterBtn": "Filter",
    "filterReset": "Zurücksetzen",
    "recalcBtn": "Neu berechnen",
    "selectRoute": "Diese Route wählen",
    "empty": {
      "heading": "Aktuell keine schnellere Verbindung",
      "body": "Dein jetziger Zug ist gerade die beste Option. Wir suchen weiter und melden uns, sobald etwas Schnelleres auftaucht.",
      "liveBadge": "Live-Überwachung aktiv",
      "notifyToggle": "Benachrichtigen, wenn schneller möglich",
      "notifySub": "Push, sobald eine frühere Ankunft auftaucht.",
      "loosFilters": "Filter lockern"
    }
  },
  "companion": {
    "eyebrow": "Reisebegleiter",
    "timeGain": "{{minutes}} Min schneller",
    "vsOriginal": "als dein ursprünglicher Zug · Ankunft {{time}}",
    "vsSchedule": "Gegenüber Fahrplan: +{{minutes}} Min Verspätung",
    "jumpToNow": "Jetzt",
    "jumpToNowLabel": "Zum aktuellen Halt springen",
    "timeline": "Timeline",
    "map": "Karte",
    "mapNote": "Schematische Übersicht zur Orientierung. Die **Timeline** bleibt der genaue Fahrplan mit Zeiten und Puffern.",
    "transfer": "Umstieg · Puffer {{buffer}} Min",
    "transferNext": "Weiter mit {{train}} ab Gleis {{platform}}.",
    "transferCritical": "Umstieg kritisch — Alternative ansehen →",
    "currentLeg": "Jetzt unterwegs · +{{delay}} Min",
    "destination": "Ziel",
    "boarding": "Eingestiegen",
    "punctual": "pünktl.",
    "platform": "Gl {{n}}",
    "finishBtn": "Reise abschließen",
    "finishConfirm": "Möchtest du die Route-Überwachung beenden?",
    "expired": "Deine Reise ist abgelaufen.",
    "expiredCta": "Neue Verbindung suchen",
    "notMonitored": "Diese Route wird nicht überwacht. Tippe hier, um sie als aktive Reise zu überwachen.",
    "stale3": "Möglicherweise veraltet",
    "stale10": "Daten veraltet – kein Netz?",
    "nextStep": {
      "transfer": "In {{minutes}} Min in {{station}} aussteigen. Anschluss: {{train}} ab Gleis {{platform}} · Puffer {{buffer}} Min",
      "disembark": "Ziel erreicht: {{station}}.",
      "ride": "Im Zug bleiben bis {{station}}."
    },
    "status": {
      "critical": "Umstieg kritisch — Alternative ansehen",
      "failed": "Route nicht mehr nutzbar — Neue Verbindung suchen"
    }
  },
  "errors": {
    "offline": "Offline — Daten von {{time}}",
    "upstream": "Live-Daten gerade nicht verfügbar — letzte bekannte Route wird angezeigt",
    "overloaded": "Server überlastet — bitte in Kürze erneut versuchen",
    "rateLimit": "Zu viele Anfragen — kurz warten",
    "unknown": "Etwas ist schiefgelaufen",
    "broken": "Verbindung unterbrochen",
    "reload": "Neu laden",
    "retry": "Erneut versuchen"
  },
  "settings": {
    "eyebrow": "Einstellungen"
  }
}
```

- [ ] **Step 2: Create `frontend/src/i18n/index.ts`**

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de.json'

void i18n.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: 'de',
  resources: { de: { translation: de } },
  interpolation: { escapeValue: false },
})

export default i18n
```

- [ ] **Step 3: Create screen shells**

Create `frontend/src/screens/StartScreen.tsx`:

```typescript
export function StartScreen() {
  return <div data-testid="start-screen" className="min-h-screen bg-bg-app" />
}
```

Create `frontend/src/screens/AlternativesScreen.tsx`:

```typescript
export function AlternativesScreen() {
  return <div data-testid="alternatives-screen" className="min-h-screen bg-bg-app" />
}
```

Create `frontend/src/screens/CompanionScreen.tsx`:

```typescript
export function CompanionScreen() {
  return <div data-testid="companion-screen" className="min-h-screen bg-bg-app" />
}
```

Create `frontend/src/screens/SettingsScreen.tsx`:

```typescript
export function SettingsScreen() {
  return <div data-testid="settings-screen" className="min-h-screen bg-bg-app p-4">
    <p className="text-text-muted">Einstellungen — kommt bald.</p>
  </div>
}
```

Create `frontend/src/screens/ErrorScreens.tsx`:

```typescript
import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom'
import { loadJourney } from '@/lib/indexeddb'
import { use } from 'react'

export function FullPageError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : 'Unbekannter Fehler'

  return (
    <div className="min-h-screen bg-bg-app flex flex-col items-center justify-center p-8 gap-6">
      <p className="text-text-muted text-center">{message}</p>
      <Link to="/" className="text-accent underline">Zurück zum Start</Link>
    </div>
  )
}

export function ScreenError({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-bg-app flex flex-col items-center justify-center p-8 gap-6">
      <p className="text-text-muted text-center">{message}</p>
      <Link to="/" className="text-accent underline">Zurück</Link>
    </div>
  )
}

let cachedJourneyPromise: Promise<Awaited<ReturnType<typeof loadJourney>>> | null = null

export function CompanionError() {
  // Try to show stale data rather than blank screen
  if (!cachedJourneyPromise) cachedJourneyPromise = loadJourney()
  const cached = use(cachedJourneyPromise)

  return (
    <div className="min-h-screen bg-bg-app flex flex-col p-4 gap-4">
      <div className="bg-warn-soft border border-warn rounded-card p-4">
        <p className="text-warn font-semibold">Verbindung unterbrochen</p>
      </div>
      {cached && (
        <p className="text-text-muted text-sm">
          Letzte bekannte Reise: {cached.journeyId}
        </p>
      )}
      <Link to="/" className="text-accent underline text-sm">Neue Verbindung suchen</Link>
    </div>
  )
}
```

- [ ] **Step 4: Create `frontend/src/router.tsx`**

```typescript
import { lazy, Suspense } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import {
  FullPageError,
  ScreenError,
  CompanionError,
} from '@/screens/ErrorScreens'
import { queryKeys } from '@/lib/queryClient'

// Route-based code splitting — each screen is its own chunk
const StartScreen       = lazy(() => import('@/screens/StartScreen').then(m => ({ default: m.StartScreen })))
const AlternativesScreen = lazy(() => import('@/screens/AlternativesScreen').then(m => ({ default: m.AlternativesScreen })))
const CompanionScreen   = lazy(() => import('@/screens/CompanionScreen').then(m => ({ default: m.CompanionScreen })))
const SettingsScreen    = lazy(() => import('@/screens/SettingsScreen').then(m => ({ default: m.SettingsScreen })))

const ScreenFallback = () => <div className="min-h-screen bg-bg-app" />

export function createRouter(qc: QueryClient) {
  return createBrowserRouter([
    {
      path: '/',
      element: <Suspense fallback={<ScreenFallback />}><StartScreen /></Suspense>,
      errorElement: <FullPageError />,
    },
    {
      path: '/journey/:journeyId/alternatives',
      element: <Suspense fallback={<ScreenFallback />}><AlternativesScreen /></Suspense>,
      errorElement: <ScreenError message="Verbindungen konnten nicht geladen werden" />,
      loader: async ({ params }) => {
        // Prime cache — Plan 3 adds full implementation
        return { journeyId: params.journeyId }
      },
    },
    {
      path: '/journey/:journeyId/companion',
      element: <Suspense fallback={<ScreenFallback />}><CompanionScreen /></Suspense>,
      errorElement: <CompanionError />,
      loader: async ({ params }) => {
        // Prime cache — Plan 4 adds full implementation
        return { journeyId: params.journeyId }
      },
    },
    {
      path: '/settings',
      element: <Suspense fallback={<ScreenFallback />}><SettingsScreen /></Suspense>,
      errorElement: <FullPageError />,
    },
    {
      path: '*',
      element: <Navigate to="/" replace />,
    },
  ])
}
```

- [ ] **Step 5: Create `frontend/src/main.tsx`**

```typescript
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { queryClient } from '@/lib/queryClient'
import { createRouter } from '@/router'
import { OfflineStateLoader } from '@/components/OfflineStateLoader'
import '@/i18n/index'
import '@/index.css'

// Enable MSW in development
async function prepareApp() {
  if (import.meta.env.DEV) {
    const { worker } = await import('@/mocks/browser')
    return worker.start({ onUnhandledRequest: 'warn' })
  }
}

const router = createRouter(queryClient)

void prepareApp().then(() => {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root element not found')

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/*
          OfflineStateLoader uses React 19 `use()` to suspend until IndexedDB
          is read and journeyStore hydrated. This must block RouterProvider
          so loaders see the correct journeyId on cold start.
        */}
        <Suspense fallback={null}>
          <OfflineStateLoader>
            <RouterProvider router={router} />
          </OfflineStateLoader>
        </Suspense>
      </QueryClientProvider>
    </StrictMode>
  )
})
```

- [ ] **Step 6: Create `frontend/src/mocks/browser.ts`**

```typescript
import { setupWorker } from 'msw/browser'
import { defaultHandlers } from '@/test/msw-handlers'

// Service worker for browser-based MSW (dev only)
export const worker = setupWorker(...defaultHandlers)
```

- [ ] **Step 7: Create RTL render helper**

Create `frontend/src/test/render.tsx`:

```typescript
import { type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
}

interface WrapperProps { children: ReactNode }

export function renderWithProviders(
  ui: ReactNode,
  options?: RenderOptions & { initialPath?: string }
) {
  const qc = createTestQueryClient()
  const Wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[options?.initialPath ?? '/']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { qc, ...render(ui, { wrapper: Wrapper, ...options }) }
}
```

- [ ] **Step 8: Run full test suite**

```bash
cd frontend && npm test
```

Expected: All existing tests pass. No type errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add router, screen shells, i18n, MSW browser worker, RTL helper"
```

---

### Task 16: Dockerfile + CI scripts

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/.dockerignore`

- [ ] **Step 1: Create `frontend/Dockerfile`**

```dockerfile
# ─── dev stage ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ─── builder stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── prod stage ────────────────────────────────────────────────────────────────
FROM nginx:alpine AS prod
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx.conf is mounted from the repo root nginx/ directory in docker-compose
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Create `frontend/.dockerignore`**

```
node_modules
dist
coverage
playwright-report
.env*
```

- [ ] **Step 3: Add frontend service to `docker-compose.override.yml`**

If `docker-compose.override.yml` doesn't exist at repo root, create it. Otherwise append:

```yaml
services:
  frontend:
    build:
      context: ./frontend
      target: dev
    volumes:
      - ./frontend:/app:cached
      - /app/node_modules
    ports:
      - "5173:5173"
    environment:
      - VITE_API_BASE_URL=
    command: npm run dev -- --host 0.0.0.0
```

- [ ] **Step 4: Verify build completes**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: Build succeeds, `dist/` created.

- [ ] **Step 5: Run size-limit check**

```bash
cd frontend && npm run size-limit
```

Expected: Passes ≤ 200KB (foundation with lazy-loaded screen shells is well under).

- [ ] **Step 6: Run full test suite one more time**

```bash
cd frontend && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/Dockerfile frontend/.dockerignore docker-compose.override.yml
git commit -m "feat(frontend): add Dockerfile, dockerignore, compose override for dev"
```

---

### Task 17: CI codegen check + final typecheck

**Files:**
- No new files — CI scripts already in `package.json`

- [ ] **Step 1: Verify codegen check passes**

```bash
cd frontend && npm run codegen:check
```

Expected: `✓ No changes detected` — types.gen.ts matches openapi.yaml.

- [ ] **Step 2: Run full typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint
```

Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(frontend): Plan 1 complete — foundation scaffold with all lib utilities, stores, router shells"
```

---

## Plan 1 Exit Criteria

1. `npm test` — all tests pass
2. `npm run typecheck` — 0 errors
3. `npm run lint` — 0 warnings
4. `npm run build` — succeeds, `dist/` created
5. `npm run size-limit` — ≤ 200KB initial JS chunk
6. `npm run codegen:check` — types in sync with openapi.yaml
7. Navigate to `http://localhost:5173` after `npm run dev` — see blank StartScreen shell, no console errors
