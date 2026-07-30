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
  // Planned chip schedule: { slot: gw }, e.g. { wildcard1: 8, '3xc1': 3 }.
  get chipPlan() { try { return JSON.parse(localStorage.getItem('fpl_chip_plan') || '{}') || {}; } catch { return {}; } },
  setChip(slot, gw) {
    const map = store.chipPlan;
    if (Number.isFinite(gw)) map[slot] = gw; else delete map[slot];
    localStorage.setItem('fpl_chip_plan', JSON.stringify(map));
  },
  setChipPlan(map) { localStorage.setItem('fpl_chip_plan', JSON.stringify(map || {})); },
  clearChipPlan() { localStorage.removeItem('fpl_chip_plan'); },
};

// Serialize the saved chip plan for the API (`wildcard1:8,3xc1:3`).
function chipParam() {
  return Object.entries(store.chipPlan)
    .filter(([, gw]) => Number.isFinite(gw))
    .map(([slot, gw]) => `${slot}:${gw}`)
    .join(',');
}

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

// A small "lock into draft" button for table rows.
function lockBtn(p) {
  return `<button class="mini-lock" title="Lock into your draft" data-id="${p.id}" data-name="${esc(p.name)}" data-team="${esc(p.team)}" data-pos="${esc(p.position)}" data-price="${p.price}">🔒</button>`;
}

function gainPill(net) {
  const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
  const sign = net > 0 ? '+' : '';
  return `<span class="pill ${cls}">${sign}${net} pts</span>`;
}

// Inline-SVG bar chart of projected points per gameweek. Returns an HTML string (the app
// renders via innerHTML). Doubles are highlighted, blanks shown as faint gaps. Self-contained
// — no chart library — so it works within the Pages CSP.
function pointsChart(series, { heading, subtitle, selectedGw = null } = {}) {
  if (!series || !series.length) return '';
  const n = series.length;
  const max = Math.max(1, ...series.map((s) => s.points));
  const barW = 34, gap = 12, padL = 8, padT = 20, padB = 26, h = 160;
  const innerH = h - padT - padB;
  const w = padL * 2 + n * barW + (n - 1) * gap;
  const total = Math.round(series.reduce((s, p) => s + p.points, 0) * 10) / 10;

  const bars = series.map((s, i) => {
    const bh = Math.max(1, Math.round((s.points / max) * innerH));
    const x = padL + i * (barW + gap);
    const y = padT + (innerH - bh);
    const sel = selectedGw != null && s.gw === selectedGw ? ' sel' : '';
    const cls = (s.points <= 0.01 ? 'blank' : s.points > max * 0.66 ? 'dgw' : '') + sel;
    return `<g>
      <title>GW${s.gw}: ${s.points} pts</title>
      <rect class="bar ${cls}" x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3"></rect>
      <text class="bar-val" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${s.points}</text>
      <text class="bar-lbl" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">GW${s.gw}</text>
    </g>`;
  }).join('');

  return `<div class="card">
    ${heading ? `<h2>${esc(heading)} <span class="gw">· ${total} pts total</span></h2>` : ''}
    ${subtitle ? `<p class="hint">${esc(subtitle)}</p>` : ''}
    <div class="chart-scroll"><svg class="pts-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Projected points per gameweek" preserveAspectRatio="xMinYMid meet">${bars}</svg></div>
    <div class="chart-legend">
      <span class="key"><span class="swatch" style="background:var(--pl-green)"></span> strong week</span>
      <span class="key"><span class="swatch" style="background:var(--pl-magenta)"></span> normal</span>
      <span class="key"><span class="swatch" style="background:var(--border)"></span> blank</span>
    </div>
  </div>`;
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
    </div>
    ${a.projectionByGw
      ? pointsChart(a.projectionByGw, { heading: 'Your projected points', subtitle: 'Starting XI projection across the upcoming gameweeks.' })
      : '<div class="card"><p class="muted">Set your Team ID in Setup to see your team\'s projected points per gameweek.</p></div>'}`;
}

function renderTransfers(a) {
  const t = a.transfers;
  if (!t) return ($('#transfers-content').innerHTML = emptyCard('No transfer data.'));

  if (t.watchlistOnly) {
    const cols = Object.entries(t.watchlist).map(([pos, players]) => `
      <div class="card">
        <h2>${pos} watchlist</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Player</th><th class="num">Proj (3GW)</th><th class="num">xGI/90</th><th class="num">Value</th><th class="num">Owned</th><th></th></tr></thead>
          <tbody>${players.map((p) => `<tr>
            <td>${playerCell(p)}</td><td class="num">${p.projNext3}</td><td class="num">${p.xgi90 != null ? p.xgi90.toFixed(2) : '—'}</td><td class="num">${p.value}</td><td class="num">${p.selectedBy}%</td><td class="num">${lockBtn(p)}</td>
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

// The eight chip slots (base chip × half), mirroring src/chip-plan.js.
const CHIP_SLOTS = [
  { slot: 'wildcard', name: 'Wildcard' },
  { slot: 'bboost', name: 'Bench Boost' },
  { slot: '3xc', name: 'Triple Captain' },
  { slot: 'freehit', name: 'Free Hit' },
].flatMap((c) => [
  { slot: `${c.slot}1`, name: c.name, half: 1, min: 1, max: 19 },
  { slot: `${c.slot}2`, name: c.name, half: 2, min: 20, max: 38 },
]);

// Editable chip-strategy planner: suggested week + your pick + a validation verdict per chip.
function chipPlannerCard(a) {
  const targetGw = a.targetGw || 1;
  const suggested = a.suggestedChipPlan || {};
  const saved = store.chipPlan;
  const reviewBySlot = new Map((a.chipPlanReview || []).map((r) => [r.slot, r]));

  const row = (s) => {
    const start = Math.max(s.min, targetGw);
    const savedGw = Number.isFinite(saved[s.slot]) ? saved[s.slot] : null;
    let opts = `<option value="">— not planned —</option>`;
    for (let gw = start; gw <= s.max; gw += 1) {
      opts += `<option value="${gw}"${savedGw === gw ? ' selected' : ''}>GW${gw}</option>`;
    }
    const sug = suggested[s.slot];
    const rev = reviewBySlot.get(s.slot);
    let verdict = '';
    if (savedGw != null && rev) {
      verdict = `<span class="chip-badge ${rev.ok ? 'ok' : 'warn'}">${rev.ok ? '✓' : '⚠'}</span> <small class="${rev.ok ? 'muted' : 'urgent-text'}">${esc(rev.note)}</small>`;
    } else if (sug) {
      verdict = `<small class="muted">Suggested GW${sug.gw} — ${esc(sug.reason)}</small>`;
    } else {
      verdict = `<small class="muted">No standout week yet.</small>`;
    }
    const disabled = start > s.max ? ' disabled' : '';
    return `<tr>
      <td class="chip-cell-name">${esc(s.name)}</td>
      <td><select class="chip-select" data-slot="${s.slot}"${disabled}>${opts}</select></td>
      <td class="chip-cell-verdict">${verdict}</td>
    </tr>`;
  };

  const half = (n, label) => `<h3 class="chip-half">${label}</h3>
    <div class="table-scroll"><table class="chip-plan-table">
      <thead><tr><th>Chip</th><th>Your week</th><th>Verdict</th></tr></thead>
      <tbody>${CHIP_SLOTS.filter((s) => s.half === n).map(row).join('')}</tbody>
    </table></div>`;

  const planned = Object.keys(saved).length;
  const influence = planned
    ? `<p class="chip-influence-line">♟️ Your plan is shaping transfer suggestions and drafts below.</p>`
    : `<p class="hint">Set your intended chip weeks and the model plans transfers &amp; drafts around them — no −4 hits before a Wildcard, a strong bench for a Bench Boost week.</p>`;

  return `<div class="card" id="chip-plan-card">
    <div class="chip-plan-head">
      <h2>♟️ Chip strategy</h2>
      <div class="chip-plan-actions">
        <button class="ghost" id="chip-suggest">✨ Use suggested plan</button>
        <button class="ghost" id="chip-clear" title="Remove your planned weeks">Clear</button>
      </div>
    </div>
    ${influence}
    ${half(1, 'First half · GW1–19')}
    ${half(2, 'Second half · GW20–38')}
  </div>`;
}

// Attach the planner's inputs after it's in the DOM. Editing the plan re-runs load() so the
// server recomputes advice, transfers and (via the saved plan) the draft with the new chips.
function wireChipPlanner(a) {
  document.querySelectorAll('.chip-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const gw = parseInt(sel.value, 10);
      store.setChip(sel.dataset.slot, Number.isFinite(gw) ? gw : null);
      load();
    });
  });
  $('#chip-suggest')?.addEventListener('click', () => {
    const map = {};
    for (const [slot, v] of Object.entries(a.suggestedChipPlan || {})) {
      if (v && Number.isFinite(v.gw)) map[slot] = v.gw;
    }
    store.setChipPlan(map);
    load();
  });
  $('#chip-clear')?.addEventListener('click', () => { store.clearChipPlan(); load(); });
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
      ${a.tripleCaptain ? `<p class="hint" style="margin-top:12px">🔺 <strong>Triple Captain target:</strong> ${esc(a.tripleCaptain.name)} in <strong>GW${a.tripleCaptain.gw}</strong> ${a.tripleCaptain.home ? 'at home to' : 'away at'} ${esc(a.tripleCaptain.opponent)}${a.tripleCaptain.promoted ? ' (newly-promoted/weak side)' : ''} — proj ${a.tripleCaptain.points ?? '—'} pts.</p>` : ''}
    </div>` : '';

  const chipBadge = (ch) => {
    if (ch.status === 'used') return '';
    if (ch.planned) return ch.ok === false ? ' <span class="pill neg">check week</span>' : ' <span class="pill pos">planned</span>';
    if (ch.status === 'urgent') return ' <span class="pill neg">use soon</span>';
    return '';
  };
  const chips = (a.chips || []).map((ch) => `
    <div class="chip-row">
      <div class="chip-name">${esc(ch.chip)}${ch.when ? ` <span class="chip-when">${esc(ch.when)}</span>` : ''}${chipBadge(ch)}</div>
      <div class="${ch.status === 'used' ? 'muted' : ch.status === 'urgent' ? 'urgent-text' : ''}">${esc(ch.recommendation)}</div>
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
    ${chipPlannerCard(a)}
    <div class="card"><h2>This half's chip calls</h2><p class="hint">The model's read for the current window — your planned weeks are marked, the rest are auto-suggested from upcoming fixture swings.</p>${chips}</div>
    ${attack ? `<div class="card"><h2>Best attacking gameweeks</h2><p class="hint">Weeks where the most strong teams face weak ones — prime for Triple Captain or Bench Boost.</p><div class="table-scroll"><table>
      <thead><tr><th>GW</th><th class="num">Index</th><th>Standout fixtures</th></tr></thead><tbody>${attack}</tbody></table></div></div>` : ''}
    ${dgw ? `<div class="card"><h2>Double &amp; blank gameweeks ahead</h2><div class="table-scroll"><table>
      <thead><tr><th>GW</th><th>Doubles</th><th>Blanks</th></tr></thead><tbody>${dgw}</tbody></table></div></div>` : ''}`;

  wireChipPlanner(a);
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
    ${rankGainCard(r)}
    <div class="card"><h2>League template</h2><p class="hint">Owned by at least half your rivals — being short here is a risk.</p>${list(r.template, 'No squad data yet (pre-season).')}</div>
    <div class="card"><h2>Your differentials</h2><p class="hint">You own these; few rivals do — your route to gaining rank.</p>${list(r.differentials, 'Load your Team ID to see differentials.')}</div>
    <div class="card"><h2>Threats you're missing</h2><p class="hint">Popular among rivals but not in your squad.</p>${list(r.threats, 'None — you cover the popular picks.')}</div>
    ` : '<div class="card"><p class="muted">Rival squad picks aren\'t available yet (they appear once the season is underway). Standings shown above.</p></div>'}`;
}

function emptyCard(msg) { return `<div class="card"><p class="empty">${esc(msg)}</p></div>`; }

// Rank-gain: the players that most improve your standing vs this specific league.
function rankGainCard(r) {
  const targets = r.rankGainTargets || [];
  const risks = r.templateRisks || [];
  if (!targets.length && !risks.length) return '';
  const row = (p) => `<tr>
    <td><strong>${esc(p.name)}</strong> <small class="muted">${esc(p.team)} · ${esc(p.position)}</small></td>
    <td class="num">${p.price != null ? money(p.price) : '—'}</td>
    <td class="num">${p.projNext3 ?? '—'}</td>
    <td class="num">${p.leagueOwnership}%</td>
    <td class="num"><strong>${p.rankGain ?? '—'}</strong></td>
    <td class="num">${lockBtn(p)}</td>
  </tr>`;
  const table = (rows) => `<div class="table-scroll"><table>
    <thead><tr><th>Player</th><th class="num">Price</th><th class="num">Proj 3GW</th><th class="num">Rivals own</th><th class="num">Rank-gain</th><th></th></tr></thead>
    <tbody>${rows.map(row).join('')}</tbody></table></div>`;
  return `
    <div class="card">
      <h2>🎯 Rank-gain targets</h2>
      <p class="hint">Best differentials to climb <em>this</em> league — strong projection that few rivals own. Rank-gain = projected points × share of rivals who don't own them.</p>
      ${targets.length ? table(targets) : '<p class="muted">No standout differentials right now.</p>'}
      ${risks.length ? `<p class="hint" style="margin-top:12px">⚠ Template you're missing (cover these or risk losing rank if they haul):</p>${table(risks)}` : ''}
    </div>`;
}

// ---- Draft builder ------------------------------------------------------------------
function playerChip(p, { bench = false, captain = false, gwPoints = null } = {}) {
  // When a gameweek is selected, show that GW's projection (horizon total in the tooltip);
  // otherwise show the horizon total. A blank GW (0) dims the chip.
  const perGw = gwPoints != null;
  const pts = perGw ? gwPoints : p.projHorizon;
  const blank = perGw && gwPoints <= 0.01;
  const cls = `player-chip${bench ? ' bench' : ''}${captain ? ' cap' : ''}${blank ? ' blank' : ''}`;
  const nailed = p.nailed ? `<span class="nailed-dot" title="Nailed-on starter (${(p.minutes || 0).toLocaleString()} mins)">●</span>` : '';
  const ptsTitle = perGw ? ` title="${p.projHorizon} pts over the horizon"` : '';
  return `<div class="${cls}">
    <div class="pc-name">${esc(p.name)}${nailed}${p.onPens ? ' <small class="muted">(P)</small>' : ''}</div>
    <div class="pc-meta"><span>${esc(p.team)} · ${money(p.price)}</span><span${ptsTitle}>${pts} pts</span></div>
  </div>`;
}

// The draft the tab is currently showing, plus which gameweek the stepper is on, so the ◀/▶
// arrows can re-render the same squad focused on a different GW without refetching.
let lastDraft = null;
let draftGwIndex = 0;

function renderDraft(d) {
  if (!d || !d.complete) {
    $('#draft-content').innerHTML = emptyCard('Could not build a full squad with these settings — try a higher budget.');
    return;
  }
  const series = d.pointsByGw || [];
  draftGwIndex = Math.max(0, Math.min(draftGwIndex, series.length - 1));
  const selected = series[draftGwIndex] || null;
  const selectedGw = selected ? selected.gw : null;
  const gwPointsFor = (p) => (selectedGw != null ? p.pointsByGw?.find((g) => g.gw === selectedGw)?.points ?? 0 : null);

  const posRow = (label, players) => `<div class="pitch-pos"><div class="pos-label">${label}</div><div class="pitch-row">${
    players.map((p) => playerChip(p, { captain: d.captain && p.id === d.captain.id, gwPoints: gwPointsFor(p) })).join('')
  }</div></div>`;

  const xiByPos = (pos) => d.startingXI.filter((p) => p.position === pos);

  const ratingColor = d.rating >= 95 ? 'pos' : d.rating >= 88 ? 'warn' : 'neg';
  const title = d.isAlternative
    ? `Alternative squad <span class="gw">· seed ${d.seed} · GW ${d.targetGw} · ${d.horizon}-GW</span>`
    : `Optimal squad <span class="gw">· GW ${d.targetGw} · ${d.horizon}-GW projection</span>`;

  // Gameweek stepper: cycle the pitch through each GW in the horizon and show that week's total.
  const xiGwTotal = selected ? Math.round(selected.points * 10) / 10 : null;
  const stepper = series.length
    ? `<div class="gw-stepper">
        <button class="ghost gw-nav" id="draft-gw-prev" ${draftGwIndex <= 0 ? 'disabled' : ''} aria-label="Previous gameweek">◀</button>
        <div class="gw-stepper-label"><strong>GW ${selectedGw}</strong> · <span class="gw-total">${xiGwTotal} pts</span> projected XI
          <div class="muted">Gameweek ${draftGwIndex + 1} of ${series.length} · use ◀ ▶ or arrow keys</div>
        </div>
        <button class="ghost gw-nav" id="draft-gw-next" ${draftGwIndex >= series.length - 1 ? 'disabled' : ''} aria-label="Next gameweek">▶</button>
      </div>`
    : '';

  $('#draft-content').innerHTML = `
    <div class="card">
      <h2>${title}</h2>
      <div class="rating-banner">
        <div class="rating-score"><span class="pill ${ratingColor}">${d.rating}/100</span> <strong>${esc(d.grade)}</strong></div>
        <div class="muted">${d.isAlternative ? 'vs the optimal squad’s projection' : 'benchmark squad (100)'} · rated on ${esc(d.objectiveLabel || 'XI + captain')} · avg FDR ${d.ratingBreakdown.avgFixtureDifficulty ?? '—'} · value ${d.ratingBreakdown.value} pts/£m</div>
      </div>
      ${d.benchBoost ? `<p class="hint">🪑 <strong>Bench Boost mode:</strong> all 15 players score, so the squad is optimised as a whole (not just the XI). The headline counts all 15 + captain.</p>` : ''}
      ${lockNote(d)}
      <div class="grid" style="margin-bottom:14px">
        ${statTile('Total cost', money(d.totalCost))}
        ${statTile('In the bank', money(d.remaining))}
        ${statTile('Formation', d.formation)}
        ${statTile(esc(d.objectiveLabel || 'XI + captain'), (d.effectiveProjection ?? d.projectedPoints) + ' pts')}
        ${d.captain ? statTile('Captain', esc(d.captain.name)) : ''}
      </div>
      ${stepper}
      <p class="hint">Starting XI (captain Ⓒ)${selectedGw != null ? ` — points shown for <strong>GW ${selectedGw}</strong>` : ''}:</p>
      ${posRow('Goalkeeper', xiByPos('GKP'))}
      ${posRow('Defenders', xiByPos('DEF'))}
      ${posRow('Midfielders', xiByPos('MID'))}
      ${posRow('Forwards', xiByPos('FWD'))}
      <p class="hint" style="margin-top:14px">Bench:</p>
      <div class="pitch-row">${d.bench.map((p) => playerChip(p, { bench: true, gwPoints: gwPointsFor(p) })).join('')}</div>
    </div>
    ${pointsChart(series, { heading: 'Squad projected points', subtitle: 'Starting XI projection per gameweek over your chosen horizon. Tap ◀ ▶ above to focus a week.', selectedGw })}`;

  // Wire the stepper (re-renders the same draft focused on the new GW).
  $('#draft-gw-prev')?.addEventListener('click', () => stepDraftGw(-1));
  $('#draft-gw-next')?.addEventListener('click', () => stepDraftGw(1));
}

// Move the draft's selected gameweek and re-render, clamped to the horizon.
function stepDraftGw(delta) {
  if (!lastDraft?.pointsByGw?.length) return;
  const next = draftGwIndex + delta;
  if (next < 0 || next >= lastDraft.pointsByGw.length) return;
  draftGwIndex = next;
  renderDraft(lastDraft);
}

// ---- Locked (must-have) players -----------------------------------------------------
const lockedPlayers = [];
const playerByLabel = new Map();
let playersLoaded = false;

async function loadPlayers() {
  if (playersLoaded) return;
  try {
    const { players } = await (await fetch('/api/players')).json();
    const dl = $('#player-list');
    dl.innerHTML = players
      .map((p) => {
        const label = `${p.name} — ${p.team} · ${p.position} · ${money(p.price)}`;
        playerByLabel.set(label.toLowerCase(), p);
        return `<option value="${esc(label)}"></option>`;
      })
      .join('');
    playersLoaded = true;
  } catch { /* search just won't autocomplete */ }
}

const LOCKS_KEY = 'fpl_locks';
function saveLocks() {
  try { localStorage.setItem(LOCKS_KEY, JSON.stringify(lockedPlayers)); } catch { /* storage full/blocked */ }
}

function renderLockedChips() {
  $('#locked-chips').innerHTML = lockedPlayers
    .map((p, i) => `<span class="locked-chip">${esc(p.name)} <small class="muted">${esc(p.team)}</small><button data-i="${i}" title="Remove">×</button></span>`)
    .join('');
  document.querySelectorAll('#locked-chips button').forEach((b) =>
    b.addEventListener('click', () => { lockedPlayers.splice(Number(b.dataset.i), 1); renderLockedChips(); })
  );
  saveLocks(); // persist after every add / remove / load so locks survive a refresh
}

// Restore locked players saved from a previous session.
try {
  const saved = JSON.parse(localStorage.getItem(LOCKS_KEY) || '[]');
  if (Array.isArray(saved)) { for (const p of saved) if (p && p.id != null) lockedPlayers.push(p); }
} catch { /* ignore corrupt storage */ }
renderLockedChips();

// Toast for feedback when locking from other tabs.
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// Shared lock action — used by the search box and the ＋ buttons in tables.
function lockPlayerObj(p, { notify = false } = {}) {
  if (!p || p.id == null) return;
  if (lockedPlayers.some((x) => x.id === p.id)) { if (notify) toast(`${p.name} is already locked`); return; }
  if (lockedPlayers.length >= 15) { if (notify) toast('Squad is full (15 locked)'); return; }
  lockedPlayers.push({ id: p.id, name: p.name, team: p.team, position: p.position, price: p.price });
  renderLockedChips();
  if (notify) toast(`🔒 Locked ${p.name} — build in the Draft tab`);
}

function addLock() {
  const val = $('#lock-input').value.trim().toLowerCase();
  if (!val) return;
  let p = playerByLabel.get(val);
  if (!p) {
    for (const [label, pl] of playerByLabel) {
      if (label.startsWith(val) || pl.name.toLowerCase() === val) { p = pl; break; }
    }
  }
  if (!p) return;
  lockPlayerObj(p);
  $('#lock-input').value = '';
}
$('#lock-add').addEventListener('click', addLock);
$('#lock-clear')?.addEventListener('click', () => { lockedPlayers.length = 0; renderLockedChips(); });

// Lock straight from any table row that carries a .mini-lock button (Stats / Transfers).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mini-lock');
  if (!btn) return;
  lockPlayerObj({
    id: Number(btn.dataset.id),
    name: btn.dataset.name,
    team: btn.dataset.team,
    position: btn.dataset.pos,
    price: parseFloat(btn.dataset.price),
  }, { notify: true });
});
$('#lock-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLock(); } });
// Bench Boost toggle: relabel and rebuild.
$('#draft-bb')?.addEventListener('change', (e) => {
  const lbl = e.target.closest('.switch')?.querySelector('.switch-label');
  if (lbl) lbl.textContent = e.target.checked ? 'On' : 'Off';
  if (typeof draftLoaded !== 'undefined' && draftLoaded) buildDraft(false);
});

function lockNote(d) {
  const inc = d.lockedIncluded || [];
  const exc = d.lockedExcluded || [];
  if (!inc.length && !exc.length) return '';
  let html = '';
  if (inc.length) html += `<div class="lock-note">🔒 Locked in: <strong>${inc.map((p) => esc(p.name)).join(', ')}</strong> — squad built around them.</div>`;
  if (exc.length) html += `<div class="lock-note lock-warn">⚠ Couldn't lock: ${exc.map((p) => `${esc(p.name || 'player')} (${esc(p.reason)})`).join(', ')}. Adjust budget or picks.</div>`;
  return html;
}

async function buildDraft(randomize = false) {
  const budget = $('#draft-budget').value.trim() || '100';
  const horizon = $('#draft-horizon').value;
  const label = randomize ? 'Rolling an alternative squad…' : 'Optimising your squad…';
  $('#draft-content').innerHTML = `<div class="card"><p class="empty"><span class="spinner"></span> ${label}</p></div>`;
  const rnd = randomize ? `&randomize=1&seed=${Math.floor(Math.random() * 1e9)}` : '';
  const lock = lockedPlayers.length ? `&lock=${lockedPlayers.map((p) => p.id).join(',')}` : '';
  // Auto-enable Bench Boost mode when you've planned a Bench Boost within this horizon —
  // the draft should then value a strong bench, not a cheap 4.0 backup keeper.
  const tgw = latestAdvice?.targetGw || 1;
  const bbGw = store.chipPlan[`bboost${tgw <= 19 ? 1 : 2}`];
  const autoBB = Number.isFinite(bbGw) && bbGw >= tgw && bbGw < tgw + parseInt(horizon, 10);
  const bbToggle = $('#draft-bb');
  if (autoBB && bbToggle && !bbToggle.checked) {
    bbToggle.checked = true;
    const lbl = bbToggle.closest('.switch')?.querySelector('.switch-label');
    if (lbl) lbl.textContent = 'On';
    toast(`Bench Boost planned GW${bbGw} — building a bench-strong squad`);
  }
  const bb = (bbToggle?.checked || autoBB) ? '&bb=1' : '';
  try {
    const res = await fetch(`/api/draft?budget=${encodeURIComponent(budget)}&horizon=${encodeURIComponent(horizon)}${rnd}${lock}${bb}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastDraft = await res.json();
    draftGwIndex = 0; // a fresh build starts on the first gameweek
    renderDraft(lastDraft);
  } catch (e) {
    $('#draft-content').innerHTML = `<div class="card"><div class="error-box">Couldn't build the squad: ${esc(e.message)}</div></div>`;
  }
}

// Left/Right arrow keys step the draft gameweek while the Draft tab is open.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const draftOpen = !$('#tab-draft')?.classList.contains('hidden');
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (!draftOpen || typing || !lastDraft) return;
  stepDraftGw(e.key === 'ArrowLeft' ? -1 : 1);
});
// Load the manager's current FPL squad and lock it in — start from your real team, then
// unlock individual players to let the optimiser suggest replacements.
async function loadMyTeam() {
  if (!store.teamId) { toast('Set your Team ID in Setup first'); return; }
  toast('Loading your team…');
  try {
    const data = await (await fetch(`/api/myteam?teamId=${encodeURIComponent(store.teamId)}`)).json();
    if (!data.found) { toast(data.reason || 'No saved team yet'); return; }
    lockedPlayers.length = 0;
    for (const p of data.players) lockedPlayers.push(p);
    renderLockedChips();
    toast(`Loaded your GW${data.gw} squad — unlock any player to get swap ideas`);
    buildDraft(false);
  } catch (e) {
    toast('Could not load your team');
  }
}
$('#load-team').addEventListener('click', loadMyTeam);
$('#draft-build').addEventListener('click', () => buildDraft(false));
$('#draft-random').addEventListener('click', () => buildDraft(true));
// Build once the first time the Draft tab is opened, and load the player index for locking.
let draftLoaded = false;
document.querySelector('.tab[data-tab="draft"]').addEventListener('click', () => {
  loadPlayers();
  if (!draftLoaded) { draftLoaded = true; buildDraft(false); }
});

// ---- Stats (advanced Opta-derived metrics) ------------------------------------------
let statsMetricsLoaded = false;
async function loadStats(metric) {
  const content = $('#stats-content');
  content.innerHTML = `<div class="card"><p class="empty"><span class="spinner"></span> Loading stats…</p></div>`;
  try {
    const q = metric ? `?metric=${encodeURIComponent(metric)}` : '';
    const data = await (await fetch(`/api/stats${q}`)).json();
    if (data.error) throw new Error(data.error);

    // Populate the metric dropdown once.
    const sel = $('#stats-metric');
    if (!statsMetricsLoaded && data.metrics) {
      sel.innerHTML = data.metrics.map((m) => `<option value="${m.key}">${esc(m.label)}</option>`).join('');
      sel.value = data.metric;
      statsMetricsLoaded = true;
    }

    const rows = data.leaders.map((p, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><strong>${esc(p.name)}</strong> <small class="muted">${esc(p.team)} · ${esc(p.position)}</small></td>
      <td class="num">${money(p.price)}</td>
      <td class="num"><strong>${p.value}</strong></td>
      <td class="num muted">${(p.minutes || 0).toLocaleString()}'</td>
      <td class="num">${lockBtn(p)}</td>
    </tr>`).join('');

    content.innerHTML = `<div class="card">
      <h2>${esc(data.label)} — top players</h2>
      <p class="hint">🔒 lock a player straight into your draft.</p>
      <div class="table-scroll"><table>
        <thead><tr><th class="num">#</th><th>Player</th><th class="num">Price</th><th class="num">${esc(data.label)}</th><th class="num">Mins</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="error-box">Couldn't load stats: ${esc(e.message)}</div></div>`;
  }
}
$('#stats-metric').addEventListener('change', (e) => loadStats(e.target.value));
let statsLoaded = false;
document.querySelector('.tab[data-tab="stats"]').addEventListener('click', () => {
  if (!statsLoaded) { statsLoaded = true; loadStats(); }
});

// ---- Multi-week transfer plan -------------------------------------------------------
async function loadPlan() {
  const el = $('#plan-content');
  if (!el) return;
  if (!store.teamId) { el.innerHTML = ''; return; }
  try {
    const chips = chipParam();
    const p = await (await fetch(`/api/plan?teamId=${encodeURIComponent(store.teamId)}&horizon=5${chips ? `&chips=${encodeURIComponent(chips)}` : ''}`)).json();
    if (!p.hasSquad) { el.innerHTML = ''; return; }
    if (!p.roadmap?.length) {
      el.innerHTML = `<div class="card"><h2>Transfer plan <span class="gw">· next ${p.horizon} GWs</span></h2><p class="muted">No upgrades beat your current squad over the next ${p.horizon} gameweeks — hold your transfers.</p></div>`;
      return;
    }
    const rows = p.roadmap.map((m) => `<tr>
      <td><strong>GW ${p.targetGw + m.weekOffset}</strong>${m.weekOffset === 0 ? ' <span class="pill pos">now</span>' : ''}</td>
      <td class="move"><span class="pill neg">OUT</span> ${esc(m.out.name)} <span class="arrow">→</span> <span class="pill pos">IN</span> ${esc(m.in.name)} <small class="muted">${esc(m.in.team)}</small></td>
      <td class="num">+${m.realizedGain} pts</td>
    </tr>`).join('');
    const hit = (p.hitWorthy || []).length
      ? `<p class="hint" style="margin-top:10px">💥 Worth a −4 hit now: ${p.hitWorthy.map((h) => `${esc(h.out.name)}→${esc(h.in.name)} (+${h.nowGain})`).join(', ')}</p>`
      : '';
    const chipNotes = (p.chipNotes || []).length
      ? `<div class="chip-influence">${p.chipNotes.map((n) => `<div>♟️ ${esc(n)}</div>`).join('')}</div>`
      : '';
    el.innerHTML = `<div class="card">
      <h2>📅 Transfer plan <span class="gw">· ${p.freeTransfers} FT · ${money(p.bank)} bank · next ${p.horizon} GWs</span></h2>
      <p class="hint">One free transfer per week (no hits), best moves first so you bank the gains for longer.</p>
      ${chipNotes}
      <div class="table-scroll"><table>
        <thead><tr><th>When</th><th>Move</th><th class="num">Gain</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>${hit}
    </div>`;
  } catch { el.innerHTML = ''; }
}

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

// ---- Model accuracy (calibration) ---------------------------------------------------
async function loadAccuracy() {
  const el = $('#accuracy-card');
  if (!el) return;
  try {
    const a = await (await fetch('/api/accuracy')).json();
    if (!a.available) {
      el.innerHTML = `<div class="card"><h2>Model accuracy</h2><p class="muted">${esc(a.reason || 'Not available yet.')} Accuracy metrics appear once gameweeks have been played.</p></div>`;
      return;
    }
    const spearPct = a.spearman != null ? Math.round(a.spearman * 100) : null;
    el.innerHTML = `<div class="card">
      <h2>Model accuracy <span class="gw">· GW${a.gw}</span></h2>
      <div class="grid">
        ${statTile('Rank correlation', spearPct != null ? spearPct + '%' : '—')}
        ${statTile('Avg error (MAE)', a.mae != null ? a.mae + ' pts' : '—')}
        ${statTile('Bias', a.bias != null ? (a.bias > 0 ? '+' : '') + a.bias : '—')}
        ${statTile('Players', a.count)}
      </div>
      <p class="hint" style="margin-top:10px">${esc(a.note || '')}</p>
    </div>`;
  } catch { el.innerHTML = ''; }
}

// ---- Load pipeline ------------------------------------------------------------------
async function load() {
  const league = $('#league-sub');
  const params = new URLSearchParams();
  if (store.teamId) params.set('teamId', store.teamId);
  if (store.leagueId) params.set('leagueId', store.leagueId);
  const chips = chipParam();
  if (chips) params.set('chips', chips);

  $('#dash-content').innerHTML = `<div class="card"><p class="empty"><span class="spinner"></span> Loading your gameweek…</p></div>`;

  let advice;
  try {
    const res = await fetch(`/api/recommendations?${params.toString()}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    advice = await res.json();
  } catch (e) {
    $('#dash-content').innerHTML = `<div class="card"><div class="error-box">Couldn't load FPL data: ${esc(e.message)}. Check your Team/League IDs in Setup.</div></div>`;
    return;
  }

  if (advice.leagueName) league.textContent = `${advice.leagueName} — your edge to climb the table.`;

  // Stash the advice so the AI coach can be generated on demand (it never auto-runs).
  latestAdvice = advice;
  resetCoach();

  renderDashboard(advice);
  renderTransfers(advice);
  renderCaptain(advice);
  renderRivals(advice);
  loadPlan();
  loadAccuracy();
}

// Latest recommendations payload, fed to the AI coach when the user asks for a plan.
let latestAdvice = null;

// Return the coach panel to its "press to generate" idle state after each fresh load.
function resetCoach() {
  const btn = $('#ai-run');
  if (btn) btn.disabled = false;
  $('#ai-body').innerHTML = `<span class="muted">Press <strong>Generate game plan</strong> for a written weekly plan from the numbers on this page.</span>`;
}

// AI coach — user-triggered only. Best-effort; shows a setup hint if no provider is wired up.
async function loadCoach() {
  if (!latestAdvice) {
    $('#ai-body').innerHTML = `<span class="muted">Load your gameweek first, then generate a plan.</span>`;
    return;
  }
  const btn = $('#ai-run');
  if (btn) btn.disabled = true;
  $('#ai-body').innerHTML = `<span class="spinner"></span> <span class="muted">Waking the coach…</span>`;
  try {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(latestAdvice),
    });
    const data = await res.json();
    if (data.disabled) {
      // No provider wired up — show a short hint so it's clear this is a setup step
      // (add the Workers AI `AI` binding), not an app error.
      $('#ai-body').innerHTML = `<span class="muted">AI coach is off — add a Workers AI binding named <code>AI</code> (or an ANTHROPIC_API_KEY) in Cloudflare, then redeploy. Check <a href="/api/health" target="_blank">/api/health</a> to confirm the binding.</span>`;
    } else if (data.error) {
      $('#ai-body').innerHTML = `<div class="error-box">AI coach error: ${esc(data.detail || data.error)}</div>`;
    } else if (!data.text) {
      $('#ai-body').innerHTML = `<span class="muted">No plan came back — try again.</span>`;
    } else {
      $('#ai-body').innerHTML = renderMarkdown(data.text);
    }
    refreshUsage();
  } catch (e) {
    $('#ai-body').innerHTML = `<div class="error-box">AI coach error: ${esc(e.message)}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

$('#ai-run')?.addEventListener('click', loadCoach);

load();
