/** Inlined static assets: no build step and no external fonts or CDNs (nothing leaves the Mac). */
export const STYLE = `
:root {
  --console: #dce2e7; --panel: #eef1f4; --ink: #1f2c35; --muted: #5a6a75; --rule: #b9c3cb;
  --strip-claim: #f2e2a2; --strip-spend: #cde0ee; --strip-idle: #e3e7ea; --holder: #9aa7b1;
  --ok: #2e7a4e; --warn: #9a6a12; --bad: #b03a2e; --focus: #1d5fa8;
  --cond: "Avenir Next Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "Avenir Next", "Avenir", system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --console: #182127; --panel: #1f2a31; --ink: #e4eaee; --muted: #9fb0bb; --rule: #33424c;
    --strip-claim: #4a4224; --strip-spend: #233b4c; --strip-idle: #2a353c; --holder: #4b5a64;
    --ok: #6fc391; --warn: #e2b25a; --bad: #ef8a7d; --focus: #8bb8ec; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--console); color: var(--ink); font: 16px/1.5 var(--body); }
a { color: inherit; text-underline-offset: 3px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 64px; }
header.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 24px; }
header.top h1 { font: 600 26px/1.1 var(--cond); letter-spacing: .01em; margin: 0; }
.lamps { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); font-size: 15px; }
.lamp::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--holder); vertical-align: 1px; }
.lamp.on::before { background: var(--ok); } .lamp.warn::before { background: var(--warn); } .lamp.bad::before { background: var(--bad); }
nav.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 16px 0 24px; border-bottom: 1px solid var(--rule); }
nav.tabs a { padding: 8px 12px; text-decoration: none; color: var(--muted); border-bottom: 3px solid transparent; margin-bottom: -1px; }
nav.tabs a[aria-current="page"] { color: var(--ink); border-color: var(--ink); font-weight: 600; }
.status { font: 600 clamp(28px, 5vw, 44px)/1.1 var(--cond); margin: 8px 0 4px; max-width: 30ch; }
.sub { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
h2 { font: 600 21px/1.2 var(--cond); margin: 32px 0 12px; }
.rack { background: var(--holder); padding: 6px; border-radius: 6px; display: grid; gap: 6px; }
.strip { display: grid; grid-template-columns: 64px 1.4fr 1fr 1.2fr 1fr; align-items: stretch; background: var(--strip-idle); border-radius: 3px; min-height: 64px; }
.strip.claim { background: var(--strip-claim); } .strip.spend { background: var(--strip-spend); }
.strip > div { padding: 8px 12px; border-left: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); min-width: 0; }
.strip > div:first-child { border-left: 0; font: 600 30px/1 var(--cond); display: flex; align-items: center; justify-content: center; }
.strip .k { display: block; font: 13px/1.2 var(--cond); color: var(--muted); }
.strip .v { display: block; font: 600 17px/1.3 var(--cond); overflow-wrap: anywhere; }
.addr { font-size: 14px; }
@media (max-width: 720px) { .strip { grid-template-columns: 48px 1fr 1fr; } .strip > div:nth-child(n+4) { grid-column: 2 / -1; border-left: 0; border-top: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); } }
.cols { display: grid; grid-template-columns: 1.6fr 1fr; gap: 24px; } @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
table { width: 100%; border-collapse: collapse; font-size: 15px; background: var(--panel); }
th { text-align: left; font: 600 14px/1.2 var(--cond); color: var(--muted); padding: 8px; border-bottom: 1px solid var(--rule); }
td { padding: 8px; border-bottom: 1px solid var(--rule); vertical-align: top; overflow-wrap: anywhere; }
.scroll { overflow-x: auto; }
.pill { font: 600 13px/1 var(--cond); padding: 3px 7px; border-radius: 10px; background: var(--strip-idle); white-space: nowrap; }
.pill.ok { color: var(--ok); } .pill.bad { color: var(--bad); } .pill.warn { color: var(--warn); }
.alert { background: var(--panel); border-left: 4px solid var(--warn); padding: 10px 12px; margin: 0 0 8px; }
.alert.bad { border-color: var(--bad); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; background: var(--panel); padding: 12px; margin: 0; }
.facts dt { color: var(--muted); } .facts dd { margin: 0; font-weight: 600; }
pre { background: var(--panel); padding: 12px; overflow-x: auto; white-space: pre-wrap; font-size: 14px; max-width: 80ch; }
form.inline { display: inline; }
button, select, input { font: inherit; }
button { background: var(--ink); color: var(--console); border: 0; padding: 7px 14px; border-radius: 4px; cursor: pointer; }
button.quiet { background: transparent; color: var(--ink); border: 1px solid var(--ink); }
button.danger { background: var(--bad); color: #fff; }
button:disabled { opacity: .45; cursor: not-allowed; }
.why { color: var(--muted); font-size: 14px; }
svg.bars rect.c { fill: var(--warn); } svg.bars rect.s { fill: var(--focus); }
.empty { color: var(--muted); background: var(--panel); padding: 16px; }
.stopform { margin-top: 12px; } section + section { margin-top: 8px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
