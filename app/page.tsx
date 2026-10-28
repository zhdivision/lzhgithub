'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Calculator, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Copy, Flag, History, LockKeyhole, LogOut, Pencil, Radio, RefreshCw, RotateCcw, Save, ShieldCheck, Star, Trophy, WifiOff, X } from 'lucide-react';
import { GROUPS, compare, deductionActive, hasResult, qualification, runnerUpComparisons, secondCandidates, solveMinimum, standings, type Group, type Match, type Snapshot, type Standing, type Team } from '@/lib/tournament';
import { request } from '../pages/api';
import { AdminRounds } from '../components/AdminRounds';

type Tab = 'groups' | 'seconds' | 'simulation' | 'admin';
const STAGES = ['小组赛第一轮', '小组赛第二轮', '小组赛第三轮', '1/4决赛', '半决赛', '决赛'] as const;
// Keep round one before November 6 (Beijing time). Later transition dates have
// not been announced: do not infer a switch on November 6 or from match scores.
const CURRENT_STAGE = 0;
type Audit = { id: string; before: Match | Team; after: Match | Team; kind: 'match' | 'team'; at: string };
const copyData = (s: Snapshot) => structuredClone(s);
const scoreText = (m: Match) => hasResult(m) ? `${m.homeScore} : ${m.awayScore}` : '— : —';
const dateText = (s: string | null) => s ? new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '开赛时间待确认';
const statusText = { unplayed: '未开始', live: '进行中', finished: '已结束' };
const versionKey = (s: Snapshot) => [...s.teams, ...s.matches].map(v => `${v.id}:${v.version}`).join('|');
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
 return <dialog ref={ref} className="dialog" aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</dialog>;
}

export default function Home() {
 const [data, setData] = useState<Snapshot | null>(null), [networkError, setNetworkError] = useState(''), [lastSync, setLastSync] = useState<Date | null>(null);
 const [standingsOpen, setStandingsOpen] = useState(true);
 const [tab, setTab] = useState<Tab>('groups'), [selectedGroup, setSelectedGroup] = useState<Group>('A'), [focusedTeam, setFocusedTeam] = useState('');
 const [isEditor, setIsEditor] = useState(false), [loginOpen, setLoginOpen] = useState(false), [password, setPassword] = useState(''), [loginError, setLoginError] = useState(''), [loggingIn, setLoggingIn] = useState(false);
 const [isAdmin, setIsAdmin] = useState(false), [loginRole, setLoginRole] = useState<'editor'|'admin'>('editor');
 const [notice, setNotice] = useState(''), [rulesOpen, setRulesOpen] = useState(false), [editingMatch, setEditingMatch] = useState<Match | null>(null), [editingTeam, setEditingTeam] = useState<Team | null>(null);
 const [scenario, setScenario] = useState<Snapshot | null>(null), [scenarioBase, setScenarioBase] = useState(''), [scenarioGroup, setScenarioGroup] = useState<Group>('A');
 const [simulationTeam, setSimulationTeam] = useState('A1'), [targetId, setTargetId] = useState('A-12'), [opponentGoals, setOpponentGoals] = useState('0'), [attempted, setAttempted] = useState(false);
 const syncing = useRef(false);
 const load = useCallback(async () => {
  if (syncing.current) return;
  syncing.current = true;
  try { const next = await request<Snapshot>('/api/tournament'); setData(next); setLastSync(new Date()); setNetworkError(''); }
  catch (e) { setNetworkError((e as Error).message); }
  finally { syncing.current = false; }
 }, []);
 useEffect(() => {
  load(); request<{ editor: boolean; admin?: boolean }>('/api/session').then(r => { setIsEditor(r.editor); setIsAdmin(!!r.admin); }).catch(() => {});
  try { setFocusedTeam(localStorage.getItem('xingchen-team') || ''); } catch {}
  const sessionExpired = () => { setIsEditor(false); setIsAdmin(false); };
  const timer = setInterval(load, 5000); window.addEventListener('online', load);
  window.addEventListener('cup-session-expired', sessionExpired);
  return () => { clearInterval(timer); window.removeEventListener('online', load); window.removeEventListener('cup-session-expired', sessionExpired); };
 }, [load]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
 useEffect(() => { if (tab === 'admin' && !isAdmin) setTab('groups'); }, [tab, isAdmin]);
 const focusTeam = (id: string) => { setFocusedTeam(id); try { localStorage.setItem('xingchen-team', id); } catch {} };
 const groups = useMemo(() => data ? standings(data) : null, [data]);
 const simGroups = useMemo(() => scenario ? standings(scenario, { deductBottom: deductionActive(scenario, true) }) : null, [scenario]);
 const solverResult = useMemo(() => {
  if (!attempted || !scenario || !/^\d+$/.test(opponentGoals) || Number(opponentGoals) > 1_000_000_000) return null;
  try { return solveMinimum(scenario, simulationTeam, targetId, Number(opponentGoals)); } catch { return null; }
 }, [attempted, scenario, simulationTeam, targetId, opponentGoals]);
 const startSimulation = () => {
  if (!data) return;
  if (!scenario) { setScenario(copyData(data)); setScenarioBase(versionKey(data)); const team = data.teams.find(t => t.id === focusedTeam) || data.teams[0]; selectSimulationTeam(team.id); }
  setTab('simulation');
 };
 const selectSimulationTeam = (id: string) => { setSimulationTeam(id); setScenarioGroup(id[0] as Group); setTargetId(data?.matches.find(m => [m.home, m.away].includes(id) && m.status !== 'finished')?.id || data?.matches.find(m => [m.home, m.away].includes(id))?.id || 'A-12'); setAttempted(false); };
 const resetScenario = () => { if (!data) return; setScenario(copyData(data)); setScenarioBase(versionKey(data)); setAttempted(false); setNotice('已重新载入当前共享比分'); };
 const updateScenario = (match: Match) => setScenario(current => current ? { ...current, matches: current.matches.map(m => m.id === match.id ? match : m) } : current);
 const editShared = (m: Match) => { if (m.locked && !isAdmin) { setNotice('本场已由管理员锁定，普通用户不能修改；个人推演仍可调整。'); return; } if (!isEditor) { setLoginRole('editor'); setLoginOpen(true); return; } setEditingMatch(m); };
 const scrollToMatches = (g: Group) => { setSelectedGroup(g); setTimeout(() => document.getElementById('fixtures')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
 const logIn = async (e: React.FormEvent) => {
  e.preventDefault(); setLoggingIn(true); setLoginError('');
  try { const result = await request<{admin:boolean}>('/api/session', { method: 'POST', body: JSON.stringify({ password, role: loginRole }) }); setIsEditor(true); setIsAdmin(result.admin); setPassword(''); setLoginOpen(false); if (result.admin) setTab('admin'); setNotice(result.admin ? '管理员已登录，可提交并锁定整轮结果' : '已开启编辑，可录入未锁定比分'); }
  catch (e) { setLoginError((e as Error).message); } finally { setLoggingIn(false); }
 };
 const logOut = async () => { try { await request('/api/session', { method: 'DELETE' }); setIsEditor(false); setIsAdmin(false); if (tab === 'admin') setTab('groups'); setNotice('已退出编辑'); } catch (e) { setNotice((e as Error).message); } };
 const copyLink = async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname); setNotice('分享链接已复制'); } catch { setNotice('可复制浏览器地址栏中的链接分享'); } };

 const complete = data?.matches.filter(m => m.status === 'finished').length || 0, live = data?.matches.filter(m => m.status === 'live').length || 0;
 const allFinished = !!data && complete === data.matches.length;
 const selected = data?.teams.find(t => t.id === focusedTeam);
 const rowStatus = (t: Standing, simulated = false) => {
  const currentGroups = simulated ? simGroups : groups;
  if (!currentGroups || !t.played) return { label: '等待比赛', cls: 'muted' };
  const q = qualification(currentGroups, t.id);
  if (q === 'guaranteed') return { label: simulated ? '假设晋级区' : allFinished ? '已出线' : '暂列晋级区', cls: 'green' };
  if (q === 'possible') return { label: '并列待定', cls: 'amber' };
  return { label: simulated ? '假设未晋级' : allFinished ? '未出线' : '暂未晋级', cls: 'muted' };
 };
 function GroupCard({ group, simulated = false }: { group: Group; simulated?: boolean }) {
  const current = simulated ? scenario! : data!, currentGroups = simulated ? simGroups! : groups!;
  const fixtures = current.matches.filter(m => m.group === group), done = fixtures.filter(m => m.status === 'finished').length;
  return <section className="group-card"><div className="group-card-head"><div className="group-title"><span className="group-letter">{group}</span><div><h3>{group} 组</h3><span>{currentGroups[group].length} 支球队 · {fixtures.length} 场比赛</span></div></div><span className="subtle-pill">{done}/{fixtures.length} 已结束</span></div>
   <table className="standings"><caption className="sr-only">{group}组积分榜，按积分、净胜球、胜负关系排序</caption><thead><tr><th className="rank-col">排名</th><th className="team-col">球队</th><th>赛</th><th className="extended">胜</th><th className="extended">平</th><th className="extended">负</th><th className="extended">进</th><th className="extended">失</th><th>净胜</th><th className="points-col">积分</th></tr></thead><tbody>{currentGroups[group].map(t => { const status = rowStatus(t, simulated); return <tr key={t.id} className={[status.cls === 'green' ? 'advancing-team' : status.cls === 'amber' ? 'tied-team' : '', t.id === focusedTeam ? 'my-team' : ''].join(' ')}><td className="rank-col"><span className={t.rankMin === 1 && t.rankMax === 1 ? 'rank first' : 'rank'}>{t.rankMin}{t.rankMax > t.rankMin ? '=' : ''}</span></td><td className="team-col"><div className="team-name">{t.name}{t.id === focusedTeam && <Star size={11} fill="currentColor"/>}{!simulated && isEditor && <button className="tiny-edit" aria-label={`修改${t.name}队名`} onClick={() => setEditingTeam(t)}><Pencil size={12}/></button>}</div><div className={`team-sub ${status.cls}`}>{status.label}</div><div className="mobile-stats">胜{t.won} 平{t.drawn} 负{t.lost} · 进{t.gf} 失{t.ga}</div></td><td>{t.played}</td><td className="extended">{t.won}</td><td className="extended">{t.drawn}</td><td className="extended">{t.lost}</td><td className="extended">{t.gf}</td><td className="extended">{t.ga}</td><td className={t.gd > 0 ? 'green strong' : ''}>{t.gd > 0 ? '+' : ''}{t.gd}</td><td className="points-col"><strong>{t.points}</strong></td></tr>; })}</tbody></table>
   {!simulated && <button className="group-footer" onClick={() => scrollToMatches(group)}>查看赛程与比分 <ArrowRight size={14}/></button>}
  </section>;
 }
 function SecondsTable({ simulated = false }: { simulated?: boolean }) {
  const g = simulated ? simGroups! : groups!;
  const adjusted = deductionActive(simulated ? scenario! : data!, simulated);
  const candidates = GROUPS.flatMap(group => runnerUpComparisons(g, group)).sort((a, b) => compare(b, a) || a.id.localeCompare(b.id));
  const unique = GROUPS.every(group => runnerUpComparisons(g, group).length === 1);
  return <div className="seconds-panel"><div className="section-head"><div><h2>最佳小组第二</h2><p>{adjusted ? '按最终赛果扣除垫底队成绩后，比较积分、净胜球。' : '三轮尚未全部结束，当前按总积分、总净胜球暂列。'}</p></div><span className="tag green-tag"><Trophy size={14}/>2 个晋级名额</span></div>
   <div className="info-box"><CircleHelp size={16}/><span>{adjusted ? '四队小组扣除对垫底队的成绩；D 组保留全部两场。' : '正式榜单目前不计算扣除垫底队；最终扣除规则可在出线推演中查看。'}{!unique && ' 存在组内并列或不同扣除方案，以下保留所有有效候选；同队多行不额外占晋级名额。'}</span></div>
   <div className="second-table-wrap"><table className="standings second-table"><thead><tr><th>位置</th><th className="team-col">球队</th><th>小组</th><th>有效场次</th><th className="extended">扣除对手</th><th>净胜</th><th>积分</th><th className="extended">当前形势</th></tr></thead><tbody>{candidates.map(t => {
    const fixed = secondCandidates(g, t.group).length === 1;
    const worst = GROUPS.filter(group => group !== t.group && runnerUpComparisons(g, group).some(o => compare(o, t) >= 0)).length;
    const best = GROUPS.filter(group => group !== t.group && runnerUpComparisons(g, group).every(o => compare(o, t) > 0)).length;
    const secure = fixed && qualification(g, t.id) === 'guaranteed';
    const label = !fixed ? '组内第二待定' : secure ? (simulated ? '假设晋级区' : allFinished ? '已出线' : '暂列晋级区') : best < 2 ? '晋级或扣除方案待定' : '本方案暂未晋级';
    const rank = 1 + best;
    const excluded = !adjusted ? '暂不扣除' : t.group === 'D' ? 'D组保留两场' : t.excludedTeamIds.map(id => data!.teams.find(team => team.id === id)?.name).join(' / ');
    return <tr key={`${t.id}:${t.points}:${t.gd}:${t.played}`} className={`${secure ? 'in-zone' : ''} ${t.id === focusedTeam ? 'my-team' : ''}`}><td><span className={`rank ${secure ? 'first' : ''}`}>{unique ? `${rank}${worst + 1 > rank ? '=' : ''}` : '—'}</span></td><td className="team-col"><div className="team-name">{t.name}</div><div className="comparison-team-note">{adjusted ? `原 ${t.totalPoints} 分 · 净胜 ${t.totalGd}；${t.group === 'D' ? excluded : `扣除：${excluded}`}` : label}</div></td><td><span className="mini-group">{t.group}</span></td><td>{t.played}</td><td className="extended comparison-opponent">{excluded}</td><td>{t.gd > 0 ? '+' : ''}{t.gd}</td><td><strong>{t.points}</strong></td><td className="extended"><span className={`tag ${secure ? 'green-tag' : ''}`}>{label}</span></td></tr>;
   })}</tbody></table></div><p className="table-note">组内先比较积分、净胜球、并列队相互战绩；仍相同保留并列。跨组第二只比较有效积分、净胜球，晋级线并列保持待定。</p>
  </div>;
 }

 return <div className="app-shell">
  <header className="site-header"><div className="header-inner"><a href="./" className="brand"><span className="brand-icon"><Trophy size={21}/></span><span>六和<span className="brand-dot">·</span>星辰杯<small>校园足球赛事看板</small></span></a><div className="header-actions"><button className="text-button share-button" onClick={copyLink}><Copy size={15}/>分享</button>{isEditor ? <><span className="editor-indicator"><ShieldCheck size={14}/>{isAdmin ? '管理员' : '编辑已开启'}</span><button className="icon-button" onClick={logOut} aria-label="退出编辑"><LogOut size={17}/></button></> : <button className="button button-dark" onClick={() => { setLoginRole('editor'); setLoginOpen(true); }}><LockKeyhole size={14}/>开启编辑</button>}</div></div></header>
  <main className="main-container">
   <section className="page-intro"><div><div className="eyebrow"><span className="small-line"/> GROUP STAGE / 小组赛</div><h1>每一分，都关乎出线<span>。</span></h1><p>记录赛场比分，掌握积分变化，让下一场更有把握。</p></div><div className="intro-right"><button className="text-button muted" onClick={() => setRulesOpen(true)}><CircleHelp size={15}/>赛制与规则</button></div></section>
   <section className="stage-panel" aria-label="当前比赛阶段">
    <div className="stage-heading"><Flag size={16}/><span>当前比赛阶段</span><strong>{STAGES[CURRENT_STAGE]}</strong></div>
    <ol className="stage-track">{STAGES.map((stage, i) => <li key={stage} className={i === CURRENT_STAGE ? 'current-stage' : ''} aria-current={i === CURRENT_STAGE ? 'step' : undefined}><span className="stage-number">{String(i + 1).padStart(2, '0')}</span><span>{stage}</span></li>)}</ol>
   </section>
   <section className="focus-banner"><div className="focus-copy"><span className="focus-star"><Star size={20}/></span><div><strong>{selected ? `正在关注 · ${selected.name}` : '关注你的球队'}</strong><p>{selected && groups ? `${selected.group} 组 · ${groups[selected.group].find(t => t.id === selected.id)?.points} 积分 · ${rowStatus(groups[selected.group].find(t => t.id === selected.id)!).label}` : '在榜单中突出显示，随时查看球队的出线形势。'}</p></div></div><div className="focus-actions"><select aria-label="关注我的队伍" value={focusedTeam} onChange={e => focusTeam(e.target.value)}><option value="">选择我的队伍</option>{data?.teams.map(t => <option key={t.id} value={t.id}>{t.group}组 · {t.name}</option>)}</select><button className="button button-green" onClick={startSimulation} disabled={!data}>推演出线 <ArrowRight size={15}/></button></div></section>
   {data?.matches.some(m => m.demo) && <div className="demo-notice" role="status"><CircleHelp size={16}/><span><strong>演示数据</strong> · 当前包含随机生成的比分与轮次，仅供预览，不代表真实赛果。</span></div>}
   <div className="nav-row"><nav className="tabs" aria-label="看板视图"><button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}><Flag size={16}/>小组积分</button><button className={tab === 'seconds' ? 'active' : ''} onClick={() => setTab('seconds')}><Trophy size={16}/>第二名比较</button><button className={tab === 'simulation' ? 'active' : ''} onClick={startSimulation}><Calculator size={16}/>出线推演</button>{isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}><ShieldCheck size={16}/>轮次提交</button>}</nav><div className="sync-status"><span className={`sync-dot ${networkError ? 'offline' : ''}`}/>{networkError ? '同步中断' : live ? `${live} 场进行中` : '每 5 秒同步'}<button className="icon-button" aria-label="立即同步" onClick={load}><RefreshCw size={13}/></button></div></div>
   {networkError && <div className="error-box" role="alert"><WifiOff size={16}/><span>{networkError}。{data ? '当前保留上次成功读取的数据。' : ''}</span><button className="text-button" onClick={load}>重试</button></div>}
   {!data || !groups ? <div className="loading-panel"><span className="loading-ball"/><h2>正在读取赛事数据</h2><p>马上就好，赛场的每一分都在这里。</p></div> : <>
   {tab === 'admin' && isAdmin && <AdminRounds data={data} onSaved={async () => { await load(); setNotice('本轮比分已提交并锁定，普通用户将无法修改。'); }}/ >}
   {tab === 'groups' && <><div className="section-head compact standings-head"><div><h2>小组积分榜 <span className="section-en">STANDINGS</span></h2><p>胜 3 分 · 平 1 分 · 负 0 分，按积分、净胜球、胜负关系排序</p></div><div className="standings-actions"><button type="button" className="standings-toggle" aria-expanded={standingsOpen} aria-controls="group-standings" onClick={() => setStandingsOpen(open => !open)}>{standingsOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}{standingsOpen ? '收起积分榜' : '展开积分榜'}</button><div className="legend"><span><i className="green-dot"/>晋级区</span><span><i className="amber-dot"/>并列待定</span></div></div></div><div id="group-standings" hidden={!standingsOpen}><div className="groups-grid">{GROUPS.map(g => <GroupCard key={g} group={g}/>)}</div></div>
    <section className="fixtures-section" id="fixtures"><div className="section-head"><div><h2>赛程与比分 <span className="section-en">MATCHES</span></h2><p>未锁定结果由队员共同维护；管理员提交后锁定，只有管理员可更正。</p></div></div><div className="fixtures-entry">{!isEditor ? <button className="button button-green score-entry-button" onClick={() => { setLoginRole('editor'); setLoginOpen(true); }}><Pencil size={18}/>录入比分<ArrowRight size={17}/></button> : <span className="tag green-tag"><ShieldCheck size={16}/>比分编辑已开启</span>}<span>{isEditor ? '选择下方比赛，点击编辑录入或更正比分。' : '输入队内口令后，即可选择比赛录入比分。'}</span></div><GroupPicker selected={selectedGroup} onSelect={setSelectedGroup}/><div className="matches-list" role="list" aria-label={`${selectedGroup}组赛程`}>{data.matches.filter(m => m.group === selectedGroup).map(m => <MatchRow key={m.id} match={m} teams={data.teams} onEdit={() => editShared(m)} isEditor={isEditor} isAdmin={isAdmin}/>)}</div></section>
   </>}
   {tab === 'seconds' && <><SecondsTable/><div className="callout"><Calculator size={22}/><div><h3>距离出线，还差几个净胜球？</h3><p>固定其他场次的假设比分，算一算你的球队需要什么结果。</p></div><button className="button button-green" onClick={startSimulation}>开始推演 <ArrowRight size={15}/></button></div></>}
   {tab === 'simulation' && scenario && simGroups && <div className="simulation-area"><div className="simulation-banner"><span><Calculator size={18}/><strong>假设推演</strong> <span className="simulation-note">修改仅保留在当前页面，不影响共享比分</span></span><button className="text-button" onClick={resetScenario}><RotateCcw size={14}/>还原共享数据</button></div>{scenarioBase !== versionKey(data) && <div className="info-box"><Radio size={16}/>共享比分已更新。当前推演仍保留原假设，可点击“还原共享数据”载入。</div>}
    <section className="solver-panel"><div className="solver-heading"><span className="solver-icon"><Calculator size={22}/></span><div><h2>算出最低所需比分</h2><p>把其余比赛视为最终赛果，扣除垫底队成绩后计算；D组保留两场。</p></div></div><div className="solver-inputs"><label>推演队伍<select value={simulationTeam} onChange={e => selectSimulationTeam(e.target.value)}>{data.teams.map(t => <option key={t.id} value={t.id}>{t.group}组 · {t.name}</option>)}</select></label><label>目标比赛<select value={targetId} onChange={e => { setTargetId(e.target.value); setAttempted(false); }}>{scenario.matches.filter(m => [m.home, m.away].includes(simulationTeam)).map(m => <option key={m.id} value={m.id}>{data.teams.find(t => t.id === m.home)?.name} vs {data.teams.find(t => t.id === m.away)?.name}</option>)}</select></label><label className="opponent-input">对手进球数<input type="number" min="0" max="1000000000" step="1" inputMode="numeric" value={opponentGoals} onChange={e => setOpponentGoals(e.target.value)}/></label><button className="button button-green calculate-button" onClick={() => setAttempted(true)}><Calculator size={16}/>计算最低比分</button></div>
    {attempted && !solverResult && <div className="error-box">请填写有效的非负整数对手进球数。</div>}
    {solverResult?.kind === 'missing' && <div className="solver-missing"><strong>还需要补齐 {solverResult.missing.length} 场假设比分</strong><p>除目标比赛外，每场都需要有已录入结果或明确假设。进行中比分也会按当前数值固定。</p><div className="missing-links">{solverResult.missing.map(id => { const m = scenario.matches.find(m => m.id === id)!; return <button key={id} onClick={() => { setScenarioGroup(m.group); document.getElementById('scenario-fixtures')?.scrollIntoView({ behavior: 'smooth' }); }}>{m.group} · {data.teams.find(t => t.id === m.home)?.name} / {data.teams.find(t => t.id === m.away)?.name}<ChevronRight size={12}/></button>; })}</div></div>}
    {solverResult?.kind === 'solved' && <div className="solver-success"><span className="tag green-tag"><ShieldCheck size={14}/>按当前假设可确保出线</span><div className="result-row"><div><span>最低可行比分 · 己方在前</span><strong>{solverResult.ownScore}<em>:</em>{solverResult.opponentScore}</strong></div><h3>{!solverResult.higherScoresSafe ? '存在有限比分区间' : solverResult.goalDifference! > 0 ? `至少净胜 ${solverResult.goalDifference} 球` : solverResult.goalDifference === 0 ? '打平即可' : `最多可输 ${-solverResult.goalDifference!} 球`}</h3></div>{!solverResult.higherScoresSafe && <div className="solver-range-warning"><strong>更多进球可能改变垫底队和扣除成绩，不一定更有利。</strong><p>可确保出线的己方进球范围（对手固定 {solverResult.opponentScore} 球）：{solverResult.scoreRanges?.map(range => range.max === null ? `${range.min} 球及以上` : range.min === range.max ? `${range.min} 球` : `${range.min}～${range.max} 球`).join('；')}。</p></div>}<p>其余比赛按当前假设固定，含进行中比赛；此结论不覆盖其他未知比分的所有可能变化。并列名次的所有可能结果均已考虑。</p><button className="text-button" onClick={() => { const target = scenario.matches.find(m => m.id === targetId)!; updateScenario({ ...target, status: 'finished', homeScore: target.home === simulationTeam ? solverResult.ownScore! : solverResult.opponentScore!, awayScore: target.away === simulationTeam ? solverResult.ownScore! : solverResult.opponentScore! }); setScenarioGroup(target.group); }}>将最低比分应用到假设 <ArrowDown size={14}/></button></div>}
    {solverResult?.kind === 'impossible' && <div className="solver-missing"><strong>按当前假设，无法仅靠这场比分确保出线</strong><p>即使增加己方进球，也无法确保进入八个晋级名额。请调整其他场次假设，或查看是否存在积分不足、晋级线并列的情况。</p></div>}
    <div className="solver-footnote"><LockKeyhole size={13}/>只有正式保存才修改共享结果；推演不会自动发布。</div></section>
    <section id="scenario-fixtures" className="scenario-fixtures"><div className="section-head"><div><h2>调整假设比分</h2><p>分组填写，榜单随比分即时重算。</p></div><button className="text-button" onClick={() => { setScenario(s => s ? { ...s, matches: s.matches.map(m => !hasResult(m) && m.id !== targetId ? { ...m, homeScore: 0, awayScore: 0, status: 'finished' } : m) } : s); }}>未填场次均假设为 0 : 0</button></div><GroupPicker selected={scenarioGroup} onSelect={setScenarioGroup}/><div className="simulation-columns"><div className="simulation-match-list" role="list" aria-label={`${scenarioGroup}组假设比分`}>{scenario.matches.filter(m => m.group === scenarioGroup).map(m => <ScenarioMatch key={`${scenarioBase}-${m.id}`} match={m} sourceStatus={data.matches.find(shared => shared.id === m.id)?.status ?? 'unplayed'} teams={data.teams} target={m.id === targetId} onChange={updateScenario}/>)}</div><GroupCard group={scenarioGroup} simulated/></div></section><SecondsTable simulated/>
   </div>}
   </>}
   <footer className="page-footer"><span>六和·星辰杯 <span className="footer-divider">/</span> 享受比赛，认真对待每一分。</span><button className="text-button" onClick={() => setRulesOpen(true)}><CircleHelp size={13}/>赛制与规则</button><span>{lastSync ? `上次同步 ${lastSync.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : '等待连接'} <span className="footer-divider">·</span> 北京时间</span></footer>
  </main>
  {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  {loginOpen && <Dialog title={loginRole === 'admin' ? '管理员登录' : '开启共享比分编辑'} onClose={() => { setLoginOpen(false); setPassword(''); setLoginError(''); }}><form onSubmit={logIn} className="dialog-body"><div className="login-roles">{(['editor','admin'] as const).map(role => <button type="button" key={role} className={loginRole === role ? 'selected' : ''} disabled={loggingIn} onClick={() => { setLoginRole(role); setPassword(''); setLoginError(''); }}>{role === 'admin' ? '管理员' : '队员编辑'}</button>)}</div><p className="muted">{loginRole === 'admin' ? '管理员可提交并锁定整轮比分，也可更正已锁定结果；更正保留记录。' : '队员可修改尚未锁定的比分；已提交结果由管理员维护。'}会话有效期为 12 小时。</p><label>{loginRole === 'admin' ? '管理员口令' : '队内编辑口令'}<input autoFocus required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入口令" disabled={loggingIn}/></label>{loginError && <div className="error-box" role="alert">{loginError}</div>}<button className="button button-green full-width" disabled={loggingIn}>{loggingIn ? '正在验证…' : '验证并登录'}<ArrowRight size={16}/></button></form></Dialog>}
  {rulesOpen && <Dialog title="赛事规则" onClose={() => setRulesOpen(false)}><div className="dialog-body rules"><p><strong>23 支球队，6 个小组，33 场比赛。</strong><br/>A、B、C、E、F 每组 4 队；D 组 3 队。组内单循环，每两队相遇一次。</p><p><strong>积分与排名</strong><br/>胜 3 分、平 1 分、负 0 分。先比积分，再比净胜球，之后比较并列队之间相互比赛的积分；仍无法区分时保留并列。</p><p><strong>8 个晋级席位</strong><br/>6 个小组第一，加成绩最好的 2 个小组第二。三轮全部结束后，四队小组的第二名扣除对垫底队的成绩，再比较积分、净胜球；D 组保留全部两场。结束前正式榜单暂按总成绩，最终扣除规则在推演中计算。</p><p><strong>即时积分与正式结果</strong><br/>进行中比分参与即时积分；未赛不计入，0 : 0 的有效结果计为平局。未全部结束时，晋级区仅代表当前比分下的位置。</p><p><strong>出线推演</strong><br/>假设比分只保存在当前页面。其余场次补齐后，按最终排名确定垫底队并扣除，再计算目标比赛所需最低比分；“确保”仅针对这些假设成立。</p><p className="muted">官方轮次和开赛时间尚待提供，可在开启编辑后逐场补充。</p></div></Dialog>}
  {editingMatch && data && <MatchEditor match={editingMatch} teams={data.teams} onClose={() => setEditingMatch(null)} onSaved={async () => { setEditingMatch(null); setNotice('比赛已保存，所有队员将同步看到'); await load(); }}/ >}
  {editingTeam && <TeamEditor team={editingTeam} onClose={() => setEditingTeam(null)} onSaved={async () => { setEditingTeam(null); setNotice('队名已保存'); await load(); }}/ >}
 </div>;
}

function GroupPicker({ selected, onSelect }: { selected: Group; onSelect: (g: Group) => void }) { return <div className="group-picker" aria-label="选择小组">{GROUPS.map(g => <button key={g} className={selected === g ? 'selected' : ''} onClick={() => onSelect(g)}>{g} 组</button>)}</div>; }
function MatchRow({ match: m, teams, onEdit, isEditor, isAdmin }: { match: Match; teams: Team[]; onEdit: () => void; isEditor: boolean; isAdmin: boolean }) {
 const home = teams.find(t => t.id === m.home)?.name, away = teams.find(t => t.id === m.away)?.name;
 return <article className={`fixture-row round-${m.round ?? 'unassigned'}`} role="listitem">
  <span className={m.round ? `fixture-round round-${m.round}` : 'fixture-round unassigned-round'}>{m.round ? `第 ${m.round} 轮` : '轮次待确认'}</span>
  <div className="fixture-scoreline"><span className="fixture-team home-team">{home}</span><strong className={hasResult(m) ? 'fixture-score' : 'fixture-score empty-score'}>{scoreText(m)}</strong><span className="fixture-team">{away}</span></div>
  <div className="fixture-details"><span className={`match-status ${m.status}`}>{m.status === 'live' && <span className="sync-dot"/>}{m.locked ? '管理员已锁定' : statusText[m.status]}</span><time dateTime={m.kickoff || undefined}>{m.kickoff ? dateText(m.kickoff) : '时间待确认'}</time></div>
  <button className="fixture-edit" onClick={onEdit} disabled={!!m.locked && !isAdmin} aria-label={`${home}对阵${away}，${m.locked ? isAdmin ? '管理员更正' : '已锁定' : isEditor ? '录入或更正比分' : '输入口令编辑'}`} title={m.locked && !isAdmin ? '只有管理员可以更正已锁定结果' : '录入 / 更正比分'}>{m.locked ? <LockKeyhole size={13}/> : <Pencil size={14}/>}<span>{m.locked ? isAdmin ? '更正' : '已锁定' : '编辑'}</span></button>
 </article>;
}
function ScenarioMatch({ match: m, sourceStatus, teams, target, onChange }: { match: Match; sourceStatus: Match['status']; teams: Team[]; target: boolean; onChange: (m: Match) => void }) {
 const change = (side: 'homeScore' | 'awayScore', text: string) => {
  if (text !== '' && (!/^\d+$/.test(text) || Number(text) > 1_000_000_000)) return;
  const next = { ...m, [side]: text === '' ? null : Number(text) };
  next.status = next.homeScore !== null && next.awayScore !== null ? 'finished' : 'unplayed'; onChange(next);
 };
 return <div className={`scenario-row round-${m.round ?? 'unassigned'} ${target ? 'target-match' : ''}`} role="listitem">
  <span className={m.round ? `fixture-round round-${m.round}` : 'fixture-round unassigned-round'}>{m.round ? `第 ${m.round} 轮` : '轮次待确认'}</span>
  <div className="scenario-scoreline">
   <span className="fixture-team home-team">{teams.find(t => t.id === m.home)?.name}</span>
   <div className="scenario-score-inputs"><input aria-label={`${m.id} ${teams.find(t => t.id === m.home)?.name}假设进球`} type="number" inputMode="numeric" min="0" step="1" value={m.homeScore ?? ''} placeholder="—" onChange={e => change('homeScore', e.target.value)}/><span>:</span><input aria-label={`${m.id} ${teams.find(t => t.id === m.away)?.name}假设进球`} type="number" inputMode="numeric" min="0" step="1" value={m.awayScore ?? ''} placeholder="—" onChange={e => change('awayScore', e.target.value)}/></div>
   <span className="fixture-team">{teams.find(t => t.id === m.away)?.name}</span>
  </div>
  <span className={`scenario-row-note ${sourceStatus}`}>{target && <span className="scenario-target-label">目标比赛</span>}{sourceStatus === 'finished' ? '已结束' : sourceStatus === 'live' ? '进行中' : '按此比分推演'}</span>
 </div>;
}
function localDate(s: string | null) { if (!s) return ''; const date = new Date(s); return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16); }
function MatchEditor({ match, teams, onClose, onSaved }: { match: Match; teams: Team[]; onClose: () => void; onSaved: () => Promise<void> }) {
 const [draft, setDraft] = useState(match), [home, setHome] = useState(match.homeScore?.toString() ?? ''), [away, setAway] = useState(match.awayScore?.toString() ?? ''), [kickoff, setKickoff] = useState(localDate(match.kickoff));
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [history, setHistory] = useState<Audit[] | null>(null);
 const save = async (e: React.FormEvent) => {
  e.preventDefault(); setError('');
  if (draft.status !== 'unplayed' && (!/^\d+$/.test(home) || !/^\d+$/.test(away))) { setError('请填写双方的非负整数比分；未赛请选择“未开始”。'); return; }
  setBusy(true);
  try { await request('/api/tournament', { method: 'PATCH', body: JSON.stringify({ kind: 'match', id: match.id, version: match.version, homeScore: draft.status === 'unplayed' ? null : Number(home), awayScore: draft.status === 'unplayed' ? null : Number(away), status: draft.status, round: draft.round, kickoff: kickoff ? new Date(kickoff + ':00+08:00').toISOString() : null }) }); await onSaved(); }
  catch (e) { const message = (e as Error).message; setError(message.includes("其他人修改") ? message + " 请关闭窗口后重新打开，以载入最新记录。" : message); } finally { setBusy(false); }
 };
 const clearResult = async () => {
  setError(''); setBusy(true);
  try {
   await request('/api/tournament', { method: 'PATCH', body: JSON.stringify({ kind: 'match', id: match.id, version: match.version, homeScore: null, awayScore: null, status: 'unplayed', round: match.round, kickoff: match.kickoff }) });
   await onSaved();
  } catch (e) {
   const message = (e as Error).message;
   setError(message.includes('其他人修改') ? message + ' 请关闭窗口后重新打开，以载入最新记录。' : message);
  } finally { setBusy(false); }
 };
 const restore = (value: Match) => { setDraft({ ...value, version: match.version }); setHome(value.homeScore?.toString() ?? ''); setAway(value.awayScore?.toString() ?? ''); setKickoff(localDate(value.kickoff)); setError('已载入旧值，点击“保存共享结果”后生效。'); };
 return <Dialog title={`${match.group} 组 · 录入比赛`} onClose={onClose}><form className="dialog-body" onSubmit={save}><p className="muted">保存后将更新所有人的积分榜，请核对双方球队。已锁定比赛仅管理员可更正，并保留修改记录。</p><div className="editor-score-row"><label>{teams.find(t => t.id === match.home)?.name}<input type="number" inputMode="numeric" min="0" max="1000000000" step="1" value={home} placeholder="—" onChange={e => setHome(e.target.value)} disabled={draft.status === 'unplayed'}/></label><span>:</span><label>{teams.find(t => t.id === match.away)?.name}<input type="number" inputMode="numeric" min="0" max="1000000000" step="1" value={away} placeholder="—" onChange={e => setAway(e.target.value)} disabled={draft.status === 'unplayed'}/></label></div><div className="form-grid"><label>比赛状态<select value={draft.status} onChange={e => { const status = e.target.value as Match['status']; setDraft({ ...draft, status }); if (status !== 'unplayed') { if (!home) setHome('0'); if (!away) setAway('0'); } }}>{Object.entries(statusText).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><label>轮次<select value={draft.round ?? ''} onChange={e => setDraft({ ...draft, round: e.target.value ? Number(e.target.value) : null })}><option value="">待确认</option>{[1, 2, 3].map(n => <option key={n} value={n}>第 {n} 轮</option>)}</select></label></div><label>开赛时间（北京时间，可留空）<input type="datetime-local" value={kickoff} onChange={e => setKickoff(e.target.value)}/></label>{draft.status === 'unplayed' && <p className="table-note">保存为“未开始”会清除比分，并从积分统计中移除本场结果。</p>}{error && <div className="error-box" role="alert">{error}</div>}<button className="button button-green full-width" disabled={busy}><Save size={16}/>{busy ? '正在保存…' : '保存共享结果'}</button><div className="clear-result-panel"><button type="button" className="button clear-result-button" onClick={clearResult} disabled={busy || (!hasResult(match) && match.status === 'unplayed')}><RotateCcw size={15}/>一键清空本场结果</button><p>立即清空共享比分，恢复为“未开始”；保留轮次、开赛时间和修改记录。</p></div><button className="text-button history-button" type="button" onClick={async () => { try { setHistory(await request<Audit[]>(`/api/history?id=${match.id}`)); } catch (e) { setError((e as Error).message); } }}><History size={14}/>查看修改记录</button>{history && <div className="history-list">{!history.length && <p className="muted">这场比赛暂无修改记录。</p>}{history.map(h => <div key={h.id}><span><strong>{scoreText(h.before as Match)} → {scoreText(h.after as Match)}</strong><small>{dateText(h.at)} · {statusText[(h.after as Match).status]}</small></span><button type="button" className="text-button" onClick={() => restore(h.before as Match)}>载入修改前值</button></div>)}</div>}</form></Dialog>;
}
function TeamEditor({ team, onClose, onSaved }: { team: Team; onClose: () => void; onSaved: () => Promise<void> }) {
 const [name, setName] = useState(team.name), [error, setError] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState<Audit[] | null>(null);
 return <Dialog title={`${team.group} 组 · 修改队名`} onClose={onClose}><form className="dialog-body" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await request('/api/tournament', { method: 'PATCH', body: JSON.stringify({ kind: 'team', id: team.id, version: team.version, name }) }); await onSaved(); } catch (e) { const message = (e as Error).message; setError(message.includes("其他人修改") ? message + " 请关闭窗口后重新打开，以载入最新记录。" : message); } finally { setBusy(false); } }}><p className="muted">修改将同步显示在比分、积分榜和推演中。</p><label>球队名称<input required maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label>{error && <div className="error-box">{error}</div>}<button className="button button-green full-width" disabled={busy}><Save size={16}/>{busy ? '正在保存…' : '保存队名'}</button><button type="button" className="text-button" onClick={async () => { try { setHistory(await request<Audit[]>(`/api/history?id=${team.id}`)); } catch (e) { setError((e as Error).message); } }}><History size={14}/>查看修改记录</button>{history?.map(h => <div className="history-entry" key={h.id}><span>{(h.before as Team).name} → {(h.after as Team).name}</span><button type="button" className="text-button" onClick={() => setName((h.before as Team).name)}>载入旧队名</button></div>)}</form></Dialog>;
}


