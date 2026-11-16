import assert from 'node:assert/strict';
import { calculateXeonYield, getAnnualizedRates, computeXirr } from '../calc.js';

const fixedStart = new Date(2026, 10, 16); // Nov 16, 2026

// 1. Annualized rate formula verification (€STR 2.437% + 8.5 bps - 0.10% TER, ACT/360)
{
  const rates = getAnnualizedRates(2.437, {
    indexSpreadBps: 8.5,
    terPct: 0.10,
    dayCountBasis: 360,
  });
  // (0.02437 + 0.00085)/360 - 0.0010/365 = 0.0000700555 - 0.0000027397 = 0.0000673158/day
  // (1 + 0.0000673158)^365 - 1 ≈ 2.4872%
  assert.ok(rates.preTaxApyPct > 2.48 && rates.preTaxApyPct < 2.50, `Expected ~2.487%, got ${rates.preTaxApyPct}`);
  assert.ok(rates.indexGrossApyPct > rates.preTaxApyPct);
}

// 2. Gross 1-year lump sum €10,000
{
  const res = calculateXeonYield(
    {
      initialInvestment: 10000,
      monthlyContribution: 0,
      horizonValue: 1,
      horizonUnit: 'years',
      estrRatePct: 2.437,
      taxRatePct: 0,
      stampDutyPct: 0,
    },
    fixedStart
  );
  assert.equal(res.totalDays, 365);
  assert.equal(res.totalCashInvested, 10000);
  assert.ok(res.netFinalValue > 10248 && res.netFinalValue < 10250, `Unexpected final value: ${res.netFinalValue}`);
  assert.equal(res.capitalGainsTax, 0);
  assert.ok(res.terCostAccrued > 10.0 && res.terCostAccrued < 10.3);
}

// 3. Tax & Stamp duty deduction (Italian White-list 12.94% + 0.20% Bollo)
{
  const gross = calculateXeonYield(
    { initialInvestment: 10000, horizonValue: 1, horizonUnit: 'years', taxRatePct: 0, stampDutyPct: 0 },
    fixedStart
  );
  const net = calculateXeonYield(
    { initialInvestment: 10000, horizonValue: 1, horizonUnit: 'years', taxRatePct: 12.94, stampDutyPct: 0.20 },
    fixedStart
  );
  assert.ok(net.capitalGainsTax > 31 && net.capitalGainsTax < 33);
  assert.ok(net.stampDuty > 20 && net.stampDuty < 20.5);
  assert.ok(net.netProfit < gross.netProfit);
  assert.ok(Math.abs((gross.netFinalValue - net.capitalGainsTax - net.stampDuty) - net.netFinalValue) < 0.01);
}

// 4. Recurring PAC contributions + XIRR sanity check
{
  const pac = calculateXeonYield(
    {
      initialInvestment: 5000,
      monthlyContribution: 500,
      horizonValue: 1,
      horizonUnit: 'years',
      estrRatePct: 2.437,
      taxRatePct: 0,
      stampDutyPct: 0,
    },
    fixedStart
  );
  // 11 monthly contributions before final day (months 1..11) -> 5000 + 11*500 = 10500
  assert.equal(pac.totalCashInvested, 10500);
  assert.ok(pac.netProfit > 180 && pac.netProfit < 205, `Unexpected PAC profit: ${pac.netProfit}`);
  // Annualized XIRR should match pre-tax APY (~2.487%) closely
  assert.ok(Math.abs(pac.netApyPct - 2.487) < 0.05, `Expected XIRR ~2.487%, got ${pac.netApyPct}`);
}

// 5. Gradual ECB rate cut scenario yields less than flat rate
{
  const flat = calculateXeonYield(
    { initialInvestment: 10000, horizonValue: 2, horizonUnit: 'years', estrRatePct: 2.437, rateTrajectory: 'flat' },
    fixedStart
  );
  const cut = calculateXeonYield(
    { initialInvestment: 10000, horizonValue: 2, horizonUnit: 'years', estrRatePct: 2.437, rateTrajectory: 'linear', targetEstrPct: 1.50 },
    fixedStart
  );
  assert.ok(cut.netProfit < flat.netProfit);
}

// 6. Direct XIRR sanity
{
  const xirr = computeXirr([
    { day: 0, amount: -1000 },
    { day: 365, amount: 1050 },
  ]);
  assert.ok(Math.abs(xirr - 5.0) < 0.01, `Expected 5.0%, got ${xirr}`);
}

console.log('All XEON Yield calculation tests passed!');
