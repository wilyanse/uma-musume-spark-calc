// Generates tokens.css, screens/*.html and index.html from tokens.json + the data below.
// Usage: node build.mjs   (then node export.mjs, node verify.mjs)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
mkdirSync(join(dir, 'screens'), { recursive: true });

// ---------------------------------------------------------------- tokens.css
const cssName = (k) => k.replaceAll('.', '-');
const colorVars = (c) => Object.entries(c).map(([k, v]) => `--${cssName(k)}:${v};`).join('');
const shadowVars = (s) => Object.entries(s).map(([k, v]) => `--shadow-${k}:${v};`).join('');
const staticVars = [
  ...Object.entries(tokens.space).map(([k, v]) => `--space-${k}:${v};`),
  ...Object.entries(tokens.radius).map(([k, v]) => `--radius-${k}:${v};`),
  ...Object.entries(tokens.font).map(([k, v]) => `--font-${k}:${v};`),
  ...Object.entries(tokens.type).map(([k, v]) => `--type-${k}:${v};`),
  ...Object.entries(tokens.layout).map(([k, v]) => `--${k}:${v};`),
].join('');
const dark = `${colorVars(tokens.color.dark)}${shadowVars(tokens.shadow.dark)}`;
writeFileSync(join(dir, 'tokens.css'), `/* GENERATED from tokens.json by build.mjs. Do not edit. */
:root{${staticVars}${colorVars(tokens.color.light)}${shadowVars(tokens.shadow.light)}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark}}}
:root[data-theme=dark]{${dark}}
`);

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const GLYPH = { blue: '●', pink: '♥', green: '▲', white: '◇' };
const TYPEWORD = { blue: 'Blue (stat)', pink: 'Pink (aptitude)', green: 'Green (unique)', white: 'White (skill/race)' };
const stars = (n) => `<span class="stars" role="img" aria-label="${n} of 3 stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
const spark = (type, name, n, extra = '') =>
  `<span class="spark ${type}" title="${TYPEWORD[type]}"><span class="g" aria-hidden="true">${GLYPH[type]}</span><span class="sr">${type} spark: </span><span class="nm">${esc(name)}</span>${extra} ${stars(n)}</span>`;
const grade = (g, cls = '') => `<span class="grade g-${g} ${cls}" title="Grade ${g}">${g}</span>`;
const lb = (n) => `<span class="lb" role="img" aria-label="Limit break ${n} of 4">${'◆'.repeat(n)}<span class="off">${'◆'.repeat(4 - n)}</span><small>LB${n}</small></span>`;
const ini = (name) => name.split(/[ .]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
const avatar = (name, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${ini(name)}</span>`;
const mode = (m, override) =>
  `<span class="mode ${m}">${m === 'independent' ? 'Independent' : 'Manual'}${override ? ' <span class="ov" role="img" aria-label="Manually overridden" title="Overridden by you (not from epithet)">✎</span>' : ''}</span>`;
const rb = (lo, mean, hi, tgt) => `<div class="rb" style="--lo:${lo}%;--mean:${mean}%;--hi:${hi}%;${tgt != null ? `--tgt:${tgt}%` : ''}">${tgt != null ? '<i class="tgt"></i>' : ''}<i class="rng"></i><i class="mean"></i></div>`;

// ---------------------------------------------------------------- illustrative data
const V = [
  { id: 'v1', name: 'Mejiro McQueen', outfit: 'Frontline Elegance', rank: 'A+', rating: 13471, mode: 'independent', ov: false, stats: [894, 938, 740, 559, 635], sc: 'URA Finale', date: '2026-09-12', blue: ['Guts', 2], pink: ['Medium', 2], green: ['The Duty of Dignity Calls', 3] },
  { id: 'v2', name: 'Tokai Teio', outfit: 'Beyond the Horizon', rank: 'A', rating: 12904, mode: 'manual', ov: true, stats: [1012, 611, 702, 498, 588], sc: 'Unity Cup', date: '2026-09-09', blue: ['Speed', 3], pink: ['Mile', 2], green: ['Beyond the Horizon', 2] },
  { id: 'v3', name: 'Special Week', outfit: 'Special Dreamer', rank: 'SS', rating: 15210, mode: 'manual', ov: false, stats: [986, 803, 811, 402, 640], sc: 'URA Finale', date: '2026-09-03', blue: ['Power', 2], pink: ['Medium', 3], green: ['Shooting Star', 3] },
  { id: 'v4', name: 'Oguri Cap', outfit: 'Starlight Beat', rank: 'A+', rating: 13188, mode: 'independent', ov: false, stats: [805, 720, 933, 541, 512], sc: 'Unity Cup', date: '2026-08-30', blue: ['Stamina', 2], pink: ['Mile', 3], green: ['Triumphant Pulse', 3] },
  { id: 'v5', name: 'Gold City', outfit: 'Authentic / 1928', rank: 'A', rating: 12560, mode: 'independent', ov: false, stats: [780, 655, 690, 702, 574], sc: 'URA Finale', date: '2026-08-27', blue: ['Guts', 2], pink: ['Mile', 3], green: ['KEEP IT REAL.', 2] },
  { id: 'v6', name: 'Kitasan Black', outfit: 'Gilded Shrine to Glory', rank: 'S', rating: 14033, mode: 'manual', ov: false, stats: [921, 877, 604, 455, 601], sc: 'URA Finale', date: '2026-08-21', blue: ['Stamina', 2], pink: ['Long', 3], green: ['Victory Cheer!', 3] },
  { id: 'v7', name: 'Mejiro McQueen', outfit: 'Frontline Elegance', rank: 'A', rating: 12388, mode: 'manual', ov: false, stats: [860, 900, 702, 530, 610], sc: 'Unity Cup', date: '2026-08-14', blue: ['Stamina', 3], pink: ['Long', 2], green: ['The Duty of Dignity Calls', 2] },
  { id: 'v8', name: 'Tokai Teio', outfit: 'Beyond the Horizon', rank: 'A+', rating: 13502, mode: 'independent', ov: false, stats: [1044, 590, 720, 512, 601], sc: 'URA Finale', date: '2026-08-02', blue: ['Speed', 2], pink: ['Medium', 3], green: ['Beyond the Horizon', 3] },
];
const CARDS = [
  { n: 'Special Week', t: 'The Brightest Star in Japan!', ty: 'Guts', r: 'SSR', lb: 4, lv: 50 },
  { n: 'Kitasan Black', t: 'Illustrative title K', ty: 'Speed', r: 'SSR', lb: 4, lv: 50 },
  { n: 'Gold City', t: 'Illustrative title A', ty: 'Speed', r: 'SSR', lb: 2, lv: 40 },
  { n: 'Oguri Cap', t: 'Illustrative title B', ty: 'Stamina', r: 'SSR', lb: 3, lv: 45 },
  { n: 'Tokai Teio', t: 'Illustrative title C', ty: 'Power', r: 'SSR', lb: 1, lv: 35 },
  { n: 'Mejiro McQueen', t: 'Illustrative title D', ty: 'Wit', r: 'SR', lb: 0, lv: 30 },
  { n: 'T.M. Opera O', t: 'Illustrative title E', ty: 'Friend', r: 'SSR', lb: 4, lv: 50 },
  { n: 'Special Week', t: 'Illustrative title F', ty: 'Speed', r: 'SR', lb: 2, lv: 40 },
  { n: 'Gold City', t: 'Illustrative title G', ty: 'Group', r: 'SSR', lb: 0, lv: 30 },
  { n: 'Kitasan Black', t: 'Illustrative title H', ty: 'Friend', r: 'SSR', lb: 3, lv: 45 },
  { n: 'Oguri Cap', t: 'Illustrative title I', ty: 'Power', r: 'SR', lb: 4, lv: 45 },
  { n: 'Tokai Teio', t: 'Illustrative title J', ty: 'Wit', r: 'SSR', lb: 1, lv: 30 },
];
const TYCOL = { Speed: 'SPD', Stamina: 'STA', Power: 'POW', Guts: 'GUT', Wit: 'WIT', Friend: 'FRD', Group: 'GRP' };
const typeChip = (t) => `<span class="type-chip" title="${t} card">${TYCOL[t]} ${t}</span>`;

// ---------------------------------------------------------------- shell
const NAV = [
  ['S01-roster.html', 'Roster', 'roster'],
  ['S03-review.html', 'Review', 'review'],
  ['S04-cards.html', 'Cards', 'cards'],
  ['S05-targets.html', 'Targets', 'targets'],
  ['S06-planner.html', 'Planner', 'planner'],
  ['S07-health.html', 'Health', 'health'],
];
function page({ file, title, active, actions = '', body }) {
  const rail = NAV.map(([href, label, key]) =>
    `<a class="nav" href="${href}"${active === key ? ' aria-current="page"' : ''}><span>${label}</span>${key === 'review' ? '<span class="badge-count" aria-label="7 open review items">7</span>' : ''}</a>`).join('');
  const tabs = [['S01-roster.html', 'Roster', 'roster', '☰'], ['S06-planner.html', 'Planner', 'planner', '⇅'], ['S05-targets.html', 'Targets', 'targets', '◎'], ['S03-review.html', 'More', 'more', '⋯']]
    .map(([href, label, key, ic]) => `<a href="${href}"${(active === key || (key === 'more' && ['review', 'cards', 'health'].includes(active))) ? ' aria-current="page"' : ''}><span aria-hidden="true">${ic}</span>${label}${key === 'more' ? '<span class="badge-count" aria-label="7 open review items">7</span>' : ''}</a>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Uma Spark Calc (design prototype)</title>
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="../app.css">
</head>
<body>
<div class="app">
  <nav class="rail" aria-label="Main">
    <div class="brand"><i aria-hidden="true">★</i>Uma Spark Calc</div>
    ${rail}
    <div class="foot">Master data v2026.09.1<br>Model: training-v1</div>
  </nav>
  <div class="main">
    <header class="topbar"><h1>${esc(title)}</h1><span class="sp"></span>${actions}</header>
    <main class="content">
${body}
    </main>
    <div class="demo">Illustrative data — not from a real account. Prototype ${file}.</div>
    <nav class="tabs-bottom" aria-label="Main (mobile)">${tabs}</nav>
  </div>
</div>
</body>
</html>
`;
  writeFileSync(join(dir, 'screens', file), html);
}

// ---------------------------------------------------------------- S01 roster
{
  const rows = V.map((v) => `<tr>
    <td class="hc">${avatar(v.name)}</td>
    <th scope="row" class="name"><a href="S02-veteran.html"><b>${esc(v.name)}</b></a><small>${esc(v.outfit)}</small></th>
    <td><span class="rank">${v.rank}</span></td>
    <td class="num">${v.rating.toLocaleString('en-US')}</td>
    ${v.stats.map((s, i) => `<td class="num hm">${s}</td>`).join('')}
    <td>${mode(v.mode, v.ov)}</td>
    <td class="hm"><div class="sums">${spark('blue', v.blue[0], v.blue[1])}${spark('pink', v.pink[0], v.pink[1])}${spark('green', v.green[0], v.green[1])}</div></td>
    <td class="hm">${v.sc}</td>
    <td class="hm mono">${v.date}</td>
  </tr>`).join('');
  page({
    file: 'S01-roster.html', title: 'Roster', active: 'roster',
    actions: '<span class="hint">Last import 2026-09-28 22:41</span><button class="btn">Columns</button>',
    body: `<form class="filters" aria-label="Roster filters">
  <label class="field"><span>Character</span><select class="input"><option>All characters</option><option>Mejiro McQueen</option><option>Tokai Teio</option></select></label>
  <div class="field"><span id="lm">Mode</span><div class="seg" role="radiogroup" aria-labelledby="lm"><label><input type="radio" name="m" checked>All</label><label><input type="radio" name="m">Independent</label><label><input type="radio" name="m">Manual</label></div></div>
  <label class="field"><span>Scenario</span><select class="input"><option>All scenarios</option><option>URA Finale</option><option>Unity Cup</option></select></label>
  <label class="field"><span>Has spark</span><select class="input"><option>Any</option><option>Stamina</option><option>Guts</option><option>Uma Stan</option></select></label>
  <label class="field"><span>Stars ≥</span><select class="input w-sm"><option>1</option><option>2</option><option>3</option></select></label>
  <div class="field"><span>Rating range</span><div class="row" style="gap:4px"><input class="input w-sm" value="10,000" aria-label="Minimum rating"> – <input class="input w-sm" value="16,000" aria-label="Maximum rating"></div></div>
  <button type="button" class="btn">Reset</button>
</form>
<div class="pager" style="padding:0 0 6px"><span>Showing 8 of 214 veterans · sorted by date, newest first</span></div>
<div class="tbl-wrap"><table>
<caption class="sr">Veterans</caption>
<thead><tr><th scope="col" class="hc"><span class="sr">Portrait</span></th><th scope="col">Veteran</th><th scope="col">Rank</th><th scope="col" class="num" aria-sort="descending">Rating</th>
<th scope="col" class="num hm">Spd</th><th scope="col" class="num hm">Sta</th><th scope="col" class="num hm">Pow</th><th scope="col" class="num hm">Gut</th><th scope="col" class="num hm">Wit</th>
<th scope="col">Mode</th><th scope="col" class="hm">Sparks (own: blue / pink / green)</th><th scope="col" class="hm">Scenario</th><th scope="col" class="hm">Acquired</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="pager"><span>Page 1 of 27</span><span class="row" style="gap:4px"><button class="btn sm" disabled>Previous</button><button class="btn sm">Next</button></span></div></div>`,
  });
}

// ---------------------------------------------------------------- S02 veteran detail
{
  const own = [['blue', 'Guts', 2], ['pink', 'Medium', 2], ['green', 'The Duty of Dignity Calls', 3], ['white', 'JBC Classic', 1], ['white', 'Kawasaki Kinen', 1, true], ['white', 'Nimble Navigator', 2], ['white', 'Medium Corners', 2], ['white', 'Keeping the Lead', 2], ['white', 'Uma Stan', 3], ['white', 'My True Strength', 3]];
  const p1 = [['blue', 'Power', 2], ['pink', 'Medium', 3], ['green', 'Shooting Star', 3], ['white', 'NHK Mile C.', 2], ['white', 'Arima Kinen', 1], ['white', 'Hanshin Racecourse', 2], ['white', 'Uma Stan', 2], ['white', 'Head-On', 2], ['white', 'My True Strength', 2], ['white', 'Our Grand Concert', 2]];
  const p2 = [['blue', 'Stamina', 3], ['pink', 'Long', 3], ['green', 'Barcarole of Blessings', 1], ['white', 'Osaka Hai', 1], ['white', 'Hanshin J.F.', 1], ['white', 'M.C. Nambu Hai', 3], ['white', 'Firm Conditions', 1], ['white', 'Corner Recovery', 1], ['white', 'Nimble Navigator', 1], ['white', 'Uma Stan', 1]];
  const list = (a) => `<div class="sparklist">${a.map(([t, n, s, lc]) => spark(t, n, s, '').replace(`<span class="nm">${esc(n)}</span>`, lc ? `<span class="nm"><a class="lowconf" href="S03-review.html" title="Low confidence — review">${esc(n)}</a></span>` : `<span class="nm">${esc(n)}</span>`)).join('')}</div>`;
  const skills = [['The Duty of Dignity Calls', 'Lvl 5', 1], ['Corner Recovery ◯'], ['Straightaway Adept'], ['Ramp Up'], ['Nimble Navigator'], ['Prepared to Pass'], ['Medium Corners ◯'], ['Long Corners ◯'], ['Vanguard Spirit'], ['Pace Chaser Straightaways ◯'], ['Hydrate'], ['Front Runner Savvy ◯'], ['Uma Stan'], ['Groundwork']];
  const deck = [['Special Week', 'The Brightest Star in Japan!', 'Guts', 4, 50], ['Kitasan Black', 'Illustrative title K', 'Speed', 4, 50], ['Gold City', 'Illustrative title A', 'Speed', 2, 40], ['Oguri Cap', 'Illustrative title B', 'Stamina', 3, 45], ['Tokai Teio', 'Illustrative title C', 'Power', 1, 35], ['T.M. Opera O', 'Illustrative title E', 'Friend', 4, 50, true]];
  const apt = (label, cells) => `<div class="aptrow"><span>${label}</span><div class="cells">${cells.map(([k, g]) => `<span class="cell"><span>${k}</span>${grade(g)}</span>`).join('')}</div></div>`;
  const statNames = ['Speed', 'Stamina', 'Power', 'Guts', 'Wit'];
  const STAT_CAP = 1200; // illustrative scenario statCap (real value: M.scenarios.statCap)
  const stats = [894, 938, 740, 559, 635];
  page({
    file: 'S02-veteran.html', title: 'Veteran detail', active: 'roster',
    actions: '<a class="btn" href="S01-roster.html">← Roster</a><button class="btn danger">Delete</button>',
    body: `<div class="banner warn" role="status">⚠ 1 field has low confidence (dotted underline). <a href="S03-review.html">Review it</a></div>
<div class="panel" style="margin-bottom:12px"><div class="body row" style="gap:16px">
  ${avatar('Mejiro McQueen', 'lg')}
  <div style="flex:1;min-width:220px"><div class="muted">[Frontline Elegance]</div><h2 style="font-size:22px">Mejiro McQueen</h2>
   <div class="row" style="gap:8px;margin-top:4px"><span class="rank" style="font-size:18px">A+</span><b class="num" style="font-size:18px" title="Rating">13,471</b><span class="chip" title="Epithet">Independent Learner</span></div></div>
  <div class="field"><span id="tm">Train mode <span class="hint">(detected from epithet)</span></span>
   <div class="seg" role="radiogroup" aria-labelledby="tm"><label><input type="radio" name="tm" checked>Independent</label><label><input type="radio" name="tm">Manual</label></div>
   <span class="hint">Overrides are kept on re-import.</span></div>
</div></div>
<div class="stat5" style="margin-bottom:12px">${statNames.map((n, i) => `<div><small>${n}</small><b>${i === 3 ? '<a class="lowconf" href="S03-review.html" title="Low confidence — review">559</a>' : stats[i]}</b><div class="cap" role="img" aria-label="${stats[i]} of ${STAT_CAP} scenario stat cap"><i style="width:${Math.min(100, stats[i] / STAT_CAP * 100)}%"></i></div></div>`).join('')}</div>
<div class="panel" style="margin-bottom:12px"><div class="body">
${apt('Track', [['Turf', 'A'], ['Dirt', 'E']])}
${apt('Distance', [['Sprint', 'G'], ['Mile', 'D'], ['Medium', 'A'], ['Long', 'S']])}
${apt('Style', [['Front', 'B'], ['Pace', 'A'], ['Late', 'D'], ['End', 'F']])}
</div></div>
<div class="tabset">
<input type="radio" name="tab" id="t-skills"><input type="radio" name="tab" id="t-sparks" checked><input type="radio" name="tab" id="t-deck"><input type="radio" name="tab" id="t-lineage">
<div class="tablist"><label for="t-skills">Skills</label><label for="t-sparks">Sparks</label><label for="t-deck">Deck</label><label for="t-lineage">Lineage</label></div>
<div class="tabs">
 <section class="tab" id="p-skills"><div class="skills">${skills.map(([n, lv, u]) => `<div class="skill${u ? ' unique' : ''}"><span>${n}</span><span>${lv || ''}</span></div>`).join('')}</div></section>
 <section class="tab" id="p-sparks"><div class="sparkgroups">
   <div class="sparkgroup"><h3>Self ${avatar('Mejiro McQueen')}</h3>${list(own)}</div>
   <div class="sparkgroup"><h3>Parent 1 · Special Week <span class="hint">[Special Dreamer]</span></h3>${list(p1)}</div>
   <div class="sparkgroup"><h3>Parent 2 · T.M. Opera O <span class="tag warn">Guest</span></h3>${list(p2)}</div>
 </div></section>
 <section class="tab" id="p-deck"><div class="deckrow">${deck.map(([n, t, ty, l, lv, f]) => `<div class="cardtile${f ? ' friend' : ''}"><div class="art"><span class="rar">SSR</span>art</div><b>${n}</b><span class="hint">${t}</span><span>${typeChip(ty)}</span>${lb(l)}<span class="row" style="gap:6px">Lv ${lv}${f ? ' <span class="tag ok">Friend</span>' : ''}</span></div>`).join('')}</div></section>
 <section class="tab" id="p-lineage"><div class="lineage">
   <div class="panel"><header>Parent 1 <span class="tag neutral">Matched in roster</span></header><div class="body row">${avatar('Special Week', 'lg')}<div><b>Special Week</b><div class="muted">[Special Dreamer]</div><a href="S02-veteran.html">Open veteran →</a></div></div></div>
   <div class="panel"><header>Parent 2 <span class="tag warn">Guest</span></header><div class="body row">${avatar('T.M. Opera O', 'lg')}<div><b>T.M. Opera O</b><div class="muted">[New Year, Same Radiance!]</div><div class="muted">Guest trainer: Yuuki</div><span class="hint">Guests can't be linked to a roster veteran.</span></div></div></div>
 </div>
 <div class="panel" style="margin-top:12px"><header>Career</header><div class="body row" style="gap:24px"><span>Scenario: <b>URA Finale</b></span><span>Races: <b>22</b></span><span>Wins: <b>22</b></span><span>Fans: <b>—</b></span><span>Acquired: <b class="mono">2026-09-12</b></span></div></div></section>
</div></div>`,
  });
}

// ---------------------------------------------------------------- S03 review
{
  const items = [
    ['Mejiro McQueen', 'Sparks · Self · white #5', 'Kawasakl Kinen', true],
    ['Mejiro McQueen', 'Stats · Guts', '5S9', false],
    ['Tokai Teio', 'Skills · #8', 'Straightaway Acce1eration', false],
    ['Oguri Cap', 'Sparks · Parent 1 · stars', '—', false],
    ['Gold City', 'Deck · slot 3 · card', 'Gold City [Illustrat', false],
    ['Kitasan Black', 'Parents · slot 2 · outfit', 'Gilded Shrine to G1ory', false],
    ['Special Week', 'Sparks · Parent 2 · white #2', 'Hanshin J.F', false],
  ];
  page({
    file: 'S03-review.html', title: 'Review queue', active: 'review',
    actions: '<span class="hint">7 open · 12 resolved this week</span>',
    body: `<div class="split">
<div class="panel"><header>Open items <span class="tag err">7</span></header>
<nav class="queue" aria-label="Open review items">${items.map(([n, p, raw, cur]) => `<a href="#"${cur ? ' aria-current="true"' : ''}><b>${n}</b><small>${p} · OCR “${esc(raw)}”</small></a>`).join('')}</nav></div>
<div class="grid">
 <div class="panel"><header>Mejiro McQueen — Sparks · Self · white #5 <span class="tag warn">confidence 0.62</span></header><div class="body grid">
  <div><div class="hint" style="margin-bottom:4px">Crop from capture (412 × 34 px)</div><div class="crop"><span>Kawasaki Kinen ★☆☆</span></div></div>
  <div class="row" style="gap:24px"><div><div class="hint">Raw OCR text</div><div class="mono" style="font-size:16px">Kawasakl Kinen</div></div><div><div class="hint">Field path</div><div class="mono">/sparks/4/sparkId</div></div></div>
  <div><div class="hint" style="margin-bottom:4px">Candidates</div><div class="grid" style="gap:6px">
    <button class="cand top"><span><b>Kawasaki Kinen</b> <span class="muted">· white · race</span></span><span class="row" style="gap:8px"><span class="muted mono">0.87</span><span class="kbd">1</span></span></button>
    <button class="cand"><span><b>Kawasaki Kinen (Jpn)</b> <span class="muted">· white · race</span></span><span class="row" style="gap:8px"><span class="muted mono">0.61</span><span class="kbd">2</span></span></button>
    <button class="cand"><span><b>Kanto Cup</b> <span class="muted">· white · race</span></span><span class="row" style="gap:8px"><span class="muted mono">0.34</span><span class="kbd">3</span></span></button></div></div>
  <label class="field"><span>None of these? Search the game vocabulary</span><input class="input" placeholder="Type a spark, skill or outfit name…" aria-label="Search vocabulary"></label>
  <div class="row"><button class="btn primary">Apply “Kawasaki Kinen” <span class="kbd" style="color:var(--text)">1</span></button><button class="btn">Dismiss <span class="kbd">D</span></button><span class="sp" style="flex:1"></span><span class="hint"><span class="kbd">J</span> next · <span class="kbd">K</span> previous</span></div>
 </div></div>
 <div class="hint">Applying updates the veteran and recomputes its fingerprint. If that collides with another veteran you'll see a conflict message.</div>
</div></div>`,
  });
}

// ---------------------------------------------------------------- S04 cards
{
  const tile = (c, sel) => `<div class="cardtile${sel ? ' sel' : ''}"><div class="art"><span class="rar">${c.r}</span>art</div><b>${c.n}</b><span class="hint">${c.t}</span><span>${typeChip(c.ty)}</span>${lb(c.lb)}<span>Lv ${c.lv}</span><button class="btn sm">${sel ? 'In deck' : 'Add to deck'}</button></div>`;
  const slots = [0, 1, 3, 4, 10].map((i) => CARDS[i]);
  page({
    file: 'S04-cards.html', title: 'Support cards', active: 'cards',
    actions: '<span class="hint">Last sync 2026-09-27 21:14 · Held 208 / 255</span>',
    body: `<form class="filters" aria-label="Card filters">
  <label class="field"><span>Type</span><select class="input"><option>All types</option><option>Speed</option><option>Stamina</option><option>Power</option><option>Guts</option><option>Wit</option><option>Friend</option><option>Group</option></select></label>
  <label class="field"><span>Limit break</span><select class="input"><option>Any</option><option>LB4 (max)</option><option>LB0–3</option></select></label>
  <label class="field"><span>Rarity</span><select class="input"><option>All</option><option>SSR</option><option>SR</option><option>R</option></select></label>
  <label class="field"><span>Search</span><input class="input" placeholder="Card name"></label></form>
<div class="split wide-r">
 <div><div class="pager" style="padding:0 0 6px"><span>Showing 12 of 208 owned cards</span></div><div class="cardgrid">${CARDS.map((c, i) => tile(c, [0, 1, 3, 4, 10].includes(i))).join('')}</div></div>
 <div class="panel"><header>Deck builder <span class="hint" style="font-weight:400">5 owned + 1 Friend</span></header><div class="body grid">
  ${slots.map((c, i) => `<div class="row" style="gap:8px;justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:6px 8px"><span><span class="hint">Slot ${i + 1}</span><br><b>${c.n}</b> ${typeChip(c.ty)}</span><span>${lb(c.lb)}<br><span class="hint">Lv ${c.lv}</span></span><button class="btn sm" aria-label="Remove slot ${i + 1}">✕</button></div>`).join('')}
  <div class="row" style="gap:8px;justify-content:space-between;border:1px dashed var(--accent);border-radius:8px;padding:6px 8px"><span><span class="hint">Slot 6 · Friend (borrowed)</span><br><b>T.M. Opera O</b> ${typeChip('Friend')}</span><span class="grid" style="gap:4px"><select class="input" aria-label="Friend card limit break"><option>LB4</option><option>LB3</option><option>LB2</option><option>LB1</option><option>LB0</option></select><input class="input" type="number" min="1" max="50" value="50" aria-label="Friend card level"></span></div>
  <label class="field"><span>Friend card (any card in the game)</span><input class="input" placeholder="Search all cards…"></label>
  <div class="row"><button class="btn primary">Use in planner</button><button class="btn">Clear</button></div>
 </div></div></div>`,
  });
}

// ---------------------------------------------------------------- S05 targets
{
  const aptSel = (k, g) => `<label class="field"><span>${k}</span><select class="input" aria-label="Minimum ${k} aptitude">${['—', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'].map((x) => `<option${x === g ? ' selected' : ''}>${x}</option>`).join('')}</select></label>`;
  const minS = (n, v) => `<label class="field"><span>${n}</span><input class="input" value="${v}" inputmode="numeric"></label>`;
  page({
    file: 'S05-targets.html', title: 'CM targets', active: 'targets',
    actions: '<button class="btn primary">+ New target</button>',
    body: `<div class="split">
<div class="panel"><header>Saved targets</header><div class="queue">
 <a href="#" aria-current="true"><b>Turf Medium · Pace</b><small>Turf · medium · 2400 m · updated 2026-09-26</small></a>
 <a href="#"><b>Turf Mile · Front</b><small>Turf · mile · 1600 m · updated 2026-09-20</small></a>
 <a href="#"><b>Dirt Sprint · Late</b><small>Dirt · sprint · 1200 m · updated 2026-09-11</small></a>
</div></div>
<div class="panel"><header>Edit target</header><div class="body grid" style="gap:16px">
 <label class="field"><span>Name</span><input class="input" value="Turf Medium · Pace" style="max-width:360px"></label>
 <fieldset style="border:0;padding:0;margin:0"><legend class="hint" style="padding:0 0 4px">Course</legend><div class="row">
  <label class="field"><span>Surface</span><select class="input"><option selected>Turf</option><option>Dirt</option></select></label>
  <label class="field"><span>Distance</span><select class="input"><option>Sprint</option><option>Mile</option><option selected>Medium</option><option>Long</option></select></label>
  <label class="field"><span>Meters (optional)</span><input class="input w-sm" value="2400"></label>
  <label class="field" style="flex:1"><span>Notes</span><input class="input" value="Right-handed, Nakayama-like"></label></div></fieldset>
 <div class="field"><span id="st">Running style</span><div class="seg" role="radiogroup" aria-labelledby="st"><label><input type="radio" name="st">Front</label><label><input type="radio" name="st" checked>Pace</label><label><input type="radio" name="st">Late</label><label><input type="radio" name="st">End</label></div></div>
 <div><div class="hint" style="margin-bottom:4px">Minimum stats (blank = no requirement)</div><div class="form3">${minS('Speed', 1000)}${minS('Stamina', 700)}${minS('Power', 700)}${minS('Guts', 400)}${minS('Wit', 500)}</div></div>
 <div><div class="hint" style="margin-bottom:4px">Minimum aptitudes</div><div class="aptgrid">${[['Turf', 'A'], ['Dirt', '—'], ['Sprint', '—'], ['Mile', '—'], ['Medium', 'A'], ['Long', '—'], ['Front', '—'], ['Pace', 'A'], ['Late', '—'], ['End', '—']].map(([k, g]) => aptSel(k, g)).join('')}</div></div>
 <div><div class="hint" style="margin-bottom:4px">Required skills (all must be acquired)</div>
  <div class="row" style="gap:6px"><span class="chip sel">Medium Corners ◯ <button aria-label="Remove Medium Corners">✕</button></span><span class="chip sel">Keeping the Lead <button aria-label="Remove Keeping the Lead">✕</button></span><input class="input" placeholder="Add skill…" aria-label="Add required skill" list="sk"><datalist id="sk"><option>Corner Recovery ◯</option></datalist></div></div>
 <div><div class="hint" style="margin-bottom:4px">Optional skills (weight for secondary sort)</div>
  <div class="row" style="gap:12px"><span class="chip">Corner Recovery ◯ <input class="input w-sm" value="2" aria-label="Weight for Corner Recovery" style="height:22px;width:48px"> <button aria-label="Remove">✕</button></span><span class="chip">Nimble Navigator <input class="input" value="1" aria-label="Weight for Nimble Navigator" style="height:22px;width:48px"> <button aria-label="Remove">✕</button></span><input class="input" placeholder="Add skill…" aria-label="Add optional skill"></div></div>
 <div><div class="hint" style="margin-bottom:4px">Stat weights for surplus (default 1)</div><div class="form3">${minS('Speed', 1)}${minS('Stamina', 1)}${minS('Power', 0.5)}${minS('Guts', 0.5)}${minS('Wit', 1)}</div></div>
 <div class="row"><button class="btn primary">Save target</button><button class="btn">Save as new</button><button class="btn danger">Delete</button></div>
</div></div></div>`,
  });
}

// ---------------------------------------------------------------- S06 planner
{
  const stats = ['Speed', 'Stamina', 'Power', 'Guts', 'Wit'];
  const pred = [[1030, 1063, 1099, 1000], [716, 746, 781, 700], [655, 688, 725, 700], [412, 436, 470, 400], [520, 551, 588, 500]];
  const pos = (v) => ((v - 300) / 900 * 100).toFixed(1);
  const posRow = (i) => { const [lo, m, hi, t] = pred[i]; return rb(pos(lo), pos(m), pos(hi), pos(t)); };
  const pairs = [
    ['Special Week', 'Kitasan Black', 0.71, 148, 26, 'Long Straightaways'],
    ['Special Week', 'Oguri Cap', 0.64, 131, 31, 'Guts (min 400)'],
    ['Gold City', 'Special Week', 0.58, 120, 22, 'Medium Corners ◯'],
    ['Kitasan Black', 'Oguri Cap', 0.47, 96, 18, 'Power (min 700)'],
    ['Special Week', 'Gold City', 0.41, 88, 22, 'Keeping the Lead'],
    ['Oguri Cap', 'Kitasan Black', 0.33, 70, 15, 'Wit (min 500)'],
  ];
  const rowsHtml = pairs.map(([a, b, p, s, aff, bn], i) => `<tr${i === 0 ? ' class="open"' : ''}>
    <td class="num hc">${i + 1}</td><th scope="row"><button class="btn sm" aria-expanded="${i === 0}" aria-label="${i === 0 ? 'Collapse' : 'Expand'} details for pair ${i + 1}">${i === 0 ? '▾' : '▸'}</button> <b>${a}</b></th><td><b>${b}</b></td>
    <td><span class="pmeet"><span class="bar" role="img" aria-label="${Math.round(p * 100)} percent"><i style="width:${p * 100}%"></i></span><b class="num">${(p * 100).toFixed(0)}%</b><small class="muted">n=142</small></span></td>
    <td class="num hm">+${s}</td><td class="num hm">${aff}</td><td class="hm">${bn}</td></tr>${i === 0 ? `<tr><td colspan="7" class="detail">
   <div class="detailgrid">
    <div><h4>Predicted stats · mean and p10–p90 vs target (dashed) · model n=142</h4>
      ${stats.map((n, k) => `<div class="statrow"><span>${n}</span>${posRow(k)}<span class="val num">${pred[k][1]} <span class="muted">(${pred[k][0]}–${pred[k][2]})</span> / ${pred[k][3]}</span></div>`).join('')}
      <div class="hint">Interval from 2,000 simulated children. Stat cap 1200 (illustrative).</div></div>
    <div><h4>Aptitude before → after · model n=142</h4>
      <div class="contrib" style="align-items:center">
       <span>Turf</span><span>${grade('A')} → ${grade('A')} <span class="muted">100% ≥ A</span></span>
       <span>Medium</span><span>${grade('B')} → ${grade('A')} <span class="muted">72% ≥ A</span></span>
       <span>Pace</span><span>${grade('A')} → ${grade('A')} <span class="muted">100% ≥ A</span></span></div>
      <h4 style="margin-top:12px">Required skills · P(acquired)</h4>
      <div class="contrib"><span>Medium Corners ◯</span><span><b>91%</b> <span class="muted">n=64</span></span>
       <span>Keeping the Lead</span><span><b>83%</b> <span class="muted">n=41</span></span>
       <span>Long Straightaways <span class="tag warn">bottleneck</span></span><span><b>74%</b> <span class="tag warn">low data n=6</span></span></div></div>
    <div><h4>Spark contributions (top) · model n=142</h4>
      <div class="contrib"><span>${spark('blue', 'Power', 2)}<span class="hint"> P1</span></span><span class="num">+18</span>
       <span>${spark('blue', 'Stamina', 3)}<span class="hint"> P2</span></span><span class="num">+27</span>
       <span>${spark('pink', 'Medium', 3)}<span class="hint"> P1</span></span><span class="num">72%</span>
       <span>${spark('white', 'Medium Corners', 2)}<span class="hint"> P1</span></span><span class="num">hint 44%</span></div>
      <h4 style="margin-top:12px">Affinity · total 26</h4>
      <div class="contrib"><span>Trainee × Parent 1</span><span class="num">12</span><span>Trainee × Parent 2</span><span class="num">9</span><span>Grandparents</span><span class="num">5</span></div></div>
   </div></td></tr>` : ''}`).join('');
  page({
    file: 'S06-planner.html', title: 'Planner', active: 'planner',
    actions: '<span class="hint">Model training-v1 · fitted on 142 veterans · 80% interval coverage 0.81 (holdout)</span>',
    body: `<div class="split">
<div class="panel"><header>Plan</header><div class="body grid" style="gap:14px">
 <label class="field"><span>Trainee (outfit)</span><select class="input"><option>Mejiro McQueen [Frontline Elegance]</option><option>Tokai Teio [Beyond the Horizon]</option></select></label>
 <div class="field"><span>Support deck <a href="S04-cards.html">edit in Cards</a></span><div class="row" style="gap:4px">${[0, 1, 3, 4, 10].map((i) => `<span class="chip">${CARDS[i].n.split(' ')[0]} ${TYCOL[CARDS[i].ty]} ${'◆'.repeat(CARDS[i].lb) || '·'}</span>`).join('')}<span class="chip sel">Friend: T.M. Opera O ◆◆◆◆</span></div></div>
 <div class="field"><span id="pm">Train mode</span><div class="seg" role="radiogroup" aria-labelledby="pm"><label><input type="radio" name="pm" checked>Independent</label><label><input type="radio" name="pm">Manual</label></div></div>
 <label class="field"><span>Scenario</span><select class="input"><option>URA Finale</option><option>Unity Cup</option></select></label>
 <label class="field"><span>CM target <a href="S05-targets.html">edit</a></span><select class="input"><option>Turf Medium · Pace</option><option>Turf Mile · Front</option></select></label>
 <label class="field"><span>Lock parent 1 (optional)</span><select class="input"><option>— none —</option><option>Special Week [Special Dreamer]</option></select></label>
 <div class="row"><button class="btn primary">Rank pairs</button><button class="btn" disabled>Cancel</button></div>
</div></div>
<div class="grid" style="gap:12px">
 <div class="panel"><div class="body"><div class="row" style="justify-content:space-between"><b>Ranked 33,670 legal pairs in 3.2 s · showing top 6 of 50</b><span class="hint">Fast pass → Monte Carlo on top 100 (2,000 samples each)</span></div>
  <div class="progress" style="margin-top:6px" role="progressbar" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100" aria-label="Ranking progress"><i style="width:100%"></i></div></div></div>
 <div class="tbl-wrap fit2"><table><caption class="sr">Ranked parent pairs</caption><thead><tr><th scope="col" class="num hc">#</th><th scope="col">Parent 1</th><th scope="col">Parent 2</th><th scope="col">P(meet target)</th><th scope="col" class="num hm">Stat surplus</th><th scope="col" class="num hm">Affinity</th><th scope="col" class="hm">Bottleneck</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
</div></div>`,
  });
}

// ---------------------------------------------------------------- S07 health
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const scatter = (name, lo, hi, sd) => {
    const dots = Array.from({ length: 34 }, () => { const x = lo + rnd() * (hi - lo); const y = x + (rnd() + rnd() + rnd() - 1.5) * sd; return [x, y]; });
    const sx = (v) => 10 + ((v - lo) / (hi - lo)) * 130, sy = (v) => 140 - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 130;
    return `<div class="scatter"><b style="font-size:12px">${name}</b><svg viewBox="0 0 150 150" role="img" aria-label="${name}: predicted versus actual, held-out veterans"><rect x="10" y="10" width="130" height="130" fill="none" stroke="var(--border)"/><line x1="10" y1="140" x2="140" y2="10" stroke="var(--target-line)" stroke-dasharray="4 3"/>${dots.map(([x, y]) => `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="2.4" fill="var(--bar-mean)" opacity=".85"/>`).join('')}<text x="75" y="149" font-size="8" text-anchor="middle" fill="var(--muted)">predicted</text><text x="6" y="75" font-size="8" fill="var(--muted)" transform="rotate(-90 6 75)" text-anchor="middle">actual</text></svg><span class="hint">n=28 held out</span></div>`;
  };
  const rules = [['activation.blue', '1★ x.xx · 2★ x.xx · 3★ x.xx', false, 'placeholder, not a real value (Q-3)'], ['activation.pink', '1★ x.xx · 2★ x.xx · 3★ x.xx', false, 'placeholder, not a real value (Q-3)'], ['affinityMultiplier', 'formula placeholder', false, 'placeholder, not a real value (Q-3)'], ['grandparentWeight', 'x.xx', false, 'placeholder, not a real value (Q-3)'], ['pinkGradeGain', '1★–3★ = 1', true, 'in-game observation']];

  page({
    file: 'S07-health.html', title: 'Model health', active: 'health',
    actions: '<button class="btn">Refit model</button><button class="btn primary">Run calibration</button>',
    body: `<div class="grid" style="gap:12px">
<div class="row" style="gap:12px;align-items:stretch">
  <div class="kpi"><small>Training rows</small><b>142</b><small>min confidence ≥ 0.9</small></div>
  <div class="kpi"><small>80% interval coverage</small><b>0.81</b><small>target 0.72–0.88 <span class="tag ok">in range</span></small></div>
  <div class="kpi"><small>Model</small><b style="font-size:16px">training-v1</b><small>fitted 2026-09-28 22:44 · master 2026.09.1</small></div>
</div>
<div class="split s2">
 <div class="tbl-wrap fit"><table><caption style="text-align:left;padding:8px 10px;font-weight:650">Sample counts</caption><thead><tr><th scope="col">Scenario</th><th scope="col">Mode</th><th scope="col" class="num">Veterans</th><th scope="col"></th></tr></thead><tbody>
  <tr><th scope="row">URA Finale</th><td>Independent</td><td class="num">61</td><td></td></tr>
  <tr><th scope="row">URA Finale</th><td>Manual</td><td class="num">44</td><td></td></tr>
  <tr><th scope="row">Unity Cup</th><td>Independent</td><td class="num">31</td><td></td></tr>
  <tr><th scope="row">Unity Cup</th><td>Manual</td><td class="num">6</td><td><span class="tag warn">low data (n &lt; 10)</span></td></tr></tbody></table></div>
 <div class="tbl-wrap fit"><table><caption style="text-align:left;padding:8px 10px;font-weight:650">Holdout error (MAE, stat points)</caption><thead><tr><th scope="col">Stat</th><th scope="col" class="num">MAE</th><th scope="col" class="num">σ</th></tr></thead><tbody>
  <tr><th scope="row">Speed</th><td class="num">31.2</td><td class="num">38.0</td></tr><tr><th scope="row">Stamina</th><td class="num">27.4</td><td class="num">33.5</td></tr><tr><th scope="row">Power</th><td class="num">29.8</td><td class="num">36.1</td></tr><tr><th scope="row">Guts</th><td class="num">33.9</td><td class="num">41.2</td></tr><tr><th scope="row">Wit</th><td class="num">26.1</td><td class="num">31.7</td></tr></tbody></table></div>
</div>
<div><h2 style="margin-bottom:6px">Predicted vs actual (held-out veterans)</h2><div class="scatters">${scatter('Speed', 600, 1100, 60)}${scatter('Stamina', 500, 1000, 50)}${scatter('Power', 500, 1000, 55)}${scatter('Guts', 300, 800, 60)}${scatter('Wit', 400, 900, 50)}</div><div class="hint" style="margin-top:4px">Dashed line = perfect prediction.</div></div>
<div class="split s2b">
 <div class="tbl-wrap fit"><table><caption style="text-align:left;padding:8px 10px;font-weight:650">Inheritance rules (rules-1)</caption><thead><tr><th scope="col">Rule</th><th scope="col">Value</th><th scope="col">Status</th><th scope="col" class="hm">Source</th></tr></thead><tbody>${rules.map(([r, v, ok, s]) => `<tr><th scope="row" class="mono">${r}</th><td>${v}</td><td><span class="tag ${ok ? 'ok' : 'warn'}">${ok ? '✓ verified' : '⚠ unverified'}</span></td><td class="hm muted">${s}</td></tr>`).join('')}</tbody></table></div>
 <div class="panel"><header>Calibration result <span class="hint" style="font-weight:400">run 2026-09-28 22:51</span></header><div class="body grid">
  <div class="contrib"><span>blueStatGain multiplier</span><b class="num">×1.24</b><span>Aptitude log-likelihood</span><b class="num">−41.7</b><span>Skill check (Brier)</span><b class="num">0.16</b></div>
  <div class="hint">Suggested values are never applied automatically.</div>
  <div class="row"><button class="btn primary">Apply suggested multipliers</button><button class="btn">Dismiss</button></div></div></div>
</div></div>`,
  });
}

// ---------------------------------------------------------------- index.html
const SCREENS = [['S01-roster', 'S01 Roster'], ['S02-veteran', 'S02 Veteran detail'], ['S03-review', 'S03 Review queue'], ['S04-cards', 'S04 Support cards'], ['S05-targets', 'S05 CM targets'], ['S06-planner', 'S06 Planner'], ['S07-health', 'S07 Model health']];
const items = SCREENS.map(([id, label]) => `<section class="card"><h2>${label}</h2><p><a href="screens/${id}.html">Open prototype</a></p>
<div class="thumbs"><figure><a href="screens/${id}-desktop-light.png"><img loading="lazy" src="screens/${id}-desktop-light.png" alt="${label}, desktop light"></a><figcaption>Desktop · light</figcaption></figure>
<figure><a href="screens/${id}-desktop-dark.png"><img loading="lazy" src="screens/${id}-desktop-dark.png" alt="${label}, desktop dark"></a><figcaption>Desktop · dark</figcaption></figure>
<figure class="m"><a href="screens/${id}-mobile-light.png"><img loading="lazy" src="screens/${id}-mobile-light.png" alt="${label}, mobile light"></a><figcaption>Mobile · light</figcaption></figure></div></section>`).join('\n');
writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Uma Spark Calc — design gallery</title><link rel="stylesheet" href="tokens.css">
<style>
body{height:auto;overflow:auto;margin:0;padding:24px;max-width:1500px;margin-inline:auto;background:var(--bg);color:var(--text);font:14px/1.5 var(--font-sans)}
h1{margin:0 0 4px} .lead{color:var(--muted);margin:0 0 20px;max-width:75ch}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:20px}
.card h2{margin:0} .thumbs{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0} figure img{display:block;width:440px;max-width:100%;border:1px solid var(--border);border-radius:6px} figure.m img{width:150px}
figcaption{font-size:12px;color:var(--muted);margin-top:4px} a{color:var(--accent)}
ul.docs{columns:2;padding-left:18px}
</style></head><body>
<h1>Uma Spark Calc — design gallery (T07)</h1>
<p class="lead">Static prototypes for screens S01–S07, in light and dark. All data is illustrative. Open a prototype to see it live at any width; it switches to the mobile layout below 720 px and follows your OS light/dark setting.</p>
<div class="card"><h2>Design system</h2><ul class="docs"><li><a href="tokens.json">tokens.json</a> (source) · <a href="tokens.css">tokens.css</a> (generated)</li><li><a href="components.md">components.md</a></li><li><a href="bindings.md">bindings.md</a></li><li><a href="copy.md">copy.md</a></li><li><a href="manifest.json">manifest.json</a> (21 PNGs)</li></ul></div>
${items}
</body></html>
`);
console.log('built tokens.css, 7 screens, index.html');
