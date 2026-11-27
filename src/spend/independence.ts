import type { MinerInfo } from '../core/types.js';

export type Independence = 'independent' | 'own_address' | 'declared_own' | 'linked' | 'unverified';

/** Spend only to miners not under the owner's control (rules: "independent demand only"). */
export function checkIndependence(m: MinerInfo, own: Set<string>, declared: Set<string>): Independence {
  if (own.has(m.address)) return 'own_address';
  if (declared.has(m.address)) return 'declared_own';
  if (m.linkedAccounts === null) return 'unverified';
  if (m.linkedAccounts.some((a) => own.has(a) || declared.has(a))) return 'linked';
  return 'independent';
}

export function eligibleMiners(list: MinerInfo[], own: Set<string>, declared: Set<string>) {
  const rows = list.map((miner) => ({ miner, result: checkIndependence(miner, own, declared) }));
  return [...rows.filter((r) => r.result === 'independent'), ...rows.filter((r) => r.result !== 'independent')];
}
