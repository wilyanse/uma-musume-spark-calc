# ADR-0001: Screen-capture agent + Cloudflare free tier + client-side engine

- Status: Accepted (2026-09-29)

## Context
- The game (Global, Steam) has no data export.
- The user chose screen capture + OCR over reading memory or traffic, because of ToS risk.
- The app must be hosted and reachable anywhere, cost nothing, and serve one user.
- Ranking all parent pairs (≈33.7k for 260 veterans) and fitting a model is CPU-heavy.

## Decision
1. **Capture:** a C# .NET 8 agent split into a cross-platform `Core` (ImageSharp, parsers, tested on macOS against real screenshots and recorded OCR) and a Windows shell (WGC capture, Windows.Media.Ocr, WPF tray).
2. **Hosting:** one Cloudflare Worker serving static assets and a Hono API, with D1 for user data, R2 for low-confidence crops, and Cloudflare Access (email OTP + a service token for the agent).
3. **Engine:** TypeScript, run in the browser's Web Worker. The Worker free tier allows only 10 ms CPU per request, so no heavy computation runs server-side.
4. **Master data:** static versioned JSON built from community sources, shipped with the web assets instead of stored in D1.
5. **Train mode:** detected from the epithet ("Independent Learner"). The user never changes epithets.
6. **Unverified game constants:** stored in `rules.json` with `verified:false` and calibrated against the user's roster.

## Consequences
- The whole stack fits the free tiers (limits fetched 2026-09-29, recorded in 65 §1).
- Windows-only code can be compiled but not run in CI. Real validation needs the human checkpoint H4.
- The engine exists once, in TS. There's no server/client parity problem.
- Access adds a dependency on the Zero Trust setup (human checkpoint H2).
