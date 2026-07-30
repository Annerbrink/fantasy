// FPL Assistant — client. Thin rendering layer: it reads the manager's Team ID and League
// ID from localStorage, calls our own /api endpoints (which proxy + compute server-side),
// and renders the results. No FPL calls happen here (the FPL API blocks browser requests).

const DEFAULTS = { teamId: '70375', leagueId: '379411' };
const store = {
  get teamId() { return localStorage.getItem('fpl_team') || DEFAULTS.teamId; },
  get leagueId() { return localStorage.getItem('fpl_league') || DEFAULTS.leagueId; },
  set(team, league) {
    if (team) localStorage.setItem('fpl_team', team); else localStorage.removeItem('fpl_team');
    if (league) localStorage.setItem('fpl_league', league); else localStorage.removeItem('fpl_league');
  },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(1)}m`);

// ---- Tabs ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ---- Setup --------------------------------------------------------------------------
$('#input-team').value = localStorage.getItem('fpl_team') || DEFAULTS.teamId;
$('#input-league').value = localStorage.getItem('fpl_league') || DEFAULTS.leagueId;
$('#save-setup').addEventListener('click', () => {
  store.set($('#input-team').value.trim(), $('#input-league').value.trim());
  load();
  document.querySelector('.tab[data-tab="dashboard"]').click();
});

// ---- Rendering helpers --------------------------------------------------------------
function statTile(label, value) {
  return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${value}</div></div>`;
}

function playerCell(p) {
  return `<span class="player">${esc(p.name)} <small>${esc(p.team)} · ${esc(p.position)} · ${money(p.price)}</small></span>`;
}

function gainPill(net) {
  const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
  const sign = net > 0 ? '+' : '';
  return `<span class="pill ${cls}">${sign}${net} pts</span>`;
}

// ---- Renderers ----------------------------------------------------------------------
function renderDashboard(a) {
  const m = a.manager;
  const tiles = [];
  if (m) {
    tiles.push(statTile('Manager', esc(m.teamName || m.name || '—')));
    if (m.rank) tiles.push(statTile('Overall rank', m.rank.toLocaleString()));
    tiles.push(statTile('In the bank', money(m.bank)));
    tiles.push(statTile('Free transfers', m.freeTransfers ?? '—'));
  }
  tiles.push(statTile('Planning for', `GW ${a.targetGw}`));

  const topMove = a.transfers?.single?.[0];
  const cap = a.captain?.captain;

  $('#dash-content').innerHTML = `
    <div class="card">
      <h2>Gameweek ${a.targetGw} snapshot</h2>
      <div class="grid">${tiles.join('')}</div>
    </div>
    <div class="card">
      <h2>Headline advice</h2>
      <p class="hint">The single highest-impact move and captain this week.</p>
      ${topMove
        ? `<div class="move">Transfer <span class="pill neg">OUT</span> ${playerCell(topMove.out)} <span class="arrow">→</span> <span class="pill pos">IN</span> ${playerCell(topMove.in)} ${gainPill(topMove.netGain)}</div>`
        : `<p class="muted">${a.transfers?.hold ? 'Hold — no transfer beats your current squad this week.' : 'Set your Team ID in Setup for personalised transfer advice.'}</p>`}
      ${cap ? `<p style="margin-top:12px">Captain: <strong class="cap-c">© ${esc(cap.name)}</strong> (${esc(cap.team)})${a.captain.vice ? ` · Vice: ${esc(a.captain.vice.name)}` : ''}</p>` : ''}
    </div>`;
}

function renderTransfers(a) {
  const t = a.transfers;
  if (!t) return ($('#transfers-content').innerHTML = emptyCard('No transfer data.'));

  if (t.watchlistOnly) {
    const cols = Object.entries(t.watchlist).map(([pos, players]) => `
      <div class="card">
        <h2>${pos} watchlist</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Player</th><th class="num">Proj (3GW)</th><th class="num">Value</th><th class="num">Owned</th></tr></thead>
          <tbody>${players.map((p) => `<tr>
            <td>${playerCell(p)}</td><td class="num">${p.projNext3}</td><td class="num">${p.value}</td><td class="num">${p.selectedBy}%</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('');
    $('#transfers-content').innerHTML = `<div class="card"><h2>Transfer targets</h2><p class="hint">No squad loaded yet — here are the best-value players by position to build or plan around. Add your Team ID in Setup for tailored in/out moves.</p></div>${cols}`;
    return;
  }

  const rows = (t.single || []).map((s) => `<tr>
    <td>${playerCell(s.out)}</td>
    <td>${playerCell(s.in)}</td>
    <td class="num">${gainPill(s.netGain)}${s.hit ? ` <span class="pill warn">-${s.hit} hit</span>` : ''}</td>
  </tr>`).join('');

  let dbl = '';
  if (t.double) {
    dbl = `<div class="card"><h2>Best double move</h2>
      <p class="hint">Two transfers combined ${t.double.hit ? `(costs a ${t.double.hit}-point hit)` : '(within your free transfers)'}.</p>
      ${t.double.moves.map((mv) => `<div class="move" style="margin-bottom:6px"><span class="pill neg">OUT</span> ${playerCell(mv.out)} <span class="arrow">→</span> <span class="pill pos">IN</span> ${playerCell(mv.in)}</div>`).join('')}
      <p style="margin-top:8px">Net: ${gainPill(t.double.netGain)}</p>
    </div>`;
  }

  $('#transfers-content').innerHTML = `
    <div class="card">
      <h2>Recommended transfers <span class="gw">· ${t.freeTransfers} free · ${money(t.bank)} bank</span></h2>
      ${t.hold ? '<p class="muted">Hold — no single transfer beats your current squad over the next 3 gameweeks.</p>' : `
      <div class="table-scroll"><table>
        <thead><tr><th>Out</th><th>In</th><th class="num">Net gain</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint" style="margin-top:10px">${esc(t.single?.[0]?.reason || '')}</p>`}
    </div>${dbl}${priceWatchCard(a)}${fixtureOutlookCard(a)}`;
}

// Predicted price risers (buy before the rise) and fallers (sell before the drop).
function priceWatchCard(a) {
  const pw = a.priceWatch;
  if (!pw || (!pw.risers?.length && !pw.fallers?.length)) return '';
  const row = (p) => `<tr>
    <td><strong>${esc(p.name)}</strong> <small class="muted">${esc(p.team)}</small></td>
    <td class="num">${money(p.price)}</td>
    <td class="num">${p.changedToday ? `<span class="pill ${p.changedToday > 0 ? 'pos' : 'neg'}">${p.changedToday > 0 ? '+' : ''}£${(p.changedToday / 10).toFixed(1)}m today</span>` : ''}</td>
  </tr>`;
  const table = (rows, empty) => rows.length
    ? `<div class="table-scroll"><table><thead><tr><th>Player</th><th class="num">Price</th><th class="num">Move</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`
    : `<p class="muted">${empty}</p>`;
  return `
    <div class="card">
      <h2>Price watch</h2>
      <p class="hint">📈 Predicted to <strong>rise</strong> soon — buy now to gain team value:</p>
      ${table((pw.risers || []).slice(0, 6), 'No strong risers right now.')}
      <p class="hint" style="margin-top:12px">📉 Predicted to <strong>fall</strong> — sell before the drop:</p>
      ${table((pw.fallers || []).slice(0, 6), 'No strong fallers right now.')}
      <p class="hint" style="margin-top:8px"><small>Predictions from transfer momentum — not guaranteed. "today" = a change already applied this day.</small></p>
    </div>`;
}

// Teams with the kindest / toughest upcoming runs — who to buy into and who to avoid.
function fixtureOutlookCard(a) {
  const o = a.fixtureOutlook;
  if (!o || !o.best?.length) return '';
  const runRow = (t) => `<tr>
    <td><strong>${esc(t.team)}</strong></td>
    <td class="num">${t.avgDifficulty ?? '—'}</td>
    <td><small class="muted">${(t.fixtures || []).slice(0, 5).map((f) => `${esc(f.opp)}${f.home ? '' : ' (a)'}`).join(', ')}</small></td>
  </tr>`;
  return `
    <div class="card">
      <h2>Fixture swings <span class="gw">· next 5 GWs</span></h2>
      <p class="hint">Good teams with soft runs — prime transfer-in targets (strong sides facing weak defences).</p>
      <div class="table-scroll"><table>
        <thead><tr><th>Team</th><th class="num">Avg FDR</th><th>Next fixtures</th></tr></thead>
        <tbody>${o.best.map(runRow).join('')}</tbody>
      </table></div>
      <p class="hint" style="margin-top:12px">Toughest runs — avoid buying, consider selling:</p>
      <div class="table-scroll"><table>
        <thead><tr><th>Team</th><th class="num">Avg FDR</th><th>Next fixtures</th></tr></thead>
        <tbody>${(o.tough || []).slice(0, 4).map(runRow).join('')}</tbody>
      </table></div>
    </div>`;
}

function renderCaptain(a) {
  const c = a.captain;
  const capHtml = c ? `
    <div class="card">
      <h2>Captaincy · GW ${a.targetGw}</h2>
      <div class="captain-pick">
        <div class="captain-box"><div class="role">Captain</div><div class="name cap-c">© ${esc(c.captain.name)}</div><div class="muted">${esc(c.captain.team)} · ${c.captain.projNext} pts proj</div></div>
        <div class="captain-box"><div class="role">Vice</div><div class="name">${esc(c.vice.name)}</div><div class="muted">${esc(c.vice.team)}</div></div>
        ${c.differential ? `<div class="captain-box"><div class="role">Differential</div><div class="name">${esc(c.differential.name)}</div><div class="muted">${c.differential.selectedBy}% owned</div></div>` : ''}
      </div>
    </div>` : '';

  const chips = (a.chips || []).map((ch) => `
    <div class="chip-row">
      <div class="chip-name">${esc(ch.chip)}${ch.when ? ` <span class="chip-when">${esc(ch.when)}</span>` : ''}</div>
      <div class="${ch.status === 'used' ? 'muted' : ''}">${esc(ch.recommendation)}</div>
    </div>`).join('');

  const dgw = (a.dgwBgw || []).filter((r) => r.doubleTeams.length || r.blankTeams.length).slice(0, 6).map((r) =>
    `<tr><td>GW ${r.gw}</td><td>${r.doubleTeams.length ? `${r.doubleTeams.length} teams` : '—'}</td><td>${r.blankTeams.length ? `${r.blankTeams.length} teams` : '—'}</td></tr>`
  ).join('');

  const attack = [...(a.attackGws || [])].sort((x, y) => y.index - x.index).slice(0, 5).map((g) => `<tr>
    <td>GW ${g.gw}</td>
    <td class="num">${g.index.toFixed(1)}</td>
    <td><small class="muted">${(g.fixtures || []).slice(0, 3).map((f) => `${esc(f.team)} ${f.home ? 'v' : '@'} ${esc(f.opponent)}`).join(', ')}</small></td>
  </tr>`).join('');

  $('#captain-content').innerHTML = `${capHtml}
    <div class="card"><h2>Chip strategy</h2><p class="hint">When to fire each chip, based on upcoming fixture swings and good-vs-bad matchups.</p>${chips}</div>
    ${attack ? `<div class="card"><h2>Best attacking gameweeks</h2><p class="hint">Weeks where the most strong teams face weak ones — prime for Triple Captain or Bench Boost.</p><div class="table-scroll"><table>
      <thead><tr><th>GW</th><th class="num">Index</th><th>Standout fixtures</th></tr></thead><tbody>${attack}</tbody></table></div></div>` : ''}
    ${dgw ? `<div class="card"><h2>Double &amp; blank gameweeks ahead</h2><div class="table-scroll"><table>
      <thead><tr><th>GW</th><th>Doubles</th><th>Blanks</th></tr></thead><tbody>${dgw}</tbody></table></div></div>` : ''}`;
}

function renderRivals(a) {
  const r = a.rivals;
  if (!r) return ($('#rivals-content').innerHTML = emptyCard('Add a League ID in Setup to analyse your mini-league rivals.'));

  const standings = (r.standings || []).slice(0, 15).map((s) => `<tr>
    <td class="num">${s.rank}</td><td>${esc(s.teamName || '')}<br><small class="muted">${esc(s.manager || '')}</small></td><td class="num">${(s.total || 0).toLocaleString()}</td>
  </tr>`).join('');

  const list = (arr, empty) => arr.length
    ? `<div class="table-scroll"><table><tbody>${arr.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.leagueOwnership != null ? p.leagueOwnership + '%' : ''}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${empty}</p>`;

  $('#rivals-content').innerHTML = `
    <div class="card">
      <h2>${esc(a.leagueName || 'Mini-league')} standings</h2>
      <div class="table-scroll"><table>
        <thead><tr><th class="num">#</th><th>Team</th><th class="num">Points</th></tr></thead>
        <tbody>${standings}</tbody>
      </table></div>
    </div>
    ${r.hasSquadData ? `
    <div class="card"><h2>League template</h2><p class="hint">Owned by at least half your rivals — being short here is a risk.</p>${list(r.template, 'No squad data yet (pre-season).')}</div>
    <div class="card"><h2>Your differentials</h2><p class="hint">You own these; few rivals do — your route to gaining rank.</p>${list(r.differentials, 'Load your Team ID to see differentials.')}</div>
    <div class="card"><h2>Threats you're missing</h2><p class="hint">Popular among rivals but not in your squad.</p>${list(r.threats, 'None — you cover the popular picks.')}</div>
    ` : '<div class="card"><p class="muted">Rival squad picks aren\'t available yet (they appear once the season is underway). Standings shown above.</p></div>'}`;
}

function emptyCard(msg) { return `<div class="card"><p class="empty">${esc(msg)}</p></div>`; }

// ---- Draft builder ------------------------------------------------------------------
function playerChip(p, { bench = false, captain = false } = {}) {
  const cls = `player-chip${bench ? ' bench' : ''}${captain ? ' cap' : ''}`;
  return `<div class="${cls}">
    <div class="pc-name">${esc(p.name)}${p.onPens ? ' <small class="muted">(P)</small>' : ''}</div>
    <div class="pc-meta"><span>${esc(p.team)} · ${money(p.price)}</span><span>${p.projHorizon} pts</span></div>
  </div>`;
}

function renderDraft(d) {
  if (!d || !d.complete) {
    $('#draft-content').innerHTML = emptyCard('Could not build a full squad with these settings — try a higher budget.');
    return;
  }
  const startIds = new Set(d.startingXI.map((p) => p.id));
  const posRow = (label, players) => `<div class="pitch-pos"><div class="pos-label">${label}</div><div class="pitch-row">${
    players.map((p) => playerChip(p, { captain: d.captain && p.id === d.captain.id })).join('')
  }</div></div>`;

  const xiByPos = (pos) => d.startingXI.filter((p) => p.position === pos);

  const ratingColor = d.rating >= 95 ? 'pos' : d.rating >= 88 ? 'warn' : 'neg';
  const title = d.isAlternative
    ? `Alternative squad <span class="gw">· seed ${d.seed} · GW ${d.targetGw} · ${d.horizon}-GW</span>`
    : `Optimal squad <span class="gw">· GW ${d.targetGw} · ${d.horizon}-GW projection</span>`;

  $('#draft-content').innerHTML = `
    <div class="card">
      <h2>${title}</h2>
      <div class="rating-banner">
        <div class="rating-score"><span class="pill ${ratingColor}">${d.rating}/100</span> <strong>${esc(d.grade)}</strong></div>
        <div class="muted">${d.isAlternative ? 'vs the optimal squad’s projection' : 'benchmark squad (100)'} · avg FDR ${d.ratingBreakdown.avgFixtureDifficulty ?? '—'} · value ${d.ratingBreakdown.value} pts/£m</div>
      </div>
      <div class="grid" style="margin-bottom:14px">
        ${statTile('Total cost', money(d.totalCost))}
        ${statTile('In the bank', money(d.remaining))}
        ${statTile('Formation', d.formation)}
        ${statTile('XI projected', d.projectedPoints + ' pts')}
        ${d.captain ? statTile('Captain', esc(d.captain.name)) : ''}
      </div>
      <p class="hint">Starting XI (captain Ⓒ):</p>
      ${posRow('Goalkeeper', xiByPos('GKP'))}
      ${posRow('Defenders', xiByPos('DEF'))}
      ${posRow('Midfielders', xiByPos('MID'))}
      ${posRow('Forwards', xiByPos('FWD'))}
      <p class="hint" style="margin-top:14px">Bench:</p>
      <div class="pitch-row">${d.bench.map((p) => playerChip(p, { bench: true })).join('')}</div>
    </div>`;
}

async function buildDraft(randomize = false) {
  const budget = $('#draft-budget').value.trim() || '100';
  const horizon = $('#draft-horizon').value;
  const label = randomize ? 'Rolling an alternative squad…' : 'Optimising your squad…';
  $('#draft-content').innerHTML = `<div class="card"><p class="empty"><span class="spinner"></span> ${label}</p></div>`;
  const rnd = randomize ? `&randomize=1&seed=${Math.floor(Math.random() * 1e9)}` : '';
  try {
    const res = await fetch(`/api/draft?budget=${encodeURIComponent(budget)}&horizon=${encodeURIComponent(horizon)}${rnd}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderDraft(await res.json());
  } catch (e) {
    $('#draft-content').innerHTML = `<div class="card"><div class="error-box">Couldn't build the squad: ${esc(e.message)}</div></div>`;
  }
}
$('#draft-build').addEventListener('click', () => buildDraft(false));
$('#draft-random').addEventListener('click', () => buildDraft(true));
// Build once the first time the Draft tab is opened.
let draftLoaded = false;
document.querySelector('.tab[data-tab="draft"]').addEventListener('click', () => {
  if (!draftLoaded) { draftLoaded = true; buildDraft(false); }
});

// ---- AI usage badge -----------------------------------------------------------------
async function refreshUsage() {
  const badge = $('#usage-badge');
  try {
    const u = await (await fetch('/api/usage')).json();
    if (!u.enabled) return badge.classList.add('hidden');
    const neuron = u.neuronsEstimate != null
      ? ` · ~<b>${u.neuronsEstimate.toLocaleString()}</b>/${u.freeNeuronsPerDay.toLocaleString()} Neurons`
      : ` · free tier: ${u.freeNeuronsPerDay.toLocaleString()} Neurons/day`;
    badge.innerHTML = `📊 AI today: <b>${u.calls}</b> plan${u.calls === 1 ? '' : 's'} · <b>${(u.totalTokens || 0).toLocaleString()}</b> tokens${neuron} · resets ${u.resetsAt}`;
    badge.classList.remove('hidden');
  } catch {
    badge.classList.add('hidden');
  }
}

// ---- Minimal markdown for the AI panel ----------------------------------------------
function renderMarkdown(md) {
  let html = esc(md);
  html = html.replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}

// ---- Load pipeline ------------------------------------------------------------------
async function load() {
  const league = $('#league-sub');
  const params = new URLSearchParams();
  if (store.teamId) params.set('teamId', store.teamId);
  if (store.leagueId) params.set('leagueId', store.leagueId);

  $('#dash-content').innerHTML = `<div class="card"><p class="empty"><span class="spinner"></span> Loading your gameweek…</p></div>`;
  $('#ai-body').innerHTML = `<span class="spinner"></span> <span class="muted">Waking the coach…</span>`;

  let advice;
  try {
    const res = await fetch(`/api/recommendations?${params.toString()}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    advice = await res.json();
  } catch (e) {
    $('#dash-content').innerHTML = `<div class="card"><div class="error-box">Couldn't load FPL data: ${esc(e.message)}. Check your Team/League IDs in Setup.</div></div>`;
    $('#ai-card').classList.add('hidden');
    return;
  }

  if (advice.leagueName) league.textContent = `${advice.leagueName} — your edge to climb the table.`;

  renderDashboard(advice);
  renderTransfers(advice);
  renderCaptain(advice);
  renderRivals(advice);

  // AI coach — best-effort, hides itself if no API key is configured.
  try {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(advice),
    });
    const data = await res.json();
    if (data.disabled) {
      // No provider wired up — show a short hint instead of hiding silently, so it's clear
      // this is a setup step (add the Workers AI `AI` binding), not an app error.
      $('#ai-card').classList.remove('hidden');
      $('#ai-body').innerHTML = `<span class="muted">AI coach is off — add a Workers AI binding named <code>AI</code> (or an ANTHROPIC_API_KEY) in Cloudflare, then redeploy. Check <a href="/api/health" target="_blank">/api/health</a> to confirm the binding.</span>`;
    } else if (!data.text && !data.error) {
      $('#ai-card').classList.add('hidden');
    } else if (data.error) {
      $('#ai-body').innerHTML = `<div class="error-box">AI coach error: ${esc(data.detail || data.error)}</div>`;
    } else {
      $('#ai-body').innerHTML = renderMarkdown(data.text);
    }
    refreshUsage();
  } catch {
    $('#ai-card').classList.add('hidden');
  }
}

load();
