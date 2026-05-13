// ── CONSTANTS ─────────────────────────────────────────────────────────────────
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

function fmtLastPlayed(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── CSV LOADING ────────────────────────────────────────────────────────────────
const CSV_URL = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/data/pga_course_skill_lookup.csv';

Papa.parse(CSV_URL, {
  download: true,
  header: true,
  skipEmptyLines: true,
  dynamicTyping: true,
  complete: result => {
    buildBreakdown(result.data);
    document.getElementById('embed-status').textContent =
      `Updated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    reportHeight();
  },
  error: err => {
    document.getElementById('embed-status').textContent = 'Failed to load data';
    console.error('CSV fetch error:', err);
  }
});

// ── BREAKDOWN ─────────────────────────────────────────────────────────────────
let breakdownSkill   = null;
let breakdownSort    = 'contribution';
let breakdownShowAll = false;
let cachedRows       = [];

function buildBreakdown(allData) {
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

  cachedRows = Object.values(keyMap).map(d => ({
    course           : d.course,
    skill            : d.skill,
    last_played      : d.last_played,
    effective_events : d.eff_vals.reduce((a, b) => a + Math.abs(b), 0),
    contribution     : d.contrib_vals.reduce((a, b) => a + Math.abs(b), 0)
  }));

  // Skill filter tabs
  const skills  = [...new Set(cachedRows.map(r => r.skill))];
  const order   = ['sg_ott','sg_app','sg_arg','sg_putt','sg_total'];
  const ordered = [...order.filter(s => skills.includes(s)), ...skills.filter(s => !order.includes(s))];
  const tabsEl  = document.getElementById('breakdown-skill-tabs');

  const allBtn = document.createElement('button');
  allBtn.className = 'skill-tab active';
  allBtn.textContent = 'All';
  allBtn.onclick = () => {
    breakdownSkill = null;
    tabsEl.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    renderBreakdown(cachedRows);
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
      renderBreakdown(cachedRows);
    };
    tabsEl.appendChild(btn);
  });

  document.getElementById('breakdown-sort').addEventListener('change', e => {
    breakdownSort = e.target.value;
    renderBreakdown(cachedRows);
  });

  renderBreakdownRows(cachedRows);
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

  reportHeight();
}

// ── IFRAME HEIGHT REPORTING ───────────────────────────────────────────────────
function reportHeight() {
  window.parent.postMessage({ type: 'plus4-resize', height: document.documentElement.scrollHeight }, '*');
}
