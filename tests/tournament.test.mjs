import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, initialSnapshot, standings, qualification, solveMinimum, runnerUpComparisons, deductionActive } from '../lib/tournament.ts';
const completed = (home = 0, away = 0) => { const s = initialSnapshot(); s.matches.forEach(m => Object.assign(m, { status: 'finished', homeScore: home, awayScore: away })); return s; };
function set(s, id, h, a, status = 'finished') { Object.assign(s.matches.find(m => m.id === id), { status, homeScore: h, awayScore: a }); }
test('23 real teams, 33 unique round-robin fixtures, D has three teams and three matches', () => {
 const s = initialSnapshot(); assert.equal(s.teams.length, 23); assert.equal(s.matches.length, 33);
 assert.equal(s.teams.filter(t => t.group === 'D').length, 3); assert.equal(s.matches.filter(t => t.group === 'D').length, 3);
 assert.equal(new Set(s.matches.map(m => [m.home, m.away].sort().join('|'))).size, 33);
 for (const t of s.teams) assert.equal(s.matches.filter(m => [m.home, m.away].includes(t.id)).length, t.group === 'D' ? 2 : 3);
 assert.equal(s.teams.find(t => t.id === 'D3').name, '械老板'); assert.ok(!s.teams.some(t => t.id === 'D4'));
});
test('blank is unplayed; 0:0 is a draw; live scores count; corrections and cancellation recalculate', () => {
 const s = initialSnapshot(); let rows = standings(s); assert.equal(rows.A[0].played, 0);
 set(s, 'A-12', 0, 0); rows = standings(s); assert.equal(rows.A.find(t => t.id === 'A1').points, 1);
 set(s, 'A-12', 3, 1, 'live'); rows = standings(s); const a = rows.A.find(t => t.id === 'A1'); assert.deepEqual([a.points, a.gd, a.played, a.won], [3, 2, 1, 1]);
 set(s, 'A-12', 0, 2); rows = standings(s); assert.equal(rows.A.find(t => t.id === 'A1').points, 0); assert.equal(rows.A.find(t => t.id === 'A1').gd, -2);
 set(s, 'A-12', null, null, 'unplayed'); assert.equal(standings(s).A[0].played, 0);
});
test('group conservation and no implicit name/goals tie-breaker', () => {
 const s = completed(2, 1); for (const g of GROUPS) { const rows = standings(s)[g]; assert.equal(rows.reduce((n, t) => n + t.gf, 0), rows.reduce((n, t) => n + t.ga, 0)); assert.equal(rows.reduce((n, t) => n + t.gd, 0), 0); }
 const zeros = standings(completed()); assert.equal(zeros.A[0].rankMin, 1); assert.equal(zeros.A[0].rankMax, 4); assert.equal(zeros.D[0].rankMax, 3);
 for (const t of zeros.A) assert.equal(qualification(zeros, t.id), 'possible');
});
function permutations(list) { if (list.length < 2) return [list]; return list.flatMap((v, i) => permutations(list.filter((_, j) => j !== i)).map(rest => [v, ...rest])); }
// Independent oracle: enumerate legal group orderings and possible rival second-place
// occupants, then let tied rivals precede/follow the target at the qualification line.
function exhaustiveQualification(data, id) {
 const stats = (team, excluded = null, opponents = null) => {
  let points = 0, gd = 0;
  for (const m of data.matches) {
   if (m.status === 'unplayed' || m.homeScore === null || m.awayScore === null || ![m.home,m.away].includes(team)) continue;
   const other = m.home === team ? m.away : m.home;
   if (other === excluded || opponents && !opponents.includes(other)) continue;
   const a = m.home === team ? m.homeScore : m.awayScore, b = m.home === team ? m.awayScore : m.homeScore;
   points += a > b ? 3 : a === b ? 1 : 0; gd += a-b;
  }
  return { points, gd };
 };
 const groups = Object.fromEntries(GROUPS.map(group => [group,data.teams.filter(t=>t.group===group).map(t=>({...t,...stats(t.id)}))]));
 for (const list of Object.values(groups)) for (const t of list) t.h2h = stats(t.id,null,list.filter(o=>o.points===t.points && o.gd===t.gd).map(o=>o.id)).points;
 const better = (a,b) => a.points > b.points || a.points === b.points && a.gd > b.gd;
 const equal = (a,b) => a.points === b.points && a.gd === b.gd;
 const groupBetter = (a,b) => better(a,b) || equal(a,b) && a.h2h > b.h2h;
 const legal = Object.fromEntries(GROUPS.map(g => [g, permutations(groups[g]).filter(p => p.every((v,i)=>i===0 || !groupBetter(v,p[i-1])))]));
 const ownGroup = data.teams.find(t=>t.id===id).group;
 const score = order => stats(order[1].id,order.length===4 ? order.at(-1).id : null);
 let any = false, every = true;
 const rivalGroups = GROUPS.filter(g => g !== ownGroup);
 const choices = rivalGroups.map(g => [...new Map(legal[g].map(order=>{const value=score(order);return [`${value.points}:${value.gd}`,value];})).values()]);
 for (const order of legal[ownGroup]) {
  const pos = order.findIndex(t => t.id === id), own = score(order);
  if (pos === 0) { any = true; continue; }
  if (pos > 1) { every = false; continue; }
  const visit = (i, betterCount, equalCount) => {
   if (i === choices.length) { any ||= betterCount < 2; every &&= betterCount + equalCount < 2; return; }
   for (const rival of choices[i]) visit(i + 1, betterCount + Number(better(rival, own)), equalCount + Number(equal(rival, own)));
  };
  visit(0, 0, 0);
 }
 return every ? 'guaranteed' : any ? 'possible' : 'out';
}
let seed = 9245; function rand(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
test('tie-aware qualification matches exhaustive legal orderings', () => {
 const samples = [completed(), ...Array.from({ length: 60 }, () => { const s = completed(); s.matches.forEach(m => set(s, m.id, rand(3), rand(3))); return s; })];
 for (const s of samples) { const groups = standings(s); for (const t of s.teams) assert.equal(qualification(groups, t.id), exhaustiveQualification(s, t.id), t.id); }
});
test('solver reports missing games and never treats blank as 0:0', () => {
 const s = initialSnapshot(); const result = solveMinimum(s, 'A1', 'A-12', 0); assert.equal(result.kind, 'missing'); assert.equal(result.missing.length, 32);
});
test('draw enough, permitted loss, impossible, away-side orientation, and no fixed search cap', () => {
 const s = completed(); set(s, 'A-12', 5, 0); set(s, 'A-13', 5, 0);
 assert.equal(solveMinimum(s, 'A1', 'A-14', 0).goalDifference, 0);
 assert.equal(solveMinimum(s, 'A1', 'A-14', 7).goalDifference, -7);
 const no = completed(); set(no, 'A-12', 1, 0); set(no, 'A-13', 1, 0); set(no, 'A-14', 1, 0); set(no, 'A-23', 1, 0); set(no, 'A-24', 1, 0);
 assert.equal(solveMinimum(no, 'A4', 'A-34', 0).kind, 'impossible');
 const high = completed();
 for (const g of ['A','B','C']) {
  set(high,`${g}-12`,1,0);set(high,`${g}-13`,1,0);set(high,`${g}-14`,1,0);set(high,`${g}-23`,g==='B'?2001:g==='C'?2000:1,0);set(high,`${g}-24`,1,0);set(high,`${g}-34`,1,0);
 }
 const result = solveMinimum(high, 'A2', 'A-23', 0); assert.equal(result.ownScore, 2001); assert.ok(result.candidatesChecked < 100);
 const away = solveMinimum(s, 'A4', 'A-14', 0); assert.notEqual(away.kind, 'missing');
});

test('head-to-head separates two tied teams; circular wins remain tied', () => {
 const s=completed();set(s,'A-12',1,0);set(s,'A-13',0,1);set(s,'A-14',0,0);set(s,'A-23',1,0);set(s,'A-24',0,0);set(s,'A-34',1,0);
 const a=standings(s).A;assert.equal(a.find(t=>t.id==='A1').rankMin,2);assert.equal(a.find(t=>t.id==='A2').rankMin,3);
 set(s,'D-12',1,0);set(s,'D-13',0,1);set(s,'D-23',1,0);
 for(const t of standings(s).D){assert.equal(t.points,3);assert.equal(t.gd,0);assert.equal(t.rankMin,1);assert.equal(t.rankMax,3);}
});
test('runner-up comparison removes bottom result, preserves D, and waits until all formal games finish', () => {
 const s=completed();set(s,'A-12',1,0);set(s,'A-13',1,0);set(s,'A-14',1,0);set(s,'A-23',1,0);set(s,'A-24',0,1);set(s,'A-34',1,0);
 const options=runnerUpComparisons(standings(s),'A').filter(t=>t.id==='A2');
 assert.deepEqual(options.map(t=>t.points).sort(),[0,3]);assert.ok(options.every(t=>!t.excludedTeamIds.includes('A2')));
 for(const t of runnerUpComparisons(standings(s),'D')){assert.equal(t.points,2);assert.equal(t.played,2);assert.equal(t.excludedTeamIds.length,0);}
 s.matches[0].status='live';assert.equal(deductionActive(s),false);assert.equal(deductionActive(s,true),true);
 assert.equal(standings(s).A.find(t=>t.id==='A2').secondOptions[0].points,3);
 assert.ok(standings(s).A.every(t=>t.secondOptions.every(o=>o.excludedTeamIds.length===0)));
 assert.deepEqual(runnerUpComparisons(standings(s,{deductBottom:true}),'A').filter(t=>t.id==='A2').map(t=>t.points).sort(),[0,3]);
});
test('critical-point minimum equals brute-force score search on 240 random scenarios', () => {
 for (let iteration = 0; iteration < 240; iteration++) {
  const s = completed(); s.matches.forEach(m => set(s, m.id, rand(6), rand(6)));
  const target = s.matches[rand(s.matches.length)], ownHome = !!rand(2), team = ownHome ? target.home : target.away, opponent = rand(5);
  let minimum = null;
  for (let x = 0; x <= 100; x++) {
   const candidate = structuredClone(s); set(candidate, target.id, ownHome ? x : opponent, ownHome ? opponent : x);
   if (qualification(standings(candidate), team) === 'guaranteed') { minimum = x; break; }
  }
  const solved = solveMinimum(s, team, target.id, opponent);
  assert.equal(solved.kind === 'solved' ? solved.ownScore : null, minimum, `iteration ${iteration} ${team} ${target.id}`);
  if(solved.kind==='solved') for(let x=0;x<=35;x++) {
   const candidate=structuredClone(s);set(candidate,target.id,ownHome?x:opponent,ownHome?opponent:x);
   const expected=qualification(standings(candidate,{deductBottom:true}),team)==='guaranteed';
   assert.equal(solved.scoreRanges.some(range=>x>=range.min&&(range.max===null||x<=range.max)),expected,`range ${iteration} score ${x}`);
  }
 }
});
test('a bigger win may remove the target victory; return a finite qualifying interval', () => {
 const s=completed();set(s,'A-12',1,0);set(s,'A-13',1,0);set(s,'A-14',1,0);set(s,'A-23',0,1);set(s,'A-24',0,0);set(s,'A-34',0,3);
 const result=solveMinimum(s,'A2','A-24',0);
 assert.equal(result.ownScore,2);assert.equal(result.higherScoresSafe,false);assert.deepEqual(result.scoreRanges,[{min:2,max:5}]);
 set(s,'A-24',6,0);assert.notEqual(qualification(standings(s),'A2'),'guaranteed');
});
