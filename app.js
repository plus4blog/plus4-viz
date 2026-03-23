// ── STATE ─────────────────────────────────────────────────────────────────────
let allData      = [];    // raw parsed rows
let players      = [];    // [{name, salary, courses: {skill -> [{course, value, r}]}}]
let activeSkill  = null;  // skill shown in global filter (null = all)
let sortDir      = 'desc';
let chartInstances = {};  // canvasId -> Chart instance

const SKILL_LABELS = {
  sg_ott  : 'Off the Tee',
  sg_app  : 'Approach',
  sg_arg  : 'Around Green',
  sg_putt : 'Putting',
  sg_total: 'Total'
};

const SKILL_COLORS = {
  sg_ott  : 'rgba(204,31,31,0.85)',
  sg_app  : 'rgba(240,180,41,0.7)',
  sg_arg  : 'rgba(34,197,94,0.7)',
  sg_putt : 'rgba(168,85,247,0.7)',
  sg_total: 'rgba(249,115,22,0.7)'
};

// ── CSV LOADING ───────────────────────────────────────────────────────────────
const CSV_URL = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/course_skill_lookup.csv';

function loadCSV() {
  const status = document.getElementById('load-status');
  status.textContent = 'Loading data...';

  Papa.parse(CSV_URL, {
    download: true,
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    complete: result => {
      allData = result.data;
      processData();
      status.textContent = `Updated ${new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}`;
    },
    error: err => {
      status.textContent = 'Failed to load data';
      console.error('CSV fetch error:', err);
    }
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

  players = Object.values(playerMap);
  renderGrid();
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

  const order = ['sg_total','sg_ott','sg_app','sg_arg','sg_putt'];
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

// ── RENDER GRID ───────────────────────────────────────────────────────────────
function renderGrid() {
  document.getElementById('empty-state').style.display = 'none';

  const sorted = [...players].sort((a, b) =>
    sortDir === 'desc' ? b.salary - a.salary : a.salary - b.salary
  );

  document.getElementById('player-count').textContent =
    `${sorted.length} players · sorted by DraftKings salary`;

  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';

  sorted.forEach((player, idx) => {
    const card = buildPlayerCard(player, idx);
    grid.appendChild(card);
  });

  setTimeout(reportHeight, 600);
}

// ── PLAYER CARD ───────────────────────────────────────────────────────────────
function buildPlayerCard(player, idx) {
  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.animationDelay = `${Math.min(idx * 30, 400)}ms`;

  const skills = Object.keys(player.courses);
  const order  = ['sg_total','sg_ott','sg_app','sg_arg','sg_putt'];
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
      <div class="skill-course-count">${courseCount} course${courseCount !== 1 ? 's' : ''}</div>`;
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
        <td class="ct-r">${d.r >= 0 ? '+' : ''}${d.r.toFixed(2)}</td>
        <td class="ct-p">${d.p !== undefined ? d.p.toFixed(3) : '—'}</td>
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
                <th>Avg</th>
                <th>r</th>
                <th>p</th>
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

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="player-name">${player.name}</div>
        <div class="dk-salary">${salaryStr}</div>
      </div>
      <div class="skill-summary">${skillSummaryHTML}</div>
    </div>
    <div class="card-body">
      <div class="card-skill-tabs"></div>
      ${bodyContent}
    </div>
  `;

  setTimeout(() => {
    if (isSingleSkill) {
      drawRadar(`${idx}-0`, player, displaySkills[0]);
    } else {
      displaySkills.forEach((skill, si) => {
        drawRadar(`${idx}-${si}`, player, skill);
      });
    }
  }, 0);

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
  const display  = sorted.slice(0, MAX_AXES);

  const labels = display.map(d => truncate(d.course, 18));
  const values = display.map(d => d.value);

  const bound  = skill === 'sg_total' ? 1.5 : 1.0;
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
          titleFont: { family: 'DM Mono', size: 11 },
          bodyFont:  { family: 'DM Mono', size: 11 },
          callbacks: {
            title: items => display[items[0].dataIndex]?.course || '',
            label: item  => {
              const d = display[item.dataIndex];
              const sign = d.value >= 0 ? '+' : '';
              return `${sign}${d.value.toFixed(3)}  (r=${d.r.toFixed(2)})`;
            }
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
            font: { family: 'DM Sans', size: 9 },
            color: '#999999',
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

// ── SORT CONTROL ──────────────────────────────────────────────────────────────
document.getElementById('sort-dir').addEventListener('change', e => {
  sortDir = e.target.value;
  if (players.length) renderGrid();
});

// ── IFRAME HEIGHT REPORTING ───────────────────────────────────────────────────
function reportHeight() {
  const h = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: 'plus4-resize', height: h }, '*');
}
