/**
 * XEON ETF (LU0290358497) Yield Estimation Engine
 * Models Solactive €STR +8.5 Daily Total Return Index minus TER,
 * optional tracking adjustment, capital gains tax, annual stamp duty,
 * broker fees, recurring monthly contributions (PAC), and XIRR.
 */

export const XEON_DEFAULTS = {
  isin: 'LU0290358497',
  ticker: 'XEON',
  name: 'Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C',
  indexName: 'Solactive €STR +8.5 Daily Total Return Index',
  estrRatePct: 2.437, // ECB €STR reference rate (13 Nov 2026)
  estrDate: '2026-11-13',
  indexSpreadBps: 8.5,
  terPct: 0.10,
  trackingAdjBps: 0,
  dayCountBasis: 360, // Act/360 money market convention
  initialInvestment: 10000,
  monthlyContribution: 0,
  horizonValue: 1,
  horizonUnit: 'years', // 'days' | 'months' | 'years'
  taxRatePct: 0,
  stampDutyPct: 0,
  buyFee: 0,
  sellFee: 0,
  rateTrajectory: 'flat', // 'flat' | 'linear'
  targetEstrPct: 2.00,
  bankCompareGrossPct: 2.50,
  bankCompareTaxPct: 26,
};

/**
 * Add calendar months/years safely (clamping end-of-month like Jan 31 -> Feb 28).
 */
export function addToDate(startDate, value, unit) {
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  if (unit === 'days') {
    d.setDate(d.getDate() + value);
    return d;
  }
  if (unit === 'months') {
    const targetMonth = d.getMonth() + value;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(targetMonth);
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, maxDay));
    return d;
  }
  if (unit === 'years') {
    const targetYear = d.getFullYear() + value;
    const month = d.getMonth();
    const day = d.getDate();
    const maxDay = new Date(targetYear, month + 1, 0).getDate();
    return new Date(targetYear, month, Math.min(day, maxDay));
  }
  return d;
}

export function diffDays(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(1, Math.round((utcB - utcA) / 86400000));
}

/**
 * Compute annualized IRR (XIRR) using Newton-Raphson with bisection fallback.
 * cashflows: Array<{ day: number, amount: number }>
 *   negative amount = money invested, positive amount = final liquidation
 */
export function computeXirr(cashflows) {
  if (!cashflows || cashflows.length < 2) return 0;
  const maxDay = cashflows[cashflows.length - 1].day;
  if (maxDay <= 0) return 0;

  const npv = (rate) => {
    const base = 1 + rate;
    if (base <= 0) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (let i = 0; i < cashflows.length; i++) {
      sum += cashflows[i].amount / Math.pow(base, cashflows[i].day / 365);
    }
    return sum;
  };

  const dNpv = (rate) => {
    const base = 1 + rate;
    if (base <= 0) return Number.NaN;
    let sum = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const t = cashflows[i].day / 365;
      if (t !== 0) {
        sum -= (t * cashflows[i].amount) / Math.pow(base, t + 1);
      }
    }
    return sum;
  };

  // Check total net cashflow sign to pick smart initial guess
  let totalIn = 0;
  let totalOut = 0;
  for (const cf of cashflows) {
    if (cf.amount < 0) totalIn += -cf.amount;
    else totalOut += cf.amount;
  }
  if (totalIn <= 0) return 0;

  let guess = Math.pow(Math.max(0.01, totalOut / totalIn), 365 / maxDay) - 1;
  guess = Math.max(-0.9, Math.min(2.0, guess));

  for (let iter = 0; iter < 50; iter++) {
    const f = npv(guess);
    const df = dNpv(guess);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    const next = guess - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - guess) < 1e-9) {
      return next * 100;
    }
    guess = next;
  }

  // Bisection fallback on [-0.95, 2.0]
  let low = -0.95;
  let high = 2.0;
  let fLow = npv(low);
  for (let iter = 0; iter < 80; iter++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || (high - low) < 1e-9) return mid * 100;
    if ((fLow > 0 && fMid > 0) || (fLow < 0 && fMid < 0)) {
      low = mid;
      fLow = fMid;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}

/**
 * Compute instantaneous annualized pre-tax ETF rate for a given €STR (%).
 */
export function getAnnualizedRates(estrPct, opts = {}) {
  const indexSpreadBps = Number(opts.indexSpreadBps ?? XEON_DEFAULTS.indexSpreadBps);
  const terPct = Number(opts.terPct ?? XEON_DEFAULTS.terPct);
  const trackingAdjBps = Number(opts.trackingAdjBps ?? XEON_DEFAULTS.trackingAdjBps);
  const dayCountBasis = Number(opts.dayCountBasis ?? XEON_DEFAULTS.dayCountBasis) === 365 ? 365 : 360;

  const indexNominalRate = (estrPct + indexSpreadBps / 100 + trackingAdjBps / 100) / 100;
  const dailyIndexRate = indexNominalRate / dayCountBasis;
  const dailyTerRate = (terPct / 100) / 365;
  const dailyNetFundRate = dailyIndexRate - dailyTerRate;

  // Equivalent 365-day compounded pre-tax APY
  const preTaxApyPct = (Math.pow(1 + dailyNetFundRate, 365) - 1) * 100;
  const indexGrossApyPct = (Math.pow(1 + dailyIndexRate, 365) - 1) * 100;

  return {
    dailyIndexRate,
    dailyTerRate,
    dailyNetFundRate,
    indexGrossApyPct,
    preTaxApyPct,
  };
}

/**
 * Main XEON projection calculator.
 */
export function calculateXeonYield(rawInput = {}, startDateInput = new Date()) {
  const input = { ...XEON_DEFAULTS, ...rawInput };

  const initialInvestment = Math.max(0, Number(input.initialInvestment) || 0);
  const monthlyContribution = Math.max(0, Number(input.monthlyContribution) || 0);
  const horizonValue = Math.max(1, Math.round(Number(input.horizonValue) || 1));
  const horizonUnit = ['days', 'months', 'years'].includes(input.horizonUnit) ? input.horizonUnit : 'years';

  const startDate = new Date(
    startDateInput.getFullYear(),
    startDateInput.getMonth(),
    startDateInput.getDate()
  );
  const endDate = addToDate(startDate, horizonValue, horizonUnit);
  const totalDays = diffDays(startDate, endDate);

  const estrStart = Number(input.estrRatePct) || 0;
  const estrEnd = input.rateTrajectory === 'linear'
    ? (Number(input.targetEstrPct) ?? estrStart)
    : estrStart;

  const indexSpreadBps = Number(input.indexSpreadBps) || 0;
  const terPct = Math.max(0, Number(input.terPct) || 0);
  const trackingAdjBps = Number(input.trackingAdjBps) || 0;
  const dayCountBasis = Number(input.dayCountBasis) === 365 ? 365 : 360;

  const taxRatePct = Math.min(100, Math.max(0, Number(input.taxRatePct) || 0));
  const stampDutyPct = Math.min(10, Math.max(0, Number(input.stampDutyPct) || 0));
  const buyFee = Math.max(0, Number(input.buyFee) || 0);
  const sellFee = Math.max(0, Number(input.sellFee) || 0);

  // Build set of contribution day offsets (monthly anniversaries strictly before endDate)
  const contributionDays = new Set();
  if (monthlyContribution > 0) {
    let m = 1;
    while (true) {
      const cDate = addToDate(startDate, m, 'months');
      const dayOffset = diffDays(startDate, cDate);
      if (dayOffset >= totalDays || cDate >= endDate) break;
      contributionDays.add(dayOffset);
      m++;
    }
  }

  let balance = Math.max(0, initialInvestment - buyFee);
  let totalCashInvested = initialInvestment;
  let totalFees = buyFee;
  let terCostAccrued = 0;
  let balanceSumForAvg = 0;

  const cashflows = [];
  if (initialInvestment > 0) {
    cashflows.push({ day: 0, amount: -initialInvestment });
  }

  // Sample points for chart & schedule
  const totalPoints = Math.min(120, Math.max(12, totalDays));
  const sampleStep = Math.max(1, Math.floor(totalDays / totalPoints));
  const series = [{
    day: 0,
    date: startDate.toISOString().slice(0, 10),
    invested: totalCashInvested,
    grossValue: balance,
    netValue: balance,
    estrPct: estrStart,
  }];

  // Also build monthly/periodic milestone rows for schedule table
  const schedule = [];
  const milestoneDays = new Set();
  if (totalDays <= 90) {
    // Weekly milestones for short horizons
    for (let d = 7; d < totalDays; d += 7) milestoneDays.add(d);
  } else if (totalDays <= 731) {
    // Monthly milestones up to 2 years
    let m = 1;
    while (true) {
      const mDate = addToDate(startDate, m, 'months');
      const d = diffDays(startDate, mDate);
      if (d >= totalDays || mDate >= endDate) break;
      milestoneDays.add(d);
      m++;
    }
  } else {
    // Yearly milestones for >2 years (plus 6M/1Y)
    let y = 1;
    while (true) {
      const yDate = addToDate(startDate, y, 'years');
      const d = diffDays(startDate, yDate);
      if (d >= totalDays || yDate >= endDate) break;
      milestoneDays.add(d);
      y++;
    }
  }
  milestoneDays.add(totalDays);

  // Bank comparison tracking (daily simple/compound comparison)
  const bankGrossRate = (Number(input.bankCompareGrossPct) || 0) / 100;
  const bankTaxPct = Math.min(100, Math.max(0, Number(input.bankCompareTaxPct) || 0));
  const bankDailyNetRate = (bankGrossRate * (1 - bankTaxPct / 100)) / 365;
  let bankBalance = initialInvestment;

  for (let day = 1; day <= totalDays; day++) {
    const tFrac = totalDays > 1 ? (day - 1) / (totalDays - 1) : 0;
    const currentEstr = estrStart + (estrEnd - estrStart) * tFrac;

    const { dailyIndexRate, dailyTerRate, dailyNetFundRate } = getAnnualizedRates(currentEstr, {
      indexSpreadBps,
      terPct,
      trackingAdjBps,
      dayCountBasis,
    });

    const prevBalance = balance;
    balance = Math.max(0, prevBalance * (1 + dailyNetFundRate));
    terCostAccrued += prevBalance * dailyTerRate;
    balanceSumForAvg += balance;

    bankBalance = bankBalance * (1 + bankDailyNetRate);

    if (contributionDays.has(day)) {
      balance += monthlyContribution;
      bankBalance += monthlyContribution;
      totalCashInvested += monthlyContribution;
      cashflows.push({ day, amount: -monthlyContribution });
    }

    const shouldSample = day === totalDays || day % sampleStep === 0 || milestoneDays.has(day);
    if (shouldSample) {
      const avgSoFar = balanceSumForAvg / day;
      const stampSoFar = avgSoFar * (stampDutyPct / 100) * (day / 365);
      const taxableSoFar = Math.max(0, balance - sellFee - totalCashInvested);
      const taxSoFar = taxableSoFar * (taxRatePct / 100);
      const netSoFar = Math.max(0, balance - sellFee - taxSoFar - stampSoFar);

      const dObj = addToDate(startDate, day, 'days');
      const dateIso = dObj.toISOString().slice(0, 10);

      if (day === totalDays || day % sampleStep === 0) {
        series.push({
          day,
          date: dateIso,
          invested: totalCashInvested,
          grossValue: balance,
          netValue: netSoFar,
          estrPct: currentEstr,
        });
      }

      if (milestoneDays.has(day)) {
        schedule.push({
          day,
          date: dateIso,
          invested: totalCashInvested,
          grossValue: balance,
          netValue: netSoFar,
          netProfit: netSoFar - totalCashInvested,
          taxAndStamp: taxSoFar + stampSoFar,
        });
      }
    }
  }

  const avgBalance = balanceSumForAvg / totalDays;
  const grossValue = balance;
  const grossAfterExitFee = Math.max(0, grossValue - sellFee);
  totalFees += sellFee;

  const grossProfit = grossValue - totalCashInvested + buyFee; // fund growth before fees & tax
  const taxableGain = Math.max(0, grossAfterExitFee - totalCashInvested);
  const capitalGainsTax = taxableGain * (taxRatePct / 100);
  const stampDuty = avgBalance * (stampDutyPct / 100) * (totalDays / 365);

  const netFinalValue = Math.max(0, grossAfterExitFee - capitalGainsTax - stampDuty);
  const netProfit = netFinalValue - totalCashInvested;

  const netTotalReturnPct = totalCashInvested > 0 ? (netProfit / totalCashInvested) * 100 : 0;
  const grossTotalReturnPct = totalCashInvested > 0 ? ((grossValue - totalCashInvested) / totalCashInvested) * 100 : 0;

  let netApyPct = 0;
  let grossApyPct = 0;
  if (totalCashInvested > 0 && totalDays > 0) {
    if (monthlyContribution === 0) {
      netApyPct = (Math.pow(Math.max(0, netFinalValue) / totalCashInvested, 365 / totalDays) - 1) * 100;
      grossApyPct = (Math.pow(Math.max(0, grossValue) / totalCashInvested, 365 / totalDays) - 1) * 100;
    } else {
      const netFlows = [...cashflows, { day: totalDays, amount: netFinalValue }];
      const grossFlows = [...cashflows, { day: totalDays, amount: grossValue }];
      netApyPct = computeXirr(netFlows);
      grossApyPct = computeXirr(grossFlows);
    }
  }

  const avgDailyNetProfit = netProfit / totalDays;
  const avgMonthlyNetProfit = netProfit / (totalDays / 30.4375);

  const startRates = getAnnualizedRates(estrStart, { indexSpreadBps, terPct, trackingAdjBps, dayCountBasis });
  const endRates = getAnnualizedRates(estrEnd, { indexSpreadBps, terPct, trackingAdjBps, dayCountBasis });

  const bankNetProfit = bankBalance - totalCashInvested;
  const advantageVsBank = netProfit - bankNetProfit;
  const advantageVsCash = netProfit; // vs 0% checking

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    totalDays,
    totalCashInvested,
    grossValue,
    grossProfit,
    netFinalValue,
    netProfit,
    netTotalReturnPct,
    grossTotalReturnPct,
    netApyPct,
    grossApyPct,
    startPreTaxApyPct: startRates.preTaxApyPct,
    endPreTaxApyPct: endRates.preTaxApyPct,
    indexGrossApyPct: startRates.indexGrossApyPct,
    capitalGainsTax,
    stampDuty,
    terCostAccrued,
    brokerFees: totalFees,
    avgDailyNetProfit,
    avgMonthlyNetProfit,
    bankBalance,
    bankNetProfit,
    advantageVsBank,
    advantageVsCash,
    series,
    schedule,
  };
}
