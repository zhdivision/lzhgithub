export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Group = typeof GROUPS[number];
export type MatchStatus = 'unplayed' | 'live' | 'finished';
export interface Team { id: string; group: Group; name: string; version: number }
export interface Match { id: string; group: Group; home: string; away: string; homeScore: number | null; awayScore: number | null; status: MatchStatus; round: number | null; kickoff: string | null; version: number; updatedAt: string | null; demo?: boolean }
export interface Snapshot { teams: Team[]; matches: Match[] }
export interface Standing extends Team { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; gd: number; points: number; rankMin: number; rankMax: number }
export type Qualification = 'guaranteed' | 'possible' | 'out';
const NAMES: Record<Group, string[]> = {
 A: ['计算机一队', '麦粒', '随缘FC', 'ZJ宇宙'],
 B: ['三墩镇皇家语宙队', '三墩镇公园巡游者', '六号右狱卒', '菜花糕'],
 C: ['老和山之翼', '迷鹿队', '碳达峰', '万物生'],
 D: ['Ctrl pro', '三墩镇皇家漫步者2.0', '械老板'],
 E: ['老和山只因', 'Focus', 'UI老男孩', '布鲁菲尔德陆柒'],
 F: ['计算机二队', 'Supermanifold', '东三门', 'Chemlsea'],
};
export function initialSnapshot(): Snapshot {
 const teams = GROUPS.flatMap(group => NAMES[group].map((name, i) => ({ id: `${group}${i + 1}`, group, name, version: 0 })));
 const matches = GROUPS.flatMap(group => {
  const pairs: [number, number][] = [];
  for (let a = 1; a <= NAMES[group].length; a++) for (let b = a + 1; b <= NAMES[group].length; b++) pairs.push([a, b]);
  return pairs.map(([a, b]) => ({ id: `${group}-${a}${b}`, group, home: `${group}${a}`, away: `${group}${b}`, homeScore: null, awayScore: null, status: 'unplayed' as const, round: null, kickoff: null, version: 0, updatedAt: null }));
 });
 return { teams, matches };
}
export function hasResult(m: Match) { return m.status !== 'unplayed' && m.homeScore !== null && m.awayScore !== null; }
// Positive means a is better. Team names and total goals never break a tie.
export function compare(a: Pick<Standing, 'points' | 'gd'>, b: Pick<Standing, 'points' | 'gd'>) { return a.points - b.points || a.gd - b.gd; }
export function standings(data: Snapshot): Record<Group, Standing[]> {
 const rows = new Map(data.teams.map(t => [t.id, { ...t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, rankMin: 1, rankMax: 1 }]));
 for (const m of data.matches) {
  if (!hasResult(m)) continue;
  const h = rows.get(m.home)!, a = rows.get(m.away)!;
  const hs = m.homeScore!, as = m.awayScore!;
  h.played++; a.played++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
  if (hs > as) { h.won++; a.lost++; h.points += 3; }
  else if (hs < as) { a.won++; h.lost++; a.points += 3; }
  else { h.drawn++; a.drawn++; h.points++; a.points++; }
 }
 const groups = {} as Record<Group, Standing[]>;
 for (const group of GROUPS) {
  const list = [...rows.values()].filter(t => t.group === group);
  for (const t of list) t.gd = t.gf - t.ga;
  for (const t of list) {
   t.rankMin = 1 + list.filter(o => compare(o, t) > 0).length;
   t.rankMax = list.filter(o => compare(o, t) >= 0).length;
  }
  // Stable ID order is for display only; intervals retain every tied possibility.
  groups[group] = list.sort((a, b) => compare(b, a) || a.id.localeCompare(b.id));
 }
 return groups;
}
export function secondCandidates(groups: Record<Group, Standing[]>, group: Group) { return groups[group].filter(t => t.rankMin <= 2 && t.rankMax >= 2); }
// Exact over all tie-break orders for the current complete or provisional snapshot.
export function qualification(groups: Record<Group, Standing[]>, teamId: string): Qualification {
 const t = Object.values(groups).flat().find(t => t.id === teamId);
 if (!t || t.rankMin > 2) return 'out';
 if (t.rankMax === 1) return 'guaranteed';
 const rivals = GROUPS.filter(g => g !== t.group).map(g => secondCandidates(groups, g));
 const worst = rivals.filter(list => list.some(o => compare(o, t) >= 0)).length;
 const best = rivals.filter(list => list.every(o => compare(o, t) > 0)).length;
 if (t.rankMax <= 2 && worst <= 1) return 'guaranteed';
 if (t.rankMin === 1 || best <= 1) return 'possible';
 return 'out';
}
export interface SolveResult { kind: 'missing' | 'impossible' | 'solved'; missing: string[]; ownScore?: number; opponentScore?: number; goalDifference?: number; candidatesChecked?: number }
export function solveMinimum(data: Snapshot, teamId: string, targetId: string, opponentScore: number): SolveResult {
 const target = data.matches.find(m => m.id === targetId);
 if (!target || ![target.home, target.away].includes(teamId) || !Number.isSafeInteger(opponentScore) || opponentScore < 0) throw new Error('请选择己方比赛，并填写非负整数的对手进球数');
 const missing = data.matches.filter(m => m.id !== targetId && !hasResult(m)).map(m => m.id);
 if (missing.length) return { kind: 'missing', missing };
 const ownHome = target.home === teamId;
 const withScore = (x: number): Snapshot => ({ teams: data.teams, matches: data.matches.map(m => m.id === targetId ? { ...m, status: 'finished', homeScore: ownHome ? x : opponentScore, awayScore: ownHome ? opponentScore : x } : m) });
 const candidates = new Set<number>();
 // Points are constant in lose/draw/win regions. GD is affine in own goals x;
 // every ordering change is a pairwise intersection, with no score search cap.
 const regions = [{ lo: 0, hi: opponentScore - 1 }, { lo: opponentScore, hi: opponentScore }, { lo: opponentScore + 1, hi: Infinity }];
 for (const { lo, hi } of regions) {
  if (lo > hi) continue;
  candidates.add(lo);
  const atLo = Object.values(standings(withScore(lo))).flat();
  const slope = (id: string) => id === teamId ? 1 : id === (ownHome ? target.away : target.home) ? -1 : 0;
  for (let i = 0; i < atLo.length; i++) for (let j = i + 1; j < atLo.length; j++) {
   const a = atLo[i], b = atLo[j], delta = slope(a.id) - slope(b.id);
   if (a.points !== b.points || delta === 0) continue;
   const crossing = lo + (b.gd - a.gd) / delta;
   for (const x of [Math.floor(crossing) - 1, Math.floor(crossing), Math.floor(crossing) + 1, Math.ceil(crossing) + 1]) {
    if (Number.isSafeInteger(x) && x >= lo && x <= hi) candidates.add(x);
   }
  }
 }
 let checked = 0;
 for (const x of [...candidates].sort((a, b) => a - b)) {
  checked++;
  if (qualification(standings(withScore(x)), teamId) === 'guaranteed') return { kind: 'solved', missing: [], ownScore: x, opponentScore, goalDifference: x - opponentScore, candidatesChecked: checked };
 }
 return { kind: 'impossible', missing: [], candidatesChecked: checked };
}
