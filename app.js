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
    return num < 0 ? `-€${formatted}` : `€${formatted}`;
  }
  if (num > 0.004) return `+€${formatted}`;
  if (num < -0.004) return `-€${formatted}`;
  return `€${formatted}`;
}

function formatEurCompact(num) {
  return `€${new Intl.NumberFormat('en-IE', {
    maximumFractionDigits: 0,
  }).format(num)}`;
}

function formatPct(num, digits = 2) {
  return `${num.toFixed(digits)}%`;
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

// Theme Handling
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'auto' && prefersDark);
  el('icon-sun').classList.toggle('hidden', !isDark);
  el('icon-moon').classList.toggle('hidden', isDark);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'auto';
  applyTheme(savedTheme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem(THEME_KEY) || 'auto';
    if (current === 'auto') applyTheme('auto');
  });

  el('btn-theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'auto';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentlyDark = current === 'dark' || (current === 'auto' && prefersDark);
    const next = currentlyDark ? 'light' : 'dark';
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
  el('header-estr-value').textContent = `${Number(state.estrRatePct).toFixed(3)}%`;
  el('input-target-estr').value = Number(state.targetEstrPct).toFixed(2);
  el('input-tax').value = state.taxRatePct;
  el('input-bank-gross').value = state.bankCompareGrossPct;
  el('input-bank-tax').value = state.bankCompareTaxPct;

  // Settings sheet fields
  el('input-spread-bps').value = state.indexSpreadBps;
  el('input-ter').value = state.terPct;
  el('input-tracking-bps').value = state.trackingAdjBps;
  el('input-stamp-custom').value = state.stampDutyPct;
  el('input-buy-fee').value = state.buyFee;
  el('input-sell-fee').value = state.sellFee;

  // Active chips: Initial
  document.querySelectorAll('#chips-initial .chip').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.val) === Number(state.initialInvestment));
  });

  // Active chips: Monthly
  document.querySelectorAll('#chips-monthly .chip').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.val) === Number(state.monthlyContribution));
  });

  // Active chips & segmented: Horizon
  document.querySelectorAll('#chips-horizon .chip').forEach((btn) => {
    const match =
      Number(btn.dataset.val) === Number(state.horizonValue) &&
      btn.dataset.unit === state.horizonUnit;
    btn.classList.toggle('active', match);
  });
  document.querySelectorAll('#horizon-unit-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === state.horizonUnit);
  });

  const unitSingular = state.horizonUnit.slice(0, -1);
  const unitLabel =
    Number(state.horizonValue) === 1
      ? unitSingular.charAt(0).toUpperCase() + unitSingular.slice(1)
      : state.horizonUnit.charAt(0).toUpperCase() + state.horizonUnit.slice(1);
  el('horizon-summary-text').textContent = `${state.horizonValue} ${unitLabel}`;

  // Trajectory mode
  const isLinear = state.rateTrajectory === 'linear';
  document.querySelectorAll('#trajectory-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === state.rateTrajectory);
  });
  el('target-estr-box').classList.toggle('hidden', !isLinear);
  el('target-estr-delta').textContent = `${Number(state.targetEstrPct).toFixed(3)}%`;

  // Tax presets
  const taxVal = Number(state.taxRatePct);
  let matchedTaxChip = false;
  document.querySelectorAll('#chips-tax .chip').forEach((btn) => {
    if (btn.dataset.tax === 'custom') return;
    const isMatch = Math.abs(Number(btn.dataset.tax) - taxVal) < 0.001;
    btn.classList.toggle('active', isMatch);
    if (isMatch) {
      matchedTaxChip = true;
      el('tax-regime-label').textContent = btn.dataset.label;
    }
  });
  const customTaxBtn = document.querySelector('#chips-tax .chip[data-tax="custom"]');
  const showCustomTax = !matchedTaxChip || customTaxBtn.dataset.forceOpen === '1';
  customTaxBtn.classList.toggle('active', showCustomTax && !matchedTaxChip);
  el('custom-tax-row').classList.toggle('hidden', !showCustomTax);
  if (!matchedTaxChip) {
    el('tax-regime-label').textContent = `Custom (${taxVal.toFixed(2)}%)`;
  }

  // Stamp duty segmented
  document.querySelectorAll('#stamp-group .seg-btn').forEach((btn) => {
    btn.classList.toggle(
      'active',
      Math.abs(Number(btn.dataset.stamp) - Number(state.stampDutyPct)) < 0.001
    );
  });

  // Day-count convention
  document.querySelectorAll('#daycount-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.basis) === Number(state.dayCountBasis));
  });
}

function recalculateAndRender() {
  lastResult = calculateXeonYield(state);

  // Hero card
  el('hero-horizon-badge').textContent = `${lastResult.totalDays} days · ${formatDateShort(lastResult.endDate)}`;
  el('res-net-value').textContent = formatEur(lastResult.netFinalValue);

  const deltaEl = el('res-net-profit');
  deltaEl.textContent = formatEur(lastResult.netProfit, true);
  deltaEl.classList.toggle('positive', lastResult.netProfit >= 0);
  deltaEl.classList.toggle('negative', lastResult.netProfit < 0);

  el('res-net-apy').textContent = formatPct(lastResult.netApyPct);
  el('res-gross-apy').textContent = formatPct(lastResult.grossApyPct);
  el('res-monthly-avg').textContent = formatEur(lastResult.avgMonthlyNetProfit, true);
  el('res-daily-avg').textContent = formatEur(lastResult.avgDailyNetProfit, true);

  el('label-total-invested').textContent = `Total invested: ${formatEurCompact(lastResult.totalCashInvested)}`;

  // Breakdown card
  el('bd-gross-value').textContent = formatEur(lastResult.grossValue);
  el('bd-ter-cost').textContent = `-${formatEur(lastResult.terCostAccrued)}`;
  el('bd-tax-cost').textContent =
    lastResult.capitalGainsTax > 0 ? `-${formatEur(lastResult.capitalGainsTax)}` : '€0.00';

  const stampAndFees = lastResult.stampDuty + lastResult.brokerFees;
  el('bd-stamp-fee-cost').textContent =
    stampAndFees > 0 ? `-${formatEur(stampAndFees)}` : '€0.00';
  el('bd-net-profit').textContent = formatEur(lastResult.netProfit, true);

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
    el('cmp-verdict').textContent =
      `XEON yields ${formatEur(adv)} more net profit than the bank deposit, and ${formatEur(lastResult.advantageVsCash)} more than idle 0% cash.`;
  } else if (adv <= -0.01) {
    el('cmp-verdict').textContent =
      `The bank deposit yields ${formatEur(Math.abs(adv))} more than XEON under these rates & taxes (still ${formatEur(lastResult.advantageVsCash)} above 0% cash).`;
  } else {
    el('cmp-verdict').textContent =
      `XEON and the bank deposit produce virtually identical net returns over this horizon.`;
  }

  renderChart(lastResult);
  renderSchedule(lastResult);
  saveState();
}

function renderSchedule(res) {
  const tbody = el('schedule-tbody');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const row of res.schedule) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDateShort(row.date)}</td>
      <td>${formatEurCompact(row.invested)}</td>
      <td>${formatEur(row.netValue)}</td>
      <td class="${row.netProfit >= 0 ? 'accent' : ''}">${formatEur(row.netProfit, true)}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

// Interactive SVG Growth Chart
function renderChart(res) {
  const svg = el('growth-chart');
  const pts = res.series;
  if (!pts || pts.length < 2) return;

  const W = 360;
  const H = 200;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 22;
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

  // Approximate bank curve between start and end
  const bankCoords = pts.map((p) => {
    const frac = p.day / maxDay;
    const approxBank =
      p.invested + (res.bankBalance - res.totalCashInvested) * frac;
    return `${xOf(p.day).toFixed(1)},${yOf(approxBank).toFixed(1)}`;
  });

  const areaPath =
    `M ${xOf(pts[0].day).toFixed(1)},${(padT + plotH).toFixed(1)} ` +
    pts.map((p) => `L ${xOf(p.day).toFixed(1)},${yOf(p.netValue).toFixed(1)}`).join(' ') +
    ` L ${xOf(pts[pts.length - 1].day).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="xeonAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border-subtle)" stroke-width="1" />
    <path d="${areaPath}" fill="url(#xeonAreaGrad)" />
    <polyline points="${invCoords.join(' ')}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4" />
    <polyline points="${bankCoords.join(' ')}" fill="none" stroke="var(--slate-line)" stroke-width="1.8" />
    <polyline points="${netCoords.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    <line id="chart-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="2 2" opacity="0" />
    <circle id="chart-dot" cx="0" cy="0" r="4.5" fill="var(--accent)" stroke="var(--bg-surface)" stroke-width="2" opacity="0" />
    <text x="${padL}" y="${H - 4}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)">${formatDateShort(pts[0].date)}</text>
    <text x="${W - padR}" y="${H - 4}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">${formatDateShort(pts[pts.length - 1].date)}</text>
  `;

  // Pointer scrubbing
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
      crosshair.setAttribute('opacity', '0.8');
      dot.setAttribute('cx', cx.toFixed(1));
      dot.setAttribute('cy', cy.toFixed(1));
      dot.setAttribute('opacity', '1');
    }

    tooltip.classList.remove('hidden');
    tooltip.innerHTML =
      `<div>${formatDateShort(nearest.date)} (Day ${nearest.day})</div>` +
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
    el('chart-hover-info').textContent = 'Tap chart to inspect';
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
  const dot = el('sync-status-dot');
  const label = el('sync-status-label');
  dot.classList.add('loading');
  label.textContent = 'Fetching ECB…';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);

  try {
    const res = await fetch(ECB_ESTR_API, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Parse SDMX-JSON structure
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

    label.textContent = `ECB (${obsDate})`;
    showToast(`Synced live €STR: ${state.estrRatePct.toFixed(3)}% (${obsDate})`);
  } catch (err) {
    label.textContent = `Ref (${state.estrDate})`;
    showToast(`Offline or ECB unreachable — using €STR ${Number(state.estrRatePct).toFixed(3)}%`);
  } finally {
    clearTimeout(timeout);
    dot.classList.remove('loading');
  }
}

// Navigation Tabs
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const active = panel.id === `panel-${tabName}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  if (tabName === 'projection' && lastResult) {
    renderChart(lastResult);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Bottom Sheet Modal
function openSettings() {
  el('settings-backdrop').classList.remove('hidden');
  el('settings-backdrop').setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  el('settings-backdrop').classList.add('hidden');
  el('settings-backdrop').setAttribute('aria-hidden', 'true');
}

function bindEvents() {
  // Navigation
  document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Initial investment
  el('input-initial').addEventListener('input', (e) => {
    state.initialInvestment = Math.max(0, Number(e.target.value) || 0);
    document.querySelectorAll('#chips-initial .chip').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.val) === state.initialInvestment);
    });
    recalculateAndRender();
  });

  document.querySelectorAll('#chips-initial .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.initialInvestment = Number(btn.dataset.val);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // Monthly PAC
  el('input-monthly').addEventListener('input', (e) => {
    state.monthlyContribution = Math.max(0, Number(e.target.value) || 0);
    document.querySelectorAll('#chips-monthly .chip').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.val) === state.monthlyContribution);
    });
    recalculateAndRender();
  });

  document.querySelectorAll('#chips-monthly .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.monthlyContribution = Number(btn.dataset.val);
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // Horizon
  document.querySelectorAll('#chips-horizon .chip').forEach((btn) => {
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

  document.querySelectorAll('#horizon-unit-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.horizonUnit = btn.dataset.unit;
      syncInputsFromState();
      recalculateAndRender();
    });
  });

  // €STR rate controls
  el('input-estr').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) {
      state.estrRatePct = Math.max(-1, Math.min(10, val));
      el('slider-estr').value = Math.min(6, Math.max(0, state.estrRatePct));
      el('header-estr-value').textContent = `${state.estrRatePct.toFixed(3)}%`;
      recalculateAndRender();
    }
  });

  el('slider-estr').addEventListener('input', (e) => {
    state.estrRatePct = Number(e.target.value);
    el('input-estr').value = state.estrRatePct.toFixed(3);
    el('header-estr-value').textContent = `${state.estrRatePct.toFixed(3)}%`;
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

  // Rate trajectory
  document.querySelectorAll('#trajectory-group .seg-btn').forEach((btn) => {
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
      el('target-estr-delta').textContent = `${state.targetEstrPct.toFixed(3)}%`;
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

  // Sync ECB buttons
  el('btn-sync-ecb').addEventListener('click', syncEcbEstr);
  el('btn-sync-estr-top').addEventListener('click', syncEcbEstr);

  // Tax presets
  document.querySelectorAll('#chips-tax .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const customBtn = document.querySelector('#chips-tax .chip[data-tax="custom"]');
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

  // Stamp duty segmented
  document.querySelectorAll('#stamp-group .seg-btn').forEach((btn) => {
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
  el('settings-backdrop').addEventListener('click', (e) => {
    if (e.target === el('settings-backdrop')) closeSettings();
  });

  el('input-spread-bps').addEventListener('input', (e) => {
    state.indexSpreadBps = Number(e.target.value) || 0;
    recalculateAndRender();
  });
  el('input-ter').addEventListener('input', (e) => {
    state.terPct = Math.max(0, Number(e.target.value) || 0);
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

  document.querySelectorAll('#daycount-group .seg-btn').forEach((btn) => {
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
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // SW registration failed or unsupported in current context
      });
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
        showToast('XEON Yield installed to your home screen');
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
  window.addEventListener('offline', () => showToast('Offline mode — all calculations work locally'));
}

// Handle Android Launcher Shortcut Query Params
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

// Boot
initTheme();
handleLaunchParams();
syncInputsFromState();
bindEvents();
recalculateAndRender();
initPwa();
