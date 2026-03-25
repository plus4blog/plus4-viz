// ── STATE ─────────────────────────────────────────────────────────────────────
let allData      = [];    // raw parsed rows
let projData     = {};    // player_name -> {course_fit_score, projected_sg_total}
let players      = [];    // [{name, salary, courses, proj_rank, projected_sg_total, course_fit_score}]
let activeSkill  = null;  // skill shown in global filter (null = all)
let sortBy       = 'salary';
let sortDir      = 'desc';
let chartInstances = {};  // canvasId -> Chart instance
let searchQuery  = '';    // player name filter
let viewMode     = 'card'; // 'card' | 'table'

const SKILL_LABELS = {
  sg_ott  : 'Off the Tee',
  sg_app  : 'Approach',
  sg_arg  : 'Around Green',
  sg_putt : 'Putting',
  sg_total: 'Other Tours'
};

const SKILL_BOUNDS = {
  sg_ott  : 2.0,
  sg_app  : 1.5,
  sg_arg  : 1.5,
  sg_putt : 2.0,
  sg_total: 2.5
};

const SKILL_COLORS = {
  sg_ott  : 'rgba(204,31,31,0.85)',
  sg_app  : 'rgba(240,180,41,0.7)',
  sg_arg  : 'rgba(34,197,94,0.7)',
  sg_putt : 'rgba(168,85,247,0.7)',
  sg_total: 'rgba(249,115,22,0.7)'
};

// ── CSV LOADING ───────────────────────────────────────────────────────────────
const CSV_URL  = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/data/course_skill_lookup.csv';
const PROJ_URL = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/data/player_projections.csv';

function loadCSV() {
  const status = document.getElementById('load-status');
  status.textContent = 'Loading data...';

  let coursesDone = false, projDone = false;

  function tryProcess() {
    if (!coursesDone || !projDone) return;
    processData();
    status.textContent = `Updated ${new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}`;
  }

  Papa.parse(CSV_URL, {
    download: true, header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: result => { allData = result.data; coursesDone = true; tryProcess(); },
    error: err => { status.textContent = 'Failed to load data'; console.error(err); }
  });

  Papa.parse(PROJ_URL, {
    download: true, header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: result => {
      projData = {};
      result.data.forEach(row => {
        if (row.player_name) projData[row.player_name] = {
          course_fit_score  : row.course_fit_score != null ? parseFloat(row.course_fit_score) : null,
          projected_sg_total: row.projected_sg_total != null ? parseFloat(row.projected_sg_total) : null
        };
      });
      projDone = true;
      tryProcess();
    },
    error: err => { projDone = true; tryProcess(); console.error('Projections fetch error:', err); }
  });
}

loadCSV();

function processData() {
  if (!allData.length) return;

  document.getElementById('course-title').textContent =
    allData[0]?.anchor_course_name || 'Weekly Course';

  // Meta pills
  const uniqueCourses = [...new Set(allData.map(r => r.course_num_b).filter(Boolean))];
  const uniquePlayers = [...new Set(allData.map(r => r.player_name).filter(Boolean))];
  const skills        = [...new Set(allData.map(r => r.skill).filter(Boolean))];

  document.getElementById('course-meta').innerHTML = `
    <div class="meta-pill">Players: <span>${uniquePlayers.length}</span></div>
    <div class="meta-pill">Correlated Courses: <span>${uniqueCourses.length}</span></div>
    <div class="meta-pill">Skills: <span>${skills.length}</span></div>
  `;

  buildGlobalSkillTabs(skills);

  // Group by player
  const playerMap = {};
  allData.forEach(row => {
    if (!row.player_name) return;
    if (!playerMap[row.player_name]) {
      playerMap[row.player_name] = {
        name  : row.player_name,
        salary: row.dk_price || row.dk_salary || row.draftkings_salary || row.salary || 0,
        courses: {}
      };
    }
    const skill = row.skill;
    if (!playerMap[row.player_name].courses[skill]) {
      playerMap[row.player_name].courses[skill] = [];
    }
    const r = parseFloat(row.blended_r) || 0;
    if (Math.abs(r) <= 0.05) return;
    playerMap[row.player_name].courses[skill].push({
      course      : row.course_name_b || row.course_num_b || 'Unknown',
      value       : parseFloat(row.avg_value) || 0,
      r,
      p           : parseFloat(row.p_value) || 0,
      event_count : parseInt(row.event_count) || 0
    });
  });

  // Merge projection data and compute ranks by projected_sg_total
  const projRankMap = {};
  Object.entries(projData)
    .filter(([, v]) => v.projected_sg_total != null)
    .sort(([, a], [, b]) => b.projected_sg_total - a.projected_sg_total)
    .forEach(([name], i) => { projRankMap[name] = i + 1; });

  players = Object.values(playerMap).map(p => {
    const proj = projData[p.name] || null;
    const hasFit = proj && proj.course_fit_score != null && proj.course_fit_score !== 0;
    return {
      ...p,
      projected_sg_total: proj?.projected_sg_total ?? null,
      course_fit_score  : proj?.course_fit_score ?? null,
      proj_rank         : projRankMap[p.name] ?? null,
      hasFit
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

  const order = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
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

// ── INTERSECTION OBSERVER (lazy chart rendering) ──────────────────────────────
let cardObserver = null;

function setupCardObserver() {
  if (cardObserver) cardObserver.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const card = entry.target;
      const pending = card._pendingCharts;
      if (!pending) return;
      delete card._pendingCharts;
      cardObserver.unobserve(card);
      pending.forEach(({ id, player, skill }) => drawRadar(id, player, skill));
    });
  }, { rootMargin: '200px' });
}

// ── RENDER GRID ───────────────────────────────────────────────────────────────
function renderGrid() {
  document.getElementById('empty-state').style.display = 'none';

  const getValue = p => {
    if (sortBy === 'sg_total')    return p.projected_sg_total ?? -Infinity;
    if (sortBy === 'course_fit')  return p.course_fit_score   ?? -Infinity;
    return p.salary ?? 0;
  };

  const filtered = searchQuery
    ? players.filter(p => p.name.toLowerCase().includes(searchQuery))
    : players;

  const sorted = [...filtered].sort((a, b) =>
    sortDir === 'desc' ? getValue(b) - getValue(a) : getValue(a) - getValue(b)
  );

  const sortLabel = { salary: 'DraftKings salary', sg_total: 'projected SG Total', course_fit: 'Course Fit score' };
  document.getElementById('player-count').textContent =
    `${sorted.length} player${sorted.length !== 1 ? 's' : ''} · sorted by ${sortLabel[sortBy]}`;

  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';

  if (viewMode === 'table') {
    grid.appendChild(buildPlayerTable(sorted));
    setTimeout(reportHeight, 200);
    return;
  }

  setupCardObserver();

  sorted.forEach((player, idx) => {
    const card = buildPlayerCard(player, idx);
    grid.appendChild(card);
    cardObserver.observe(card);
  });

  setTimeout(reportHeight, 600);
}

// ── PLAYER TABLE (lightweight view) ──────────────────────────────────────────
const SKILL_ORDER = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
const SKILL_SHORT = { sg_ott:'OTT', sg_app:'APP', sg_arg:'ARG', sg_putt:'PUTT', sg_total:'OTR' };

function buildPlayerTable(sorted) {
  const allSkills = [...new Set(sorted.flatMap(p => Object.keys(p.courses)))];
  const displaySkills = activeSkill
    ? (allSkills.includes(activeSkill) ? [activeSkill] : [])
    : [...SKILL_ORDER.filter(s => allSkills.includes(s)), ...allSkills.filter(s => !SKILL_ORDER.includes(s))];

  const skillHeaders = displaySkills.map(s =>
    `<th class="pt-skill">${SKILL_SHORT[s] || s}</th>`).join('');

  const rows = sorted.map(player => {
    const salaryStr = player.salary ? '$' + Number(player.salary).toLocaleString() : '—';
    const rankStr   = player.proj_rank != null ? `#${player.proj_rank}` : '—';
    const sgVal     = player.projected_sg_total;
    const fitVal    = player.course_fit_score;
    const sgStr     = sgVal  != null ? (sgVal  >= 0 ? '+' : '') + sgVal.toFixed(2)  : '—';
    const fitStr    = fitVal != null ? (fitVal >= 0 ? '+' : '') + fitVal.toFixed(3) : '—';
    const sgColor   = sgVal  != null ? valueColor(sgVal,  2.0) : 'var(--muted)';
    const fitColor  = fitVal != null ? valueColor(fitVal, 0.3) : 'var(--muted)';

    const skillCells = displaySkills.map(skill => {
      const pts = player.courses[skill];
      if (!pts || !pts.length) return `<td class="pt-skill pt-na">—</td>`;
      const avg   = pts.reduce((a, b) => a + b.value, 0) / pts.length;
      const color = valueColor(avg, 1.5);
      const sign  = avg >= 0 ? '+' : '';
      return `<td class="pt-skill" style="color:${color}">${sign}${avg.toFixed(2)}</td>`;
    }).join('');

    return `<tr class="pt-row">
      <td class="pt-name">${player.name}</td>
      <td class="pt-salary">${salaryStr}</td>
      <td class="pt-rank">${rankStr}</td>
      <td class="pt-sg" style="color:${sgColor}">${sgStr}</td>
      <td class="pt-fit" style="color:${fitColor}">${fitStr}</td>
      ${skillCells}
    </tr>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.className = 'player-table-wrap';
  wrap.innerHTML = `
    <table class="player-table">
      <thead>
        <tr>
          <th class="pt-name">Player</th>
          <th class="pt-salary">Salary</th>
          <th class="pt-rank">Rank</th>
          <th class="pt-sg">SG Tot</th>
          <th class="pt-fit">Fit Score</th>
          ${skillHeaders}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  return wrap;
}

// ── PLAYER CARD ───────────────────────────────────────────────────────────────
function buildPlayerCard(player, idx) {
  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.animationDelay = `${Math.min(idx * 30, 400)}ms`;

  const skills = Object.keys(player.courses);
  const order  = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const orderedSkills = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];

  const displaySkills = activeSkill
    ? (orderedSkills.includes(activeSkill) ? [activeSkill] : [])
    : orderedSkills;

  const salaryStr = player.salary
    ? '$' + Number(player.salary).toLocaleString()
    : '—';

  const skillSummaryHTML = displaySkills.map(skill => {
    const pts = player.courses[skill];
    if (!pts || !pts.length) return '';
    const avg = pts.reduce((a,b) => a + b.value, 0) / pts.length;
    const color = valueColor(avg, 1.5);
    const sign  = avg >= 0 ? '+' : '';
    const t     = Math.max(-1, Math.min(1, avg / 1.5));
    const pct   = Math.abs(t) * 50;
    const barLeft = avg >= 0 ? '50%' : `${50 - pct}%`;
    const courseCount = pts.length;
    return `
      <div class="skill-summary-row">
        <span class="skill-summary-name">${SKILL_LABELS[skill] || skill}</span>
        <div class="skill-bar-wrap">
          <div class="skill-bar" style="width:${pct}%;left:${barLeft};background:${color};"></div>
        </div>
        <span class="skill-summary-val" style="color:${color}">${sign}${avg.toFixed(2)}</span>
      </div>
      <div class="skill-course-count">${courseCount <= 2 ? '<span class="limited-data-warn" title="Limited data">⚠</span> ' : ''}${courseCount} course${courseCount !== 1 ? 's' : ''}</div>`;
  }).join('');

  const isSingleSkill = displaySkills.length === 1;

  let bodyContent;
  if (isSingleSkill) {
    const skill  = displaySkills[0];
    const pts    = player.courses[skill] || [];
    const sorted = [...pts].sort((a, b) => b.event_count - a.event_count);
    const rows   = sorted.map(d => {
      const sign  = d.value >= 0 ? '+' : '';
      const color = valueColor(d.value, 1.5);
      return `<tr>
        <td class="ct-course">${d.course}</td>
        <td class="ct-val" style="color:${color}">${sign}${d.value.toFixed(3)}</td>
        <td class="ct-r">${d.event_count ?? '—'}</td>
      </tr>`;
    }).join('');

    bodyContent = `
      <div class="split-body">
        <div class="split-radar">
          <div class="radar-skill-label">${SKILL_LABELS[skill] || skill}</div>
          <div class="radar-single">
            <canvas id="radar-${idx}-0"></canvas>
            <div class="no-data" id="nodata-${idx}-0" style="display:none;">No data</div>
          </div>
        </div>
        <div class="split-table">
          <div class="course-table-wrap">
            <table class="course-table">
              <thead><tr>
                <th>Course</th>
                <th>Avg Over Exp</th>
                <th>Events</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  } else {
    const radarSlotsHTML = displaySkills.map((skill, si) => `
      <div class="radar-slot">
        <div class="radar-skill-label">${SKILL_LABELS[skill] || skill}</div>
        <div class="radar-single">
          <canvas id="radar-${idx}-${si}"></canvas>
          <div class="no-data" id="nodata-${idx}-${si}" style="display:none;">No data</div>
        </div>
      </div>`).join('');
    bodyContent = `<div class="radar-wrap">${radarSlotsHTML}</div>`;
  }

  // Projection stats row
  const hasFit    = player.course_fit_score != null && player.course_fit_score !== 0;
  const fitVal    = hasFit ? player.course_fit_score : null;
  const sgVal     = (hasFit && player.projected_sg_total != null) ? player.projected_sg_total : null;
  const rankStr   = player.proj_rank  != null ? `#${player.proj_rank}` : '—';
  const sgStr     = sgVal  != null ? (sgVal  >= 0 ? '+' : '') + sgVal.toFixed(2)  : 'N/A';
  const fitStr    = fitVal != null ? (fitVal >= 0 ? '+' : '') + fitVal.toFixed(3) : '—';
  const sgColor   = sgVal  != null ? valueColor(sgVal,  2.0) : 'var(--muted)';
  const fitColor  = fitVal != null ? valueColor(fitVal, 0.3) : 'var(--muted)';

  const projStatsHTML = `
    <div class="proj-stats">
      <span class="proj-stat"><span class="proj-label">Rank</span><span class="proj-val">${rankStr}</span></span>
      <span class="proj-stat"><span class="proj-label">SG Total</span><span class="proj-val" style="color:${sgColor}">${sgStr}</span></span>
      <span class="proj-stat"><span class="proj-label">Course Fit</span><span class="proj-val" style="color:${fitColor}">${fitStr}</span></span>
    </div>`;

  card.innerHTML = `
    <div class="card-header">
      <div class="player-name">${player.name}</div>
      <div class="dk-salary">${salaryStr}</div>
      ${projStatsHTML}
      <div class="skill-summary">${skillSummaryHTML}</div>
    </div>
    <div class="card-body">
      <div class="card-skill-tabs"></div>
      ${bodyContent}
    </div>
  `;

  const pendingCharts = isSingleSkill
    ? [{ id: `${idx}-0`, player, skill: displaySkills[0] }]
    : displaySkills.map((skill, si) => ({ id: `${idx}-${si}`, player, skill }));

  card._pendingCharts = pendingCharts;

  return card;
}

// ── COLOR HELPER ──────────────────────────────────────────────────────────────
function valueColor(val, bound) {
  const t = Math.max(-1, Math.min(1, val / (bound || 1)));
  function lerp(a, b, x) { return Math.round(a + (b - a) * x); }
  let r, g, b;
  if (t < 0) { const x = t + 1; r = lerp(220,160,x); g = lerp(38,160,x); b = lerp(38,160,x); }
  else        { const x = t;     r = lerp(160,34,x);  g = lerp(160,197,x); b = lerp(160,94,x); }
  return `rgb(${r},${g},${b})`;
}

// ── RADAR CHART ───────────────────────────────────────────────────────────────
function drawRadar(canvasId, player, skill) {
  const noDataEl = document.getElementById(`nodata-${canvasId}`);
  const canvas   = document.getElementById(`radar-${canvasId}`);

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  const points = player.courses[skill];
  if (!points || !points.length) {
    canvas.style.display = 'none';
    noDataEl.style.display = 'flex';
    return;
  }

  canvas.style.display = 'block';
  noDataEl.style.display = 'none';

  const sorted  = [...points].sort((a, b) => b.event_count - a.event_count);
  const MAX_AXES = 15;
  const MIN_AXES = 3;
  const raw     = sorted.slice(0, MAX_AXES);

  // Pad to at least MIN_AXES spokes with empty placeholders
  const display = raw.length >= MIN_AXES
    ? raw
    : [...raw, ...Array(MIN_AXES - raw.length).fill({ course: '', value: 0, r: 0, event_count: 0 })];

  const labels = display.map(d => d.course ? wrapLabel(d.course, 14) : ['']);
  const values = display.map(d => d.value);

  const bound  = SKILL_BOUNDS[skill] ?? 1.5;
  const allVals = values.filter(v => isFinite(v));
  const avgVal  = allVals.reduce((a, b) => a + b, 0) / allVals.length;

  const colorSolid  = valueColor(avgVal, bound);
  const colorFill   = colorSolid.replace('rgb(', 'rgba(').replace(')', ',0.25)');
  const colorBorder = colorSolid.replace('rgb(', 'rgba(').replace(')', ',0.9)');

  const ctx = canvas.getContext('2d');

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          label: '_baseline',
          data: values.map(() => 0),
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          pointRadius: 0,
          fill: false
        },
        {
          label: SKILL_LABELS[skill] || skill,
          data: values,
          backgroundColor: colorFill,
          borderColor: colorBorder,
          pointBackgroundColor: display.map(d => valueColor(d.value, bound)),
          pointBorderColor: 'transparent',
          pointRadius: 4,
          borderWidth: 1.5,
          fill: '-1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          borderColor: '#e0e0e0',
          borderWidth: 1,
          titleColor: '#111111',
          bodyColor: '#555555',
          titleFont: { family: 'IBM Plex Sans', size: 11 },
          bodyFont:  { family: 'IBM Plex Sans', size: 11 },
          callbacks: {
            title: items => display[items[0].dataIndex]?.course || '',
            label: item  => {
              const d = display[item.dataIndex];
              if (!d.course) return '';
              const sign = d.value >= 0 ? '+' : '';
              return `${sign}${d.value.toFixed(3)}  (r=${d.r.toFixed(2)})`;
            },
            filter: item => !!display[item.dataIndex]?.course
          }
        }
      },
      scales: {
        r: {
          min: -bound,
          max:  bound,
          ticks: { display: false, stepSize: bound / 2 },
          grid: { color: 'rgba(200,200,200,0.8)' },
          angleLines: { color: 'rgba(200,200,200,0.6)' },
          pointLabels: {
            font: { family: 'Archivo Narrow', size: 11, lineHeight: 0.9 },
            color: ctx => ctx.label?.[0] === '' ? 'transparent' : '#999999',
            padding: 4
          }
        }
      }
    }
  });
}

function truncate(str, n) {
  return str && str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function wrapLabel(str, maxChars) {
  if (!str) return [''];
  str = str.toUpperCase();
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── SORT / SEARCH / VIEW CONTROLS ────────────────────────────────────────────
document.getElementById('sort-by').addEventListener('change', e => {
  sortBy = e.target.value;
  if (players.length) renderGrid();
});

document.getElementById('sort-dir').addEventListener('change', e => {
  sortDir = e.target.value;
  if (players.length) renderGrid();
});

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

// ── COURSE BREAKDOWN ──────────────────────────────────────────────────────────
let breakdownSkill = null;
let breakdownSort  = 'r';

function buildBreakdown() {
  if (!allData.length) return;

  // Aggregate by (course_name_b, skill)
  const keyMap = {};
  allData.forEach(row => {
    const course = row.course_name_b || row.course_num_b;
    const skill  = row.skill;
    if (!course || !skill) return;
    const key = `${course}||${skill}`;
    if (!keyMap[key]) {
      keyMap[key] = {
        course,
        skill,
        r_vals      : [],
        p_vals      : [],
        vintage_vals: [],
        event_sum   : 0
      };
    }
    const r = parseFloat(row.blended_r);
    const p = parseFloat(row.p_value);
    const v = parseFloat(row.vintage_count);
    const e = parseInt(row.event_count) || 0;
    if (isFinite(r)) keyMap[key].r_vals.push(r);
    if (isFinite(p)) keyMap[key].p_vals.push(p);
    if (isFinite(v)) keyMap[key].vintage_vals.push(v);
    keyMap[key].event_sum += e;
  });

  let rows = Object.values(keyMap).map(d => ({
    ...d,
    r_avg      : d.r_vals.length       ? d.r_vals.reduce((a,b)=>a+b,0)/d.r_vals.length             : 0,
    p_avg      : d.p_vals.length       ? d.p_vals.reduce((a,b)=>a+b,0)/d.p_vals.length             : null,
    vintage_avg: d.vintage_vals.length ? d.vintage_vals.reduce((a,b)=>a+b,0)/d.vintage_vals.length : null
  }));

  // Build skill tabs
  const skills = [...new Set(rows.map(r => r.skill))];
  const order  = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const ordered = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];
  const tabsEl = document.getElementById('breakdown-skill-tabs');
  if (!tabsEl.childElementCount) {
    const allBtn = document.createElement('button');
    allBtn.className = 'skill-tab active';
    allBtn.textContent = 'All';
    allBtn.onclick = () => {
      breakdownSkill = null;
      tabsEl.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      renderBreakdown(rows);
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
        renderBreakdown(rows);
      };
      tabsEl.appendChild(btn);
    });
  }

  document.getElementById('breakdown-sort').addEventListener('change', e => {
    breakdownSort = e.target.value;
    renderBreakdown(rows);
  });

  renderBreakdownRows(rows);
}

const BREAKDOWN_PAGE_SIZE = 15;
let breakdownShowAll = false;

function renderBreakdown(allRows) {
  breakdownShowAll = false;
  renderBreakdownRows(allRows);
}

function renderBreakdownRows(allRows) {
  const filtered = breakdownSkill
    ? allRows.filter(r => r.skill === breakdownSkill)
    : allRows;

  const sorted = [...filtered].sort((a, b) => {
    if (breakdownSort === 'r')       return Math.abs(b.r_avg) - Math.abs(a.r_avg);
    if (breakdownSort === 'vintage') return (b.vintage_avg ?? 0) - (a.vintage_avg ?? 0);
    return 0;
  });

  const visible = breakdownShowAll ? sorted : sorted.slice(0, BREAKDOWN_PAGE_SIZE);
  const remaining = sorted.length - BREAKDOWN_PAGE_SIZE;

  const tbody = document.getElementById('breakdown-tbody');
  tbody.innerHTML = visible.map(d => {
    const r      = d.r_avg;
    const rSign  = r >= 0 ? '+' : '';
    const rColor = valueColor(r, 0.5);
    const rPct   = Math.min(Math.abs(r), 1) * 50;
    const barLeft = r >= 0 ? '50%' : `${50 - rPct}%`;
    const skillBadgeColor = SKILL_COLORS[d.skill] || 'rgba(100,100,100,0.2)';

    return `<tr>
      <td class="bd-course">${d.course}</td>
      <td class="bd-skill">
        <span class="skill-badge" style="border-color:${skillBadgeColor};color:${skillBadgeColor.replace(/,[^,)]+\)$/,',1)')}">
          ${SKILL_LABELS[d.skill] || d.skill}
        </span>
      </td>
      <td class="bd-r">
        <div class="r-bar-cell">
          <div class="r-bar-track">
            <div class="r-bar-fill" style="width:${rPct}%;left:${barLeft};background:${rColor};"></div>
          </div>
          <span style="color:${rColor}">${rSign}${r.toFixed(3)}</span>
        </div>
      </td>
      <td class="bd-vintage"><span class="bd-vintage-val">${d.vintage_avg !== null ? Math.round(d.vintage_avg) : '—'}</span></td>
      <td class="bd-events">${d.event_sum || '—'}</td>
    </tr>`;
  }).join('');

  const existingBtn = document.getElementById('bd-show-more');
  if (existingBtn) existingBtn.remove();

  if (!breakdownShowAll && remaining > 0) {
    const btn = document.createElement('button');
    btn.id = 'bd-show-more';
    btn.className = 'bd-show-more-btn';
    btn.textContent = `Show ${remaining} more`;
    btn.onclick = () => {
      breakdownShowAll = true;
      renderBreakdownRows(allRows);
    };
    document.getElementById('breakdown-table').after(btn);
  }
}

// ── IFRAME HEIGHT REPORTING ───────────────────────────────────────────────────
function reportHeight() {
  const h = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: 'plus4-resize', height: h }, '*');
}
