# XEON Yield — Android PWA

An offline-first, Android-ready **Progressive Web App (PWA)** to estimate daily-compounded gross and net yields for the **Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C** (`XEON` · ISIN `LU0290358497`).

## Features

- **Accurate XEON Daily Compounding**: Models the **Solactive €STR +8.5 Daily Total Return Index** on an **ACT/360** money-market basis minus the **0.10% p.a. TER** (with configurable ACT/365, spread, and tracking adjustment).
- **Live ECB €STR Sync**: One-tap fetch of the latest official Euro Short-Term Rate (`€STR`) from the ECB SDMX API, with built-in offline fallback (`2.437%`).
- **Rate Trajectory Modeling**: Compare a flat `€STR` environment against a gradual ECB rate hike or cut path over your holding period.
- **Tax & Fee Presets**: Includes `0% Gross`, `12.94% Italian White-List`, `26% Standard`, `26.38% Germany`, or custom tax rate, plus optional annual stamp duty (`0.20%`) and broker buy/sell fees.
- **PAC / Monthly Contributions**: Simulate recurring monthly deposits with exact money-weighted annualized return (**XIRR**).
- **Interactive Growth Chart & Bank Comparison**: Touch-scrubbable SVG chart and side-by-side comparison against a taxed bank deposit or `0%` checking account.
- **Android Installable PWA**: Includes `manifest.webmanifest`, adaptive `maskable` icons, Android launcher shortcuts, and an offline-first Service Worker (`sw.js`).

## Run Locally

Because Service Workers require HTTP(S), serve the directory with any static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in Chrome.

## Install on Android

1. Deploy this repository to **GitHub Pages** (`Settings → Pages → Deploy from branch main / (root)`), Vercel, or Cloudflare Pages (HTTPS is required on non-localhost origins for Android PWA install).
2. Open the HTTPS URL in **Google Chrome** on Android.
3. Tap the in-app **Install** banner (or **⋮ → Add to Home screen → Install**).

## Run Tests

```bash
node tests/verify_math.mjs
```
