/** Splits min(balance − reserve, ceilingLeft) into chunks ≤ perTx, dropping a remainder below minEscrow. */
export function planSessions(balance: bigint, reserve: bigint, perTx: bigint, minEscrow: bigint, ceilingLeft: bigint): bigint[] {
  const avail = balance - reserve;
  let left = avail < ceilingLeft ? avail : ceilingLeft;
  const out: bigint[] = [];
  if (perTx <= 0n) return out;
  while (left >= minEscrow && left > 0n) {
    const chunk = left > perTx ? perTx : left;
    out.push(chunk);
    left -= chunk;
  }
  return out;
}
