const DECIMALS = 18;
const ONE = 10n ** BigInt(DECIMALS);

/** Convert a FLOP amount (number or decimal string) to planck without float rounding. */
export function toPlanck(flop: number | string): bigint {
  if (typeof flop === 'number' && !Number.isFinite(flop)) throw new Error(`invalid FLOP amount: ${flop}`);
  // Number#toString gives the shortest exact decimal ("4.7"); toFixed only for exponent forms (1e-7).
  const s = typeof flop === 'number' ? (/e/i.test(String(flop)) ? flop.toFixed(DECIMALS) : String(flop)) : flop.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid FLOP amount: ${flop}`);
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  return BigInt(whole) * ONE + BigInt(fracPadded);
}

/** Format planck as FLOP with `dp` decimals (truncated, never rounded up). */
export function fromPlanck(p: bigint, dp = 4): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const whole = abs / ONE;
  const frac = (abs % ONE).toString().padStart(DECIMALS, '0').slice(0, dp);
  return `${neg ? '-' : ''}${whole}${dp > 0 ? '.' + frac : ''}`;
}
