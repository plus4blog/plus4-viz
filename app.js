// ── STATE ─────────────────────────────────────────────────────────────────────────────────
let allData      = [];   // raw parsed rows from CSL CSV
let projData     = {};   // dg_id -> {adjusted_course_fit, adjusted_sg_total, salary}
let leadinData   = {};   // dg_id -> {lead_in_z, lead_in_raw, predictors_found, top_course}
let players      = [];   // [{name, salary, courses, proj_rank, adjusted_sg_total, adjusted_course_fit}]
let activeSkill  = null; // global skill filter (null = all)
let sortBy       = 'salary';
let sortDir      = 'desc';
let searchQuery  = '';
let viewMode     = 'card';
let breakdownRows = [];  // cached for sort/filter without re-aggregating

const SKILL_LABELS = {
  sg_ott  : 'Off the Tee',
  sg_app  : 'Approach',
  sg_arg  : 'Around Green',
  sg_putt : 'Putting',
  sg_total: 'Other Tours'
};

const SKILL_COLORS = {
  sg_ott  : 'rgba(204,31,31,0.85)',
  sg_app  : 'rgba(240,180,41,0.7)',
  sg_arg  : 'rgba(34,197,94,0.7)',
  sg_putt : 'rgba(168,85,247,0.7)',
  sg_total: 'rgba(249,115,22,0.7)'
};

// ── CSV LOADING ─────────────────────────────────────────────────────────────────────────
const BASE_DATA_URL = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/data';

let activeTour = localStorage.getItem('plus4_tour') || 'pga';

function csvUrl()    { return `${BASE_DATA_URL}/${activeTour}_course_skill_lookup.csv?v=${Date.now()}`; }
function projUrl()   { return `${BASE_DATA_URL}/${activeTour}_player_projections.csv?v=${Date.now()}`; }
function leadinUrl() { return `${BASE_DATA_URL}/${activeTour}_leadin_scores.csv?v=${Date.now()}`; }

document.querySelectorAll('#tour-toggle .sort-btn').forEach(b => {
  b.classList.toggle('active', b.dataset.tour === activeTour);
});

function loadCSV() {
  const status = document.getElementById('load-status');
  status.textContent = 'Loading data...';

  let coursesDone = false, projDone = false, leadinDone = false;

  function tryProcess() {
    if (!coursesDone || !projDone || !leadinDone) return;
    processData();
    status.textContent = `Updated ${new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}`;
  }

  Papa.parse(csvUrl(), {
    download: true, header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: result => { allData = result.data; coursesDone = true; tryProcess(); },
    error: err => { status.textContent = 'Failed to load data'; console.error(err); }
  });

  Papa.parse(projUrl(), {
    download: true, header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: result => {
      projData = {};
      result.data.forEach(row => {
        if (row.dg_id) projData[row.dg_id] = {
          player_name         : row.player_name,
          adjusted_course_fit : row.adjusted_course_fit != null ? parseFloat(row.adjusted_course_fit) : null,
          adjusted_sg_total   : row.adjusted_sg_total   != null ? parseFloat(row.adjusted_sg_total)   : null,
          salary              : row.salary              != null ? parseFloat(row.salary)              : null
        };
      });
      projDone = true;
      tryProcess();
    },
    error: err => { projDone = true; tryProcess(); console.error('Projections fetch error:', err); }
  });

  Papa.parse(leadinUrl(), {
    download: true, header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: result => {
      leadinData = {};
      result.data.forEach(row => {
        if (row.dg_id) leadinData[row.dg_id] = {
          lead_in_z       : row.lead_in_z       != null ? parseFloat(row.lead_in_z)       : null,
          lead_in_raw     : row.lead_in_raw     != null ? parseFloat(row.lead_in_raw)     : null,
          predictors_found: row.predictors_found != null ? parseInt(row.predictors_found) : null,
          top_course      : row.top_course || null
        };
      });
      leadinDone = true;
      tryProcess();
    },
    error: err => { leadinDone = true; tryProcess(); console.error('Lead-in fetch error:', err); }
  });
}

loadCSV();

// ── TOUR TOGGLE ─────────────────────────────────────────────────────────────────────────
document.getElementById('tour-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.sort-btn');
  if (!btn || !btn.dataset.tour) return;
  activeTour = btn.dataset.tour;
  localStorage.setItem('plus4_tour', activeTour);
  document.querySelectorAll('#tour-toggle .sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadCSV();
});

function processData() {
  if (!allData.length) return;

  const targetName = allData[0]?.target_course_name;
  document.getElementById('course-title').textContent = targetName || 'Weekly Course';

  const uniqueCourses = [...new Set(allData.map(r => r.course_name_b).filter(Boolean))];
  const uniquePlayers = [...new Set(allData.map(r => r.player_name).filter(Boolean))];
  const skills        = [...new Set(allData.map(r => r.skill).filter(Boolean))];

  document.getElementById('course-meta').innerHTML = `
    <div class="meta-pill">Players: <span>${uniquePlayers.length}</span></div>
    <div class="meta-pill">Correlated Courses: <span>${uniqueCourses.length}</span></div>
    <div class="meta-pill">Skills: <span>${skills.length}</span></div>
  `;

  buildGlobalSkillTabs(skills);

  const playerMap = {};
  allData.forEach(row => {
    if (!row.dg_id) return;
    if (!playerMap[row.dg_id]) {
      playerMap[row.dg_id] = { dg_id: row.dg_id, name: row.player_name, salary: row.salary || 0, courses: {} };
    }
    const skill = row.skill;
    if (!playerMap[row.dg_id].courses[skill]) playerMap[row.dg_id].courses[skill] = [];
    playerMap[row.dg_id].courses[skill].push({
      course           : row.course_name_b || 'Unknown',
      contribution     : parseFloat(row.contribution)     || 0,
      effective_events : parseFloat(row.effective_events) || 0,
      last_played      : row.last_played || null
    });
  });

  const projRankMap = {};
  Object.entries(projData)
    .filter(([, v]) => v.adjusted_sg_total != null)
    .sort(([, a], [, b]) => b.adjusted_sg_total - a.adjusted_sg_total)
    .forEach(([dg_id], i) => { projRankMap[dg_id] = i + 1; });

  players = Object.values(playerMap).map(p => {
    const proj   = projData[p.dg_id]   || null;
    const leadin = leadinData[p.dg_id] || null;
    return {
      ...p,
      salary              : proj?.salary              ?? p.salary,
      adjusted_sg_total   : proj?.adjusted_sg_total   ?? null,
      adjusted_course_fit : proj?.adjusted_course_fit ?? null,
      proj_rank           : projRankMap[p.dg_id]      ?? null,
      lead_in_z           : leadin?.lead_in_z         ?? null,
      top_course          : leadin?.top_course        ?? null
    };
  });

  renderGrid();
  buildBreakdown();
}

function buildGlobalSkillTabs(skills) {
  const container = document.getElementById('global-skill-tabs');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'skill-tab active';
  allBtn.textContent = 'All';
  allBtn.onclick = () => {
    activeSkill = null;
    document.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    renderGrid();
  };
  container.appendChild(allBtn);

  const order   = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const ordered = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];
  ordered.forEach(skill => {
    const btn = document.createElement('button');
    btn.className = 'skill-tab';
    btn.textContent = SKILL_LABELS[skill] || skill;
    btn.onclick = () => {
      activeSkill = skill;
      document.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid();
    };
    container.appendChild(btn);
  });
}

// ── RENDER GRID ─────────────────────────────────────────────────────────────────────────────
function renderGrid() {
  document.getElementById('empty-state').style.display = 'none';

  const getValue = p => {
    if (sortBy === 'sg_total')   return p.adjusted_sg_total   ?? -Infinity;
    if (sortBy === 'course_fit') return p.adjusted_course_fit ?? -Infinity;
    if (sortBy === 'lead_in')    return p.lead_in_z           ?? -Infinity;
    return p.salary ?? 0;
  };

  const filtered = searchQuery
    ? players.filter(p => p.name.toLowerCase().includes(searchQuery))
    : players;

  const sorted = [...filtered].sort((a, b) =>
    sortDir === 'desc' ? getValue(b) - getValue(a) : getValue(a) - getValue(b)
  );

  const sortLabel = { salary: 'DraftKings salary', sg_total: 'SG Total', course_fit: 'Course Fit', lead_in: 'Lead-In' };
  document.getElementById('player-count').textContent =
    `${sorted.length} player${sorted.length !== 1 ? 's' : ''} · sorted by ${sortLabel[sortBy]}`;

  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';

  if (viewMode === 'table') {
    grid.appendChild(buildPlayerTable(sorted));
    setTimeout(reportHeight, 200);
    return;
  }

  sorted.forEach((player, idx) => grid.appendChild(buildPlayerCard(player, idx)));
  setTimeout(reportHeight, 400);
}

// ── PLAYER TABLE ────────────────────────────────────────────────────────────────────────────
const SKILL_ORDER = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
const SKILL_SHORT = { sg_ott:'OTT', sg_app:'APP', sg_arg:'ARG', sg_putt:'PUTT', sg_total:'OTR' };

function buildPlayerTable(sorted) {
  const allSkills = [...new Set(sorted.flatMap(p => Object.keys(p.courses)))];
  const displaySkills = activeSkill
    ? (allSkills.includes(activeSkill) ? [activeSkill] : [])
    : [...SKILL_ORDER.filter(s => allSkills.includes(s)), ...allSkills.filter(s => !SKILL_ORDER.includes(s))];

  const skillSubHeaders  = displaySkills.map(s => `<th class="pt-skill pt-skill-sub">${SKILL_SHORT[s] || s}</th>`).join('');
  const skillGroupHeader = displaySkills.length
    ? `<th class="pt-skill-group" colspan="${displaySkills.length}">Course Fit Components</th>`
    : '';

  const rows = sorted.map(player => {
    const salaryStr = player.salary ? '$' + Number(player.salary).toLocaleString() : '—';
    const rankStr   = player.proj_rank != null ? `#${player.proj_rank}` : '—';
    const sgVal     = player.adjusted_sg_total;
    const fitVal    = player.adjusted_course_fit;
    const liVal     = player.lead_in_z;
    const sgStr     = sgVal  != null ? (sgVal  >= 0 ? '+' : '') + sgVal.toFixed(2)  : '—';
    const fitStr    = fitVal != null ? (fitVal >= 0 ? '+' : '') + fitVal.toFixed(3) : '—';
    const liScore   = liVal  != null ? Math.round(liVal * 100) : null;
    const liStr     = liScore != null ? String(liScore) : '—';
    const sgColor   = sgVal  != null ? valueColor(sgVal,  2.0) : 'var(--muted)';
    const fitColor  = fitVal != null ? valueColor(fitVal, 0.3) : 'var(--muted)';
    const liColor   = liVal  != null ? valueColor(liVal,  2.0) : 'var(--muted)';
    const liBg      = liVal  != null ? liColor.replace('rgb(','rgba(').replace(')',',0.12)') : 'rgba(128,128,128,0.08)';

    const skillCells = displaySkills.map(skill => {
      const pts = player.courses[skill];
      if (!pts || !pts.length) return `<td class="pt-skill pt-na">—</td>`;
      const total = pts.reduce((a, b) => a + (b.contribution || 0), 0);
      const color = valueColor(total, 0.5);
      const sign  = total >= 0 ? '+' : '';
      return `<td class="pt-skill" style="color:${color}">${sign}${total.toFixed(3)}</td>`;
    }).join('');

    return `<tr class="pt-row">
      <td class="pt-name">${player.name}</td>
      <td class="pt-salary">${salaryStr}</td>
      <td class="pt-rank">${rankStr}</td>
      <td class="pt-sg" style="color:${sgColor}">${sgStr}</td>
      <td class="pt-fit" style="color:${fitColor}">${fitStr}</td>
      <td class="pt-leadin"><span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${liBg};color:${liColor};font-weight:700;">${liStr}</span></td>
      ${skillCells}
    </tr>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.className = 'player-table-wrap';
  wrap.innerHTML = `
    <table class="player-table">
      <thead>
        <tr>
          <th class="pt-name" rowspan="2">Player</th>
          <th class="pt-salary" rowspan="2">Salary</th>
          <th class="pt-rank" rowspan="2">Rank</th>
          <th class="pt-sg" rowspan="2">SG Tot</th>
          <th class="pt-fit" rowspan="2">Course Fit</th>
          <th class="pt-leadin" rowspan="2">Lead-In</th>
          ${skillGroupHeader}
        </tr>
        <tr>${skillSubHeaders}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  return wrap;
}

// ── PLAYER CARD ────────────────────────────────────────────────────────────────────────────
function buildPlayerCard(player, idx) {
  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.animationDelay = `${Math.min(idx * 30, 400)}ms`;

  const skills        = Object.keys(player.courses);
  const order         = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const orderedSkills = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];
  const displaySkills = activeSkill
    ? (orderedSkills.includes(activeSkill) ? [activeSkill] : [])
    : orderedSkills;

  const salaryStr = player.salary ? '$' + Number(player.salary).toLocaleString() : '—';

  const skillSummaryHTML = displaySkills.map(skill => {
    const pts = player.courses[skill];
    if (!pts || !pts.length) return '';
    const total = pts.reduce((a, b) => a + (b.contribution || 0), 0);
    const color = valueColor(total, 0.5);
    const sign  = total >= 0 ? '+' : '';
    const t     = Math.max(-1, Math.min(1, total / 0.5));
    const pct   = Math.abs(t) * 50;
    const barLeft = total >= 0 ? '50%' : `${50 - pct}%`;
    const n = pts.length;
    return `
      <div class="skill-summary-row">
        <span class="skill-summary-name">${SKILL_LABELS[skill] || skill}</span>
        <div class="skill-bar-wrap">
          <div class="skill-bar" style="width:${pct}%;left:${barLeft};background:${color};"></div>
        </div>
        <span class="skill-summary-val" style="color:${color}">${sign}${total.toFixed(3)}</span>
      </div>
      <div class="skill-course-count">${n <= 2 ? '<span class="limited-data-warn" title="Limited data">⚠</span> ' : ''}${n} course${n !== 1 ? 's' : ''}</div>`;
  }).join('');

  const tabs = displaySkills.length > 1
    ? `<div class="card-skill-tabs">${
        displaySkills.map((skill, i) =>
          `<button class="card-skill-btn${i === 0 ? ' active' : ''}" data-skill="${skill}" onclick="switchCardSkill(this)">${SKILL_SHORT[skill] || skill.replace('sg_','').toUpperCase()}</button>`
        ).join('')
      }</div>`
    : '';

  const tbodies = displaySkills.map((skill, i) => {
    const pts    = player.courses[skill] || [];
    const sorted = [...pts].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const maxC   = sorted.length ? Math.abs(sorted[0].contribution) : 0;
    const rows   = sorted.map(d => {
      const contrib      = d.contribution;
      const barPct       = maxC > 0 ? Math.abs(contrib) / maxC * 100 : 0;
      const barRgba      = contrib >= 0 ? 'rgba(34,197,94,0.18)' : 'rgba(220,38,38,0.18)';
      const barBg        = `linear-gradient(to right,${barRgba} ${barPct.toFixed(1)}%,transparent ${barPct.toFixed(1)}%)`;
      const contribSign  = contrib >= 0 ? '+' : '';
      const contribColor = valueColor(contrib, 0.3);
      return `<tr>
        <td class="ct-course">${d.course}</td>
        <td class="ct-eff">${d.effective_events > 0 ? d.effective_events.toFixed(1) : '—'}</td>
        <td class="ct-last">${fmtLastPlayed(d.last_played)}</td>
        <td class="ct-contrib" style="background-image:${barBg}">
          <span style="color:${contribColor};position:relative;">${contribSign}${contrib.toFixed(3)}</span>
        </td>
      </tr>`;
    }).join('');
    return `<tbody class="card-skill-body" data-skill="${skill}"${i > 0 ? ' style="display:none"' : ''}>
      ${rows || '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:12px;">No data</td></tr>'}
    </tbody>`;
  }).join('');

  const bodyContent = `
    ${tabs}
    <div class="course-table-wrap">
      <table class="course-table">
        <thead><tr>
          <th class="ct-course">Course</th>
          <th class="ct-eff">Eff Ev</th>
          <th class="ct-last">Last</th>
          <th class="ct-contrib">Contribution</th>
        </tr></thead>
        ${tbodies}
      </table>
    </div>`;

  const fitVal    = player.adjusted_course_fit ?? null;
  const sgVal     = player.adjusted_sg_total   ?? null;
  const liVal     = player.lead_in_z           ?? null;
  const rankStr   = player.proj_rank != null ? `#${player.proj_rank}` : '—';
  const sgStr     = sgVal  != null ? (sgVal  >= 0 ? '+' : '') + sgVal.toFixed(2)  : '—';
  const fitStr    = fitVal != null ? (fitVal >= 0 ? '+' : '') + fitVal.toFixed(2) : '—';
  const liScore   = liVal  != null ? Math.round(liVal * 100) : null;
  const liStr     = liScore != null ? String(liScore) : '—';
  const sgColor   = sgVal  != null ? valueColor(sgVal,  2.0) : 'var(--muted)';
  const fitColor  = fitVal != null ? valueColor(fitVal, 0.3) : 'var(--muted)';
  const liColor   = liVal  != null ? valueColor(liVal,  2.0) : 'var(--muted)';
  const liBg      = liVal  != null ? liColor.replace('rgb(','rgba(').replace(')',',0.12)') : 'rgba(128,128,128,0.08)';

  card.innerHTML = `
    <div class="card-header">
      <div class="player-name">${player.name}</div>
      <div class="dk-salary">${salaryStr}</div>
      <div class="proj-stats">
        <span class="proj-stat"><span class="proj-label">Rank</span><span class="proj-val">${rankStr}</span></span>
        <span class="proj-stat"><span class="proj-label">SG Total</span><span class="proj-val" style="color:${sgColor}">${sgStr}</span></span>
        <span class="proj-stat"><span class="proj-label">Course Fit</span><span class="proj-val" style="color:${fitColor}">${fitStr}</span></span>
        <span class="proj-stat"><span class="proj-label">Lead-In</span><span class="proj-val" style="display:inline-block;padding:2px 9px;border-radius:999px;background:${liBg};color:${liColor};font-weight:700;">${liStr}</span></span>
      </div>
      <div class="skill-summary">${skillSummaryHTML}</div>
    </div>
    <div class="card-body">${bodyContent}</div>
  `;

  return card;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────────────────
function fmtLastPlayed(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function valueColor(val, bound) {
  const t = Math.max(-1, Math.min(1, val / (bound || 1)));
  function lerp(a, b, x) { return Math.round(a + (b - a) * x); }
  let r, g, b;
  if (t < 0) { const x = t + 1; r = lerp(220,160,x); g = lerp(38,160,x); b = lerp(38,160,x); }
  else        { const x = t;     r = lerp(160,34,x);  g = lerp(160,197,x); b = lerp(160,94,x); }
  return `rgb(${r},${g},${b})`;
}

// ── SORT / SEARCH / VIEW CONTROLS ─────────────────────────────────────────────────────────
document.getElementById('sort-by-group').addEventListener('click', e => {
  const btn = e.target.closest('.sort-btn');
  if (!btn) return;
  sortBy = btn.dataset.val;
  document.querySelectorAll('#sort-by-group .sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (players.length) renderGrid();
});

document.getElementById('sort-dir-btn').addEventListener('click', () => {
  sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  document.getElementById('sort-dir-btn').textContent = sortDir === 'desc' ? '↓' : '↑';
  if (players.length) renderGrid();
});

function switchCardSkill(btn) {
  const card  = btn.closest('.player-card');
  const skill = btn.dataset.skill;
  card.querySelectorAll('.card-skill-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  card.querySelectorAll('.card-skill-body').forEach(b => {
    b.style.display = b.dataset.skill === skill ? '' : 'none';
  });
}

function onSearchInput(val) {
  searchQuery = val.trim().toLowerCase();
  if (players.length) renderGrid();
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('view-btn-card').classList.toggle('active', mode === 'card');
  document.getElementById('view-btn-table').classList.toggle('active', mode === 'table');
  if (players.length) renderGrid();
}

// ── COURSE BREAKDOWN ──────────────────────────────────────────────────────────────────────────
let breakdownSkill  = null;
let breakdownSort   = 'contribution';
let breakdownShowAll = false;

document.getElementById('breakdown-sort').addEventListener('change', e => {
  breakdownSort = e.target.value;
  renderBreakdown(breakdownRows);
});

function buildBreakdown() {
  if (!allData.length) return;

  const keyMap = {};
  allData.forEach(row => {
    const course = row.course_name_b;
    const skill  = row.skill;
    if (!course || !skill) return;
    const key = `${course}||${skill}`;
    if (!keyMap[key]) keyMap[key] = { course, skill, last_played: null, eff_vals: [], contrib_vals: [] };
    const ev = parseFloat(row.effective_events);
    const c  = parseFloat(row.contribution);
    const lp = row.last_played || null;
    if (isFinite(ev)) keyMap[key].eff_vals.push(ev);
    if (isFinite(c))  keyMap[key].contrib_vals.push(c);
    if (lp && (!keyMap[key].last_played || lp > keyMap[key].last_played)) keyMap[key].last_played = lp;
  });

  breakdownRows = Object.values(keyMap).map(d => ({
    course           : d.course,
    skill            : d.skill,
    last_played      : d.last_played,
    effective_events : d.eff_vals.reduce((a,b) => a + Math.abs(b), 0),
    contribution     : d.contrib_vals.reduce((a,b) => a + Math.abs(b), 0)
  }));

  const skills  = [...new Set(breakdownRows.map(r => r.skill))];
  const order   = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const ordered = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];
  const tabsEl  = document.getElementById('breakdown-skill-tabs');

  if (!tabsEl.childElementCount) {
    const allBtn = document.createElement('button');
    allBtn.className = 'skill-tab active';
    allBtn.textContent = 'All';
    allBtn.onclick = () => {
      breakdownSkill = null;
      tabsEl.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      renderBreakdown(breakdownRows);
    };
    tabsEl.appendChild(allBtn);
    ordered.forEach(skill => {
      const btn = document.createElement('button');
      btn.className = 'skill-tab';
      btn.textContent = SKILL_LABELS[skill] || skill;
      btn.onclick = () => {
        breakdownSkill = skill;
        tabsEl.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBreakdown(breakdownRows);
      };
      tabsEl.appendChild(btn);
    });
  }

  renderBreakdownRows(breakdownRows);
}

const BREAKDOWN_PAGE_SIZE = 15;

function renderBreakdown(rows) {
  breakdownShowAll = false;
  renderBreakdownRows(rows);
}

function renderBreakdownRows(rows) {
  const filtered = breakdownSkill ? rows.filter(r => r.skill === breakdownSkill) : rows;

  const sorted = [...filtered].sort((a, b) => {
    if (breakdownSort === 'last_played')      return (b.last_played || '') > (a.last_played || '') ? 1 : -1;
    if (breakdownSort === 'effective_events') return (b.effective_events ?? 0) - (a.effective_events ?? 0);
    if (breakdownSort === 'contribution')     return (b.contribution ?? 0) - (a.contribution ?? 0);
    return 0;
  });

  const remaining = sorted.length - BREAKDOWN_PAGE_SIZE;
  const visible   = breakdownShowAll ? sorted : sorted.slice(0, BREAKDOWN_PAGE_SIZE);

  document.getElementById('breakdown-tbody').innerHTML = visible.map(d => {
    const skillBadgeColor = SKILL_COLORS[d.skill] || 'rgba(100,100,100,0.2)';
    const contrib         = d.contribution ?? 0;
    const maxContrib      = sorted.length ? (sorted[0].contribution ?? 0) : 1;
    const barPct          = maxContrib > 0 ? Math.min(100, (contrib / maxContrib) * 100) : 0;
    const barBg           = `linear-gradient(to right,rgba(234,179,8,0.35) ${barPct.toFixed(1)}%,transparent ${barPct.toFixed(1)}%)`;
    return `<tr>
      <td class="bd-course">${d.course}</td>
      <td class="bd-skill">
        <span class="skill-badge" style="border-color:${skillBadgeColor};color:${skillBadgeColor.replace(/,[^,)]+\)$/,',1)')}">
          ${SKILL_LABELS[d.skill] || d.skill}
        </span>
      </td>
      <td class="bd-events">${d.effective_events != null ? d.effective_events.toFixed(1) : '—'}</td>
      <td class="bd-last">${fmtLastPlayed(d.last_played)}</td>
      <td class="bd-cor" style="background-image:${barBg};font-variant-numeric:tabular-nums;">${contrib.toFixed(3)}</td>
    </tr>`;
  }).join('');

  const existingBtn = document.getElementById('bd-show-more');
  if (existingBtn) existingBtn.remove();

  if (!breakdownShowAll && remaining > 0) {
    const btn = document.createElement('button');
    btn.id        = 'bd-show-more';
    btn.className = 'bd-show-more-btn';
    btn.textContent = `Show ${remaining} more`;
    btn.onclick = () => { breakdownShowAll = true; renderBreakdownRows(rows); };
    document.getElementById('breakdown-table').after(btn);
  }
}

// ── IFRAME HEIGHT REPORTING ────────────────────────────────────────────────────────────────────
function reportHeight() {
  window.parent.postMessage({ type: 'plus4-resize', height: document.documentElement.scrollHeight }, '*');
}
