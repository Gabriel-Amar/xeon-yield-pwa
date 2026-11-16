import { XEON_DEFAULTS, calculateXeonYield } from './calc.js';

const STORAGE_KEY = 'xeon-yield-state-v1';
const THEME_KEY = 'xeon-yield-theme-v1';
const ECB_ESTR_API =
  'https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=1&format=jsondata';

const el = (id) => document.getElementById(id);

let state = loadState();
let lastResult = null;
let deferredInstallPrompt = null;
let toastTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...XEON_DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore malformed storage
  }
  return { ...XEON_DEFAULTS };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function formatEur(num, signed = false) {
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat('en-IE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (!signed) {
    return num < 0 ? `−€${formatted}` : `€${formatted}`;
  }
  if (num > 0.004) return `+€${formatted}`;
  if (num < -0.004) return `−€${formatted}`;
  return `€${formatted}`;
}

function formatEurCompact(num) {
  return `€${new Intl.NumberFormat('en-IE', {
    maximumFractionDigits: 0,
  }).format(num)}`;
}

function formatPct(num, digits = 2, signed = false) {
  const prefix = signed && num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(digits)}%`;
}

function formatDateShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function showToast(msg, durationMs = 2800) {
  const toast = el('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, durationMs);
}

// Theme Handling (Dark default matching EuroYen-PAC)
function applyTheme(theme) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', resolved);
  const metaTheme = el('meta-theme-color');
  if (metaTheme) {
    metaTheme.setAttribute('content', resolved === 'dark' ? '#0b0e11' : '#f6f7f9');
  }
  el('icon-sun').classList.toggle('hidden', resolved !== 'dark');
  el('icon-moon').classList.toggle('hidden', resolved === 'dark');
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  el('btn-theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// Sync UI controls from state
function syncInputsFromState() {
  el('input-initial').value = state.initialInvestment;
  el('input-monthly').value = state.monthlyContribution;
  el('input-horizon-val').value = state.horizonValue;
  el('input-estr').value = Number(state.estrRatePct).toFixed(3);
  el('slider-estr').value = Math.min(6, Math.max(0, state.estrRatePct));
  el('hero-estr-val').textContent = Number(state.estrRatePct).toFixed(3);
  el('input-target-estr').value = Number(state.targetEstrPct).toFixed(2);
  el('input-tax').value = state.taxRatePct;
  el('input-bank-gross').value = state.bankCompareGrossPct;
  el('input-bank-tax').value = state.bankCompareTaxPct;

  // Settings modal fields
  el('input-spread-bps').value = state.indexSpreadBps;
  el('input-ter').value = state.terPct;
  el('input-tracking-bps').value = state.trackingAdjBps;
  el('input-stamp-custom').value = state.stampDutyPct;
  el('input-buy-fee').value = state.buyFee;
  el('input-sell-fee').value = state.sellFee;

  el('hero-spread-meta').textContent = `+${Number(state.indexSpreadBps).toFixed(1)} bps − ${Number(state.terPct).toFixed(2)}% TER`;
  el('rate-source-badge').textContent = `ECB · ${state.estrDate || 'Ref'}`;

  // Active chips: Initial
  document.querySelectorAll('#chips-initial .chip-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.val) === Number(state.initialInvestment));
  });

  // Active chips: Monthly
  document.querySelectorAll('#chips-monthly .chip-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.val) === Number(state.monthlyContribution));
  });

  // Active horizon buttons
  document.querySelectorAll('#chips-horizon .tf-btn').forEach((btn) => {
    const match =
      Number(btn.dataset.val) === Number(state.horizonValue) &&
      btn.dataset.unit === state.horizonUnit;
    btn.classList.toggle('active', match);
  });
  document.querySelectorAll('#horizon-unit-group .tf-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === state.horizonUnit);
  });

  // Trajectory mode
  const isLinear = state.rateTrajectory === 'linear';
  document.querySelectorAll('#trajectory-group .tf-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === state.rateTrajectory);
  });
  el('target-estr-box').classList.toggle('hidden', !isLinear);

  // Tax presets
  const taxVal = Number(state.taxRatePct);
  let matchedTaxChip = false;
  document.querySelectorAll('#chips-tax .chip-btn').forEach((btn) => {
    if (btn.dataset.tax === 'custom') return;
    const isMatch = Math.abs(Number(btn.dataset.tax) - taxVal) < 0.001;
    btn.classList.toggle('active', isMatch);
    if (isMatch) {
      matchedTaxChip = true;
      el('tax-regime-label').textContent = btn.dataset.label;
    }
  });
  const customTaxBtn = document.querySelector('#chips-tax .chip-btn[data-tax="custom"]');
  const showCustomTax = !matchedTaxChip || customTaxBtn.dataset.forceOpen === '1';
  customTaxBtn.classList.toggle('active', showCustomTax && !matchedTaxChip);
  el('custom-tax-row').classList.toggle('hidden', !showCustomTax);
  if (!matchedTaxChip) {
    el('tax-regime-label').textContent = `Custom (${taxVal.toFixed(2)}%)`;
  }

  // Stamp duty
  document.querySelectorAll('#stamp-group .tf-btn').forEach((btn) => {
    btn.classList.toggle(
      'active',
      Math.abs(Number(btn.dataset.stamp) - Number(state.stampDutyPct)) < 0.001
    );
  });

  // Day-count convention
  document.querySelectorAll('#daycount-group .tf-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.basis) === Number(state.dayCountBasis));
  });
}

function recalculateAndRender() {
  lastResult = calculateXeonYield(state);

  // Hero Card 1: Rate
  el('res-gross-apy').textContent = formatPct(lastResult.grossApyPct);

  // Hero Card 2: Profit & Value
  const profitEl = el('res-net-profit');
  profitEl.textContent = formatEur(lastResult.netProfit, true);
  profitEl.classList.toggle('positive', lastResult.netProfit >= 0);
  profitEl.classList.toggle('negative', lastResult.netProfit < 0);

  const roiBadge = el('hero-roi-badge');
  roiBadge.textContent = formatPct(lastResult.netTotalReturnPct, 2, true);
  roiBadge.classList.toggle('positive', lastResult.netTotalReturnPct >= 0);
  roiBadge.classList.toggle('negative', lastResult.netTotalReturnPct < 0);

  el('res-net-value').textContent = formatEur(lastResult.netFinalValue);
  el('label-total-invested').textContent = formatEurCompact(lastResult.totalCashInvested);
  el('res-net-apy').textContent = formatPct(lastResult.netApyPct);
  el('res-daily-avg').textContent = formatEur(lastResult.avgDailyNetProfit, true);
  el('hero-horizon-badge').textContent = `${lastResult.totalDays}d · ${formatDateShort(lastResult.endDate)}`;

  const unitSingular = state.horizonUnit.slice(0, -1);
  const unitLabel =
    Number(state.horizonValue) === 1
      ? unitSingular.charAt(0).toUpperCase() + unitSingular.slice(1)
      : state.horizonUnit.charAt(0).toUpperCase() + state.horizonUnit.slice(1);
  el('horizon-summary-text').innerHTML = `${state.horizonValue} ${unitLabel} · Monthly avg <strong class="mono">${formatEur(lastResult.avgMonthlyNetProfit, true)}</strong>`;

  // Breakdown card
  el('bd-gross-value').textContent = formatEur(lastResult.grossValue);
  el('bd-ter-cost').textContent = `−${formatEur(lastResult.terCostAccrued)}`;
  el('bd-tax-cost').textContent =
    lastResult.capitalGainsTax > 0 ? `−${formatEur(lastResult.capitalGainsTax)}` : '€0.00';

  const stampAndFees = lastResult.stampDuty + lastResult.brokerFees;
  el('bd-stamp-fee-cost').textContent =
    stampAndFees > 0 ? `−${formatEur(stampAndFees)}` : '€0.00';

  const totalDrag = lastResult.terCostAccrued + lastResult.capitalGainsTax + stampAndFees;
  el('bd-total-drag').textContent = `−${formatEur(totalDrag)}`;

  const bdNetEl = el('bd-net-profit');
  bdNetEl.textContent = formatEur(lastResult.netProfit, true);
  bdNetEl.classList.toggle('positive', lastResult.netProfit >= 0);

  // Chart header stats
  el('stat-final').textContent = formatEur(lastResult.netFinalValue);
  el('stat-invested').textContent = formatEurCompact(lastResult.totalCashInvested);
  el('stat-gain').textContent = formatEur(lastResult.netProfit, true);

  // Comparison tab
  el('cmp-xeon-profit').textContent = formatEur(lastResult.netProfit, true);
  el('cmp-bank-profit').textContent = formatEur(lastResult.bankNetProfit, true);

  const maxProfit = Math.max(1, Math.abs(lastResult.netProfit), Math.abs(lastResult.bankNetProfit));
  const xeonPctWidth = Math.max(4, (Math.max(0, lastResult.netProfit) / maxProfit) * 100);
  const bankPctWidth = Math.max(4, (Math.max(0, lastResult.bankNetProfit) / maxProfit) * 100);
  el('bar-xeon').style.width = `${xeonPctWidth.toFixed(1)}%`;
  el('bar-bank').style.width = `${bankPctWidth.toFixed(1)}%`;

  const adv = lastResult.advantageVsBank;
  if (adv >= 0.01) {
    el('cmp-verdict').innerHTML =
      `<span>XEON advantage: <strong class="mono positive-text">+${formatEur(adv)}</strong> vs. Bank Deposit</span>` +
      `<span>vs. 0% Cash: <strong class="mono positive-text">${formatEur(lastResult.advantageVsCash, true)}</strong></span>`;
  } else if (adv <= -0.01) {
    el('cmp-verdict').innerHTML =
      `<span>Bank Deposit leads by <strong class="mono">${formatEur(Math.abs(adv))}</strong></span>` +
      `<span>XEON vs. 0% Cash: <strong class="mono positive-text">${formatEur(lastResult.advantageVsCash, true)}</strong></span>`;
  } else {
    el('cmp-verdict').innerHTML =
      `<span>XEON &amp; Bank Deposit yield virtually identically</span>` +
      `<span>vs. 0% Cash: <strong class="mono positive-text">${formatEur(lastResult.advantageVsCash, true)}</strong></span>`;
  }

  renderChart(lastResult);
  renderSchedule(lastResult);
  saveState();
}

function renderSchedule(res) {
  const tbody = el('schedule-tbody');
  tbody.innerHTML = '';
  el('schedule-count-badge').textContent = `${res.schedule.length} periods`;
  const frag = document.createDocumentFragment();
  for (const row of res.schedule) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDateShort(row.date)}</td>
      <td class="mono">${row.day}d</td>
      <td class="mono">${formatEurCompact(row.invested)}</td>
      <td class="mono">${formatEur(row.grossValue)}</td>
      <td class="mono">${formatEur(row.netValue)}</td>
      <td class="mono ${row.netProfit >= 0 ? 'positive-text' : ''}" style="text-align:right;">${formatEur(row.netProfit, true)}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

// Interactive SVG Growth Chart (EuroYen-PAC sky-blue / emerald styling)
function renderChart(res) {
  const svg = el('growth-chart');
  const pts = res.series;
  if (!pts || pts.length < 2) return;

  const W = 640;
  const H = 240;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const bankStart = state.initialInvestment;
  const bankEnd = res.bankBalance;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.invested, p.netValue);
    maxY = Math.max(maxY, p.invested, p.netValue);
  }
  minY = Math.min(minY, bankStart, bankEnd);
  maxY = Math.max(maxY, bankStart, bankEnd);
  if (maxY - minY < 1) {
    minY -= 10;
    maxY += 10;
  } else {
    const padVal = (maxY - minY) * 0.12;
    minY -= padVal * 0.4;
    maxY += padVal;
  }

  const maxDay = Math.max(1, pts[pts.length - 1].day);
  const xOf = (day) => padL + (day / maxDay) * plotW;
  const yOf = (val) => padT + (1 - (val - minY) / (maxY - minY)) * plotH;

  const netCoords = pts.map((p) => `${xOf(p.day).toFixed(1)},${yOf(p.netValue).toFixed(1)}`);
  const invCoords = pts.map((p) => `${xOf(p.day).toFixed(1)},${yOf(p.invested).toFixed(1)}`);
  const bankCoords = pts.map((p) => {
    const frac = p.day / maxDay;
    const approxBank = p.invested + (res.bankBalance - res.totalCashInvested) * frac;
    return `${xOf(p.day).toFixed(1)},${yOf(approxBank).toFixed(1)}`;
  });

  const areaPath =
    `M ${xOf(pts[0].day).toFixed(1)},${(padT + plotH).toFixed(1)} ` +
    pts.map((p) => `L ${xOf(p.day).toFixed(1)},${yOf(p.netValue).toFixed(1)}`).join(' ') +
    ` L ${xOf(pts[pts.length - 1].day).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  // Horizontal subtle grid lines (3 lines)
  const gridLines = [0.25, 0.5, 0.75]
    .map((f) => {
      const gy = (padT + plotH * f).toFixed(1);
      return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1" />`;
    })
    .join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="xeonAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22" />
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.00" />
      </linearGradient>
    </defs>
    ${gridLines}
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
    <path d="${areaPath}" fill="url(#xeonAreaGrad)" />
    <polyline points="${invCoords.join(' ')}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="5 5" />
    <polyline points="${bankCoords.join(' ')}" fill="none" stroke="var(--positive)" stroke-width="1.8" stroke-opacity="0.85" />
    <polyline points="${netCoords.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    <line id="chart-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3 3" opacity="0" />
    <circle id="chart-dot" cx="0" cy="0" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" opacity="0" />
    <text x="${padL}" y="${H - 5}" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${formatDateShort(pts[0].date)}</text>
    <text x="${W - padR}" y="${H - 5}" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)" text-anchor="end">${formatDateShort(pts[pts.length - 1].date)}</text>
  `;

  const container = el('chart-container');
  const tooltip = el('chart-tooltip');

  const inspectAt = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const svgX = (relX / rect.width) * W;
    const targetDay = Math.max(0, Math.min(maxDay, ((svgX - padL) / plotW) * maxDay));

    let nearest = pts[0];
    let bestDist = Infinity;
    for (const p of pts) {
      const dist = Math.abs(p.day - targetDay);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = p;
      }
    }

    const cx = xOf(nearest.day);
    const cy = yOf(nearest.netValue);
    const crosshair = svg.querySelector('#chart-crosshair');
    const dot = svg.querySelector('#chart-dot');
    if (crosshair && dot) {
      crosshair.setAttribute('x1', cx.toFixed(1));
      crosshair.setAttribute('x2', cx.toFixed(1));
      crosshair.setAttribute('opacity', '0.85');
      dot.setAttribute('cx', cx.toFixed(1));
      dot.setAttribute('cy', cy.toFixed(1));
      dot.setAttribute('opacity', '1');
    }

    tooltip.classList.remove('hidden');
    tooltip.innerHTML =
      `<div>${formatDateShort(nearest.date)} · Day ${nearest.day}</div>` +
      `<div>Net: <strong>${formatEur(nearest.netValue)}</strong></div>` +
      `<div>€STR: ${nearest.estrPct.toFixed(3)}%</div>`;
    el('chart-hover-info').textContent = formatEur(nearest.netValue);
  };

  const hideInspect = () => {
    const crosshair = svg.querySelector('#chart-crosshair');
    const dot = svg.querySelector('#chart-dot');
    if (crosshair) crosshair.setAttribute('opacity', '0');
    if (dot) dot.setAttribute('opacity', '0');
    tooltip.classList.add('hidden');
    el('chart-hover-info').textContent = 'Tap chart';
  };

  container.onpointerdown = (e) => inspectAt(e.clientX);
  container.onpointermove = (e) => {
    if (e.buttons > 0 || e.pointerType === 'mouse') {
      inspectAt(e.clientX);
    }
  };
  container.onpointerleave = hideInspect;
}

// Live ECB €STR Sync
async function syncEcbEstr() {
  const topBtn = el('btn-sync-estr-top');
  const syncBtn = el('btn-sync-ecb');
  topBtn.classList.add('is-loading');
  syncBtn.textContent = 'Syncing…';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);

  try {
    const res = await fetch(ECB_ESTR_API, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const seriesObj = data?.dataSets?.[0]?.series;
    const firstKey = seriesObj ? Object.keys(seriesObj)[0] : null;
    const obsObj = firstKey ? seriesObj[firstKey]?.observations : null;
    const obsKey = obsObj ? Object.keys(obsObj)[0] : null;
    const rateVal = obsKey ? Number(obsObj[obsKey]?.[0]) : NaN;

    const timeValues = data?.structure?.dimensions?.observation?.[0]?.values;
    const obsDate = timeValues?.[0]?.id || 'latest';

    if (!Number.isFinite(rateVal)) {
      throw new Error('Unexpected ECB response format');
    }

    state.estrRatePct = Number(rateVal.toFixed(3));
    state.estrDate = obsDate;
    syncInputsFromState();
    recalculateAndRender();

    showToast(`Synced live ECB €STR: ${state.estrRatePct.toFixed(3)}% (${obsDate})`);
  } catch {
    showToast(`Offline or ECB unreachable — using €STR ${Number(state.estrRatePct).toFixed(3)}%`);
  } finally {
    clearTimeout(timeout);
    topBtn.classList.remove('is-loading');
    syncBtn.textContent = 'Sync Live ECB';
  }
}

// Navigation Tabs (syncs both desktop .seg-nav and mobile .mobile-nav)
function switchTab(tabName) {
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });
  document.querySelectorAll('.seg-nav .seg-btn, .mobile-nav .mob-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  if (tabName === 'projection' && lastResult) {
    renderChart(lastResult);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Settings Modal
function openSettings() {
  el('settings-backdrop').classList.add('open');
  el('settings-backdrop').setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  el('settings-backdrop').classList.remove('open');
  el('settings-backdrop').setAttribute('aria-hidden', 'true');
}

function bindEvents() {
  // Navigation
  document.querySelectorAll('.seg-nav .seg-btn, .mobile-nav .mob-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Initial investment
  el('input-initial').addEventListener('input', (e) => {
    state.initialInvestment = Math.max(0, Number(e.target.value) || 0);
    document.querySelectorAll('#chips-initial .chip-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.val) === state.initialInvestment);
    });
    recalculateAndRender();
  });

  document.querySelectorAll('#chips-initial .chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.initialInvestment = Number(btn.dataset.val);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // Monthly PAC
  el('input-monthly').addEventListener('input', (e) => {
    state.monthlyContribution = Math.max(0, Number(e.target.value) || 0);
    document.querySelectorAll('#chips-monthly .chip-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.val) === state.monthlyContribution);
    });
    recalculateAndRender();
  });

  document.querySelectorAll('#chips-monthly .chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.monthlyContribution = Number(btn.dataset.val);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // Horizon
  document.querySelectorAll('#chips-horizon .tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.horizonValue = Number(btn.dataset.val);
      state.horizonUnit = btn.dataset.unit;
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  el('input-horizon-val').addEventListener('input', (e) => {
    state.horizonValue = Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1)));
    syncInputsFromState();
    recalculateAndRender();
  });

  document.querySelectorAll('#horizon-unit-group .tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.horizonUnit = btn.dataset.unit;
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // €STR controls
  el('input-estr').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) {
      state.estrRatePct = Math.max(-1, Math.min(10, val));
      el('slider-estr').value = Math.min(6, Math.max(0, state.estrRatePct));
      el('hero-estr-val').textContent = state.estrRatePct.toFixed(3);
      recalculateAndRender();
    }
  });

  el('slider-estr').addEventListener('input', (e) => {
    state.estrRatePct = Number(e.target.value);
    el('input-estr').value = state.estrRatePct.toFixed(3);
    el('hero-estr-val').textContent = state.estrRatePct.toFixed(3);
    recalculateAndRender();
  });

  el('btn-estr-minus').addEventListener('click', () => {
    state.estrRatePct = Math.max(-1, Number((state.estrRatePct - 0.25).toFixed(3)));
    syncInputsFromState();
    recalculateAndRender();
  });

  el('btn-estr-plus').addEventListener('click', () => {
    state.estrRatePct = Math.min(10, Number((state.estrRatePct + 0.25).toFixed(3)));
    syncInputsFromState();
    recalculateAndRender();
  });

  // Trajectory
  document.querySelectorAll('#trajectory-group .tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.rateTrajectory = btn.dataset.mode;
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  el('input-target-estr').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) {
      state.targetEstrPct = Math.max(-1, Math.min(10, val));
      recalculateAndRender();
    }
  });

  el('btn-target-minus').addEventListener('click', () => {
    state.targetEstrPct = Math.max(-1, Number((state.targetEstrPct - 0.25).toFixed(3)));
    syncInputsFromState();
    recalculateAndRender();
  });

  el('btn-target-plus').addEventListener('click', () => {
    state.targetEstrPct = Math.min(10, Number((state.targetEstrPct + 0.25).toFixed(3)));
    syncInputsFromState();
    recalculateAndRender();
  });

  // ECB Sync
  el('btn-sync-ecb').addEventListener('click', syncEcbEstr);
  el('btn-sync-estr-top').addEventListener('click', syncEcbEstr);

  // Tax presets
  document.querySelectorAll('#chips-tax .chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const customBtn = document.querySelector('#chips-tax .chip-btn[data-tax="custom"]');
      if (btn.dataset.tax === 'custom') {
        customBtn.dataset.forceOpen = '1';
        el('custom-tax-row').classList.remove('hidden');
        el('input-tax').focus();
      } else {
        customBtn.dataset.forceOpen = '0';
        state.taxRatePct = Number(btn.dataset.tax);
        syncInputsFromState();
        recalculateAndRender();
      }
    });
  });

  el('input-tax').addEventListener('input', (e) => {
    state.taxRatePct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    el('tax-regime-label').textContent = `Custom (${state.taxRatePct.toFixed(2)}%)`;
    recalculateAndRender();
  });

  // Stamp duty
  document.querySelectorAll('#stamp-group .tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.stampDutyPct = Number(btn.dataset.stamp);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // Bank comparison
  el('input-bank-gross').addEventListener('input', (e) => {
    state.bankCompareGrossPct = Math.max(0, Number(e.target.value) || 0);
    recalculateAndRender();
  });

  el('input-bank-tax').addEventListener('input', (e) => {
    state.bankCompareTaxPct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    recalculateAndRender();
  });

  // Settings Modal
  el('btn-open-settings').addEventListener('click', openSettings);
  el('btn-close-settings').addEventListener('click', closeSettings);
  el('btn-done-settings').addEventListener('click', closeSettings);
  el('settings-backdrop').addEventListener('click', (e) => {
    if (e.target === el('settings-backdrop')) closeSettings();
  });

  el('input-spread-bps').addEventListener('input', (e) => {
    state.indexSpreadBps = Number(e.target.value) || 0;
    syncInputsFromState();
    recalculateAndRender();
  });
  el('input-ter').addEventListener('input', (e) => {
    state.terPct = Math.max(0, Number(e.target.value) || 0);
    syncInputsFromState();
    recalculateAndRender();
  });
  el('input-tracking-bps').addEventListener('input', (e) => {
    state.trackingAdjBps = Number(e.target.value) || 0;
    recalculateAndRender();
  });
  el('input-stamp-custom').addEventListener('input', (e) => {
    state.stampDutyPct = Math.max(0, Number(e.target.value) || 0);
    syncInputsFromState();
    recalculateAndRender();
  });
  el('input-buy-fee').addEventListener('input', (e) => {
    state.buyFee = Math.max(0, Number(e.target.value) || 0);
    recalculateAndRender();
  });
  el('input-sell-fee').addEventListener('input', (e) => {
    state.sellFee = Math.max(0, Number(e.target.value) || 0);
    recalculateAndRender();
  });

  document.querySelectorAll('#daycount-group .tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.dayCountBasis = Number(btn.dataset.basis);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  el('btn-reset-defaults').addEventListener('click', () => {
    state = { ...XEON_DEFAULTS };
    syncInputsFromState();
    recalculateAndRender();
    showToast('Reset to XEON defaults');
  });
}

// Android PWA Install & Service Worker
function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    el('install-banner').classList.remove('hidden');
  });

  const triggerInstall = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      el('install-banner').classList.add('hidden');
      if (outcome === 'accepted') {
        showToast('XEON / EUR installed to your home screen');
      }
    } else {
      showToast('In Chrome on Android, open ⋮ menu → Add to Home screen');
    }
  };

  el('btn-install-pwa').addEventListener('click', triggerInstall);
  el('btn-info-install').addEventListener('click', triggerInstall);
  el('btn-install-dismiss').addEventListener('click', () => {
    el('install-banner').classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    el('install-banner').classList.add('hidden');
    deferredInstallPrompt = null;
  });

  window.addEventListener('online', () => showToast('Back online'));
  window.addEventListener('offline', () => showToast('Offline mode — calculations work locally'));
}

function handleLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const horizon = params.get('horizon');
  const tab = params.get('tab');

  if (horizon === '1y') {
    state.horizonValue = 1;
    state.horizonUnit = 'years';
  }
  if (tab && ['estimate', 'projection', 'info'].includes(tab)) {
    switchTab(tab);
  }
}

initTheme();
handleLaunchParams();
syncInputsFromState();
bindEvents();
recalculateAndRender();
initPwa();
