import { useState } from 'react';
import { LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { GROUPS, type Snapshot } from '../lib/tournament';
import { request } from '../pages/api';

export function AdminRounds({ data, onSaved }: { data: Snapshot; onSaved: () => Promise<void> }) {
 const [round, setRound] = useState(1), [revision, setRevision] = useState(0);
 return <section className="admin-panel"><div className="section-head"><div><h2>管理员 · 本轮结果提交</h2><p>每周一轮。选择轮次，核对本轮全部比分后统一提交；已锁定结果仍可由管理员更正。</p></div><ShieldCheck size={25}/></div>
  <div className="group-picker" aria-label="选择提交轮次">{[1,2,3].map(value => <button key={value} className={round === value ? 'selected' : ''} onClick={() => setRound(value)}>第 {value} 轮{data.rounds?.find(r => r.round === value)?.locked ? ' · 已锁定' : ''}</button>)}</div>
  <RoundForm key={`${round}-${revision}`} data={data} round={round} onReload={() => setRevision(value => value+1)} onSaved={async () => { await onSaved(); setRevision(value => value+1); }}/>
 </section>;
}
function RoundForm({ data, round, onSaved, onReload }: { data: Snapshot; round: number; onSaved: () => Promise<void>; onReload: () => void }) {
 const [draft, setDraft] = useState(() => data.matches.filter(match => match.round === round).map(match => ({ ...match, home: match.homeScore?.toString() ?? '', away: match.awayScore?.toString() ?? '', homeId: match.home, awayId: match.away })));
 const [version] = useState(data.rounds?.find(item => item.round === round)?.version || 0);
 const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
 const state = data.rounds?.find(item => item.round === round);
 const changed = (state?.version || 0) !== version || draft.some(match => data.matches.find(current => current.id === match.id)?.version !== match.version) || data.matches.filter(match => match.round === round).length !== draft.length;
 const expected = GROUPS.reduce((sum, group) => sum + Math.floor(data.teams.filter(team => team.group === group).length/2), 0);
 const submit = async (event: React.FormEvent) => {
  event.preventDefault(); setError('');
  if (!confirmed || draft.length !== expected || draft.some(match => ![match.home,match.away].every(score => /^\d+$/.test(score) && Number(score) <= 1_000_000_000))) { setError('请确认赛程完整，为每场填写双方比分，并勾选核对确认。'); return; }
  setBusy(true);
  try { await request('/api/rounds/submit', { method: 'POST', body: JSON.stringify({ round, version, confirmed: true, matches: draft.map(match => ({ id: match.id, version: match.version, homeScore: Number(match.home), awayScore: Number(match.away) })) }) }); await onSaved(); }
  catch (error) { setError((error as Error).message); } finally { setBusy(false); }
 };
 return <form onSubmit={submit} className="admin-round-form">
  <div className="admin-round-summary"><strong>第 {round} 轮 · {draft.length}/{expected} 场</strong><span>{state?.locked ? `已锁定 · 上次提交 ${new Date(state.submittedAt!).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false})}` : '尚未由管理员提交'}</span><button type="button" className="text-button" onClick={onReload} disabled={busy}><RefreshCw size={14}/>载入最新比分</button></div>
  {changed && <div className="error-box">共享结果已变化。请载入最新比分并重新核对；载入会替换当前未提交的草稿。</div>}
  {draft.length !== expected && <div className="error-box">本轮应有 {expected} 场比赛。请先在“赛程与比分”中核对每场轮次，系统不会自行编排。</div>}
  {draft.some(match => match.demo) && <div className="info-box">当前含演示比分，请替换为真实结果后提交。提交会将本轮全部比赛标为已结束，并清除演示标记。</div>}
  <div className="admin-fixtures">{draft.map((match,index) => <div className="admin-fixture" key={match.id}><span className="mini-group">{match.group}</span><span className="admin-team home-team">{data.teams.find(team => team.id === match.homeId)?.name}</span><div className="admin-score"><input required aria-label={`${match.id} 主队正式进球`} type="number" min="0" max="1000000000" step="1" inputMode="numeric" value={match.home} disabled={busy} onChange={event => setDraft(current => current.map((item,i) => i === index ? {...item,home:event.target.value} : item))}/><span>:</span><input required aria-label={`${match.id} 客队正式进球`} type="number" min="0" max="1000000000" step="1" inputMode="numeric" value={match.away} disabled={busy} onChange={event => setDraft(current => current.map((item,i) => i === index ? {...item,away:event.target.value} : item))}/></div><span className="admin-team">{data.teams.find(team => team.id === match.awayId)?.name}</span>{match.locked && <LockKeyhole size={13} aria-label="管理员已锁定"/>}</div>)}</div>
  <label className="admin-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/><span>我已核对本轮全部比分。提交后普通用户将无法修改；管理员更正会保留记录。</span></label>
  {error && <div className="error-box" role="alert">{error}</div>}
  <button className="button button-green" disabled={busy || !confirmed || changed || draft.length !== expected}><LockKeyhole size={15}/>{busy ? '正在提交…' : state?.locked ? '重新提交本轮并保持锁定' : '提交本轮全部比分并锁定'}</button>
 </form>;
}
