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

function valueColor(val, bound) {
  const t = Math.max(-1, Math.min(1, val / (bound || 1)));
  function lerp(a, b, x) { return Math.round(a + (b - a) * x); }
  let r, g, b;
  if (t < 0) { const x = t + 1; r = lerp(220,160,x); g = lerp(38,160,x); b = lerp(38,160,x); }
  else        { const x = t;     r = lerp(160,34,x);  g = lerp(160,197,x); b = lerp(160,94,x); }
  return `rgb(${r},${g},${b})`;
}

// ── CSV LOADING ────────────────────────────────────────────────────────────────
const CSV_URL = 'https://raw.githubusercontent.com/plus4blog/plus4-viz/main/data/course_skill_lookup.csv';

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
let breakdownSkill = null;
let breakdownSort  = 'r';

function buildBreakdown(allData) {
  const keyMap = {};
  allData.forEach(row => {
    const course = row.course_name_b || row.course_num_b;
    const skill  = row.skill;
    if (!course || !skill) return;
    const key = `${course}||${skill}`;
    if (!keyMap[key]) {
      keyMap[key] = { course, skill, r_vals: [], p_vals: [], vintage_vals: [], event_sum: 0 };
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

  // Skill filter tabs
  const skills  = [...new Set(rows.map(r => r.skill))];
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

  const visible   = breakdownShowAll ? sorted : sorted.slice(0, BREAKDOWN_PAGE_SIZE);
  const remaining = sorted.length - BREAKDOWN_PAGE_SIZE;

  document.getElementById('breakdown-tbody').innerHTML = visible.map(d => {
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

  reportHeight();
}

// ── IFRAME HEIGHT REPORTING ───────────────────────────────────────────────────
function reportHeight() {
  window.parent.postMessage({ type: 'plus4-resize', height: document.documentElement.scrollHeight }, '*');
}
