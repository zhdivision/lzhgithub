export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Group = typeof GROUPS[number];
export type MatchStatus = 'unplayed' | 'live' | 'finished';
export interface Team { id: string; group: Group; name: string; version: number }
export interface Match { id: string; group: Group; home: string; away: string; homeScore: number | null; awayScore: number | null; status: MatchStatus; round: number | null; kickoff: string | null; version: number; updatedAt: string | null; demo?: boolean; locked?: boolean; lockedAt?: string | null }
export interface RoundState { round: number; version: number; locked: boolean; submittedAt: string | null }
export interface Snapshot { teams: Team[]; matches: Match[]; rounds?: RoundState[] }
export interface RunnerUpComparison extends Team { points: number; gd: number; played: number; totalPoints: number; totalGd: number; excludedTeamIds: string[] }
export interface Standing extends Team { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; gd: number; points: number; h2h: number; rankMin: number; rankMax: number; secondOptions: RunnerUpComparison[] }
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
export function deductionActive(data: Snapshot, simulated = false) { return data.matches.every(m => hasResult(m) && (simulated || m.status === 'finished')); }
// Positive means a is better. Team names and total goals never break a tie.
export function compare(a: Pick<Standing, 'points' | 'gd'>, b: Pick<Standing, 'points' | 'gd'>) { return a.points - b.points || a.gd - b.gd; }
function comparison(data: Snapshot, row: Standing, bottom: string | null): RunnerUpComparison {
 let points = row.points, gd = row.gd, played = row.played;
 if (bottom) {
  const match = data.matches.find(m => [m.home, m.away].includes(row.id) && [m.home, m.away].includes(bottom));
  if (match && hasResult(match)) {
   const own = match.home === row.id ? match.homeScore! : match.awayScore!, opponent = match.home === row.id ? match.awayScore! : match.homeScore!;
   points -= own > opponent ? 3 : own === opponent ? 1 : 0; gd -= own - opponent; played--;
  }
 }
 return { id: row.id, name: row.name, group: row.group, version: row.version, points, gd, played, totalPoints: row.points, totalGd: row.gd, excludedTeamIds: bottom ? [bottom] : [] };
}
export function standings(data: Snapshot, options: { deductBottom?: boolean } = {}): Record<Group, Standing[]> {
 const deduct = options.deductBottom ?? deductionActive(data);
 const rows = new Map<string, Standing>(data.teams.map(t => [t.id, { ...t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, h2h: 0, rankMin: 1, rankMax: 1, secondOptions: [] }]));
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
  // Head-to-head points are calculated only among the exact points/GD tie set.
  // Circular wins or an unresolved mini-table remain tied; never compare names.
  for (const t of list) {
   const tied = list.filter(o => compare(o, t) === 0).map(o => o.id);
   for (const m of data.matches) {
    if (!hasResult(m) || !tied.includes(m.home) || !tied.includes(m.away) || ![m.home, m.away].includes(t.id)) continue;
    const own = m.home === t.id ? m.homeScore! : m.awayScore!, other = m.home === t.id ? m.awayScore! : m.homeScore!;
    t.h2h += own > other ? 3 : own === other ? 1 : 0;
   }
  }
  const groupCompare = (a: Standing, b: Standing) => compare(a, b) || a.h2h - b.h2h;
  for (const t of list) {
   t.rankMin = 1 + list.filter(o => groupCompare(o, t) > 0).length;
   t.rankMax = list.filter(o => groupCompare(o, t) >= 0).length;
  }
  for (const t of list.filter(t => t.rankMin <= 2 && t.rankMax >= 2)) {
   // Every final tie block permits all internal permutations. Second and last
   // can coexist precisely when they are distinct teams, preserving correlation.
   const bottoms = deduct && list.length === 4 ? list.filter(b => b.id !== t.id && b.rankMax === list.length).map(b => b.id) : [null];
   t.secondOptions = bottoms.map(bottom => comparison(data, t, bottom));
  }
  // Stable ID order is for display only; intervals retain every tied possibility.
  groups[group] = list.sort((a, b) => groupCompare(b, a) || a.id.localeCompare(b.id));
 }
 return groups;
}
export function secondCandidates(groups: Record<Group, Standing[]>, group: Group) { return groups[group].filter(t => t.rankMin <= 2 && t.rankMax >= 2); }
export function runnerUpComparisons(groups: Record<Group, Standing[]>, group: Group) {
 const rows = new Map<string, RunnerUpComparison>();
 for (const option of secondCandidates(groups, group).flatMap(t => t.secondOptions)) {
  const key = `${option.id}:${option.points}:${option.gd}:${option.played}`, existing = rows.get(key);
  if (existing) existing.excludedTeamIds = [...new Set([...existing.excludedTeamIds, ...option.excludedTeamIds])];
  else rows.set(key, { ...option, excludedTeamIds: [...option.excludedTeamIds] });
 }
 return [...rows.values()];
}
// Exact over all tie-break orders for the current complete or provisional snapshot.
export function qualification(groups: Record<Group, Standing[]>, teamId: string): Qualification {
 const t = Object.values(groups).flat().find(t => t.id === teamId);
 if (!t || t.rankMin > 2) return 'out';
 if (t.rankMax === 1) return 'guaranteed';
 const rivals = GROUPS.filter(g => g !== t.group).map(g => runnerUpComparisons(groups, g));
 const safe = (own: RunnerUpComparison) => rivals.filter(list => list.some(o => compare(o, own) >= 0)).length < 2;
 const can = (own: RunnerUpComparison) => rivals.filter(list => list.every(o => compare(o, own) > 0)).length < 2;
 if (t.rankMax <= 2 && t.secondOptions.every(safe)) return 'guaranteed';
 if (t.rankMin === 1 || t.secondOptions.some(can)) return 'possible';
 return 'out';
}
export interface SolveResult { kind: 'missing' | 'impossible' | 'solved'; missing: string[]; ownScore?: number; opponentScore?: number; goalDifference?: number; candidatesChecked?: number; scoreRanges?: { min: number; max: number | null }[]; higherScoresSafe?: boolean }
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
  const sample = withScore(lo), atLo = Object.values(standings(sample, { deductBottom: true })).flat();
  const slope = (id: string) => id === teamId ? 1 : id === (ownHome ? target.away : target.home) ? -1 : 0;
  const lines = atLo.map(t => ({ points: t.points, gd: t.gd, slope: slope(t.id) }));
  // Add EVERY possible last-place exclusion, not just today's second/last.
  // This includes boundaries where the target opponent becomes last, causing
  // its whole result to be removed from the cross-group comparison.
  for (const t of atLo) {
   const peers = atLo.filter(o => o.group === t.group);
   for (const bottom of peers.length === 4 ? peers.filter(b => b.id !== t.id).map(b => b.id) : [null]) {
    const adjusted = comparison(sample, t, bottom);
    const excludedTarget = !!bottom && [target.home, target.away].includes(t.id) && [target.home, target.away].includes(bottom);
    lines.push({ points: adjusted.points, gd: adjusted.gd, slope: excludedTarget ? 0 : slope(t.id) });
   }
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
   const a = lines[i], b = lines[j], delta = a.slope - b.slope;
   if (a.points !== b.points || delta === 0) continue;
   const crossing = lo + (b.gd - a.gd) / delta;
   for (const x of [Math.floor(crossing) - 1, Math.floor(crossing), Math.floor(crossing) + 1, Math.ceil(crossing) + 1]) {
    if (Number.isSafeInteger(x) && x >= lo && x <= hi) candidates.add(x);
   }
  }
 }
 let checked = 0;
 const ordered = [...candidates].sort((a,b)=>a-b), ranges: { min: number; max: number | null }[] = [];
 const consider = (min: number, max: number | null) => {
  checked++;
  if (qualification(standings(withScore(min), { deductBottom: true }), teamId) !== 'guaranteed') return;
  const previous = ranges.at(-1);
  if (previous && previous.max !== null && previous.max + 1 === min) previous.max = max;
  else ranges.push({min,max});
 };
 // Between adjacent critical points every ordering is constant. Test one
 // representative for each gap, plus the unbounded tail; never enumerate scores.
 for (let i=0;i<ordered.length;i++) {
  const x=ordered[i]; consider(x,x);
  if(i+1<ordered.length && ordered[i+1]>x+1) consider(x+1,ordered[i+1]-1);
 }
 consider(ordered.at(-1)!+1,null);
 if(!ranges.length) return {kind:'impossible',missing:[],candidatesChecked:checked};
 return {kind:'solved',missing:[],ownScore:ranges[0].min,opponentScore,goalDifference:ranges[0].min-opponentScore,candidatesChecked:checked,scoreRanges:ranges,higherScoresSafe:ranges[0].max===null};
}
