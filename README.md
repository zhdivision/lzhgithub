# 六和·星辰杯

校园足球小组赛积分、共享比分与出线推演工具，支持手机和电脑。

- 23 支队伍、6 个小组、33 场比赛；D 组 3 队，其他组 4 队。
- 胜平负积 3/1/0 分；组内依次比较积分、净胜球、并列队相互战绩。循环胜负仍无法分开时保持并列。
- 六个小组第一和最好的两个小组第二晋级。最终第二名比较时，四队组扣除对垫底队成绩，D 组保留全部两场；跨组只比较有效积分、净胜球。
- 正式榜单在三轮全部结束前暂按总成绩列示，不提前考虑垫底扣除。推演将补齐的假设视作最终赛果，考虑第二名与垫底队并列的全部合法组合。
- 队员免注册查看；队内编辑口令由 Supabase 后端验证，每场显式保存。
- 个人推演不写入共享结果；可计算其余比赛固定时的最低所需比分。
- 新扣除规则可能使晋级条件不单调：更大胜利使对手垫底后，该场胜利会被扣除。推演因此计算完整可行区间，并在需要时提示不能简单理解为“至少净胜”。
- 管理员登录后可按轮次核对并提交全部比分，一次性保存和锁定。普通用户不能修改已锁定比赛；管理员可更正并留下记录。

## 访问

GitHub Pages 地址：https://zhdivision.github.io/lzhgithub/

已通过 GitHub Actions 发布。共享比分、口令会话、并发版本检查和修改记录已完成线上验证。

## 开发与验证

需要 Node.js 22.13 以上。

```sh
npm ci
# 将 .env.example 复制为 .env.local，其中只有公开 API 地址
npm run dev
npm test
npm run typecheck
npm run build
```

网页使用 React / TypeScript / Vite，Supabase Edge Functions 提供接口，PostgreSQL 保存数据。

## 后端部署

目标 Supabase 项目：snqwfrxgnkbnxqquyanq。

1. 应用 supabase/migrations 中的数据库迁移，检查现有表以避免重名。
2. 导入 supabase/seed.sql；导入采用 ON CONFLICT DO NOTHING，不覆盖后续编辑。
3. 在 Supabase Edge Function Secrets 设置 EDITOR_PASSWORD、独立的 ADMIN_PASSWORD（至少 12 位）、SESSION_SECRET（至少 32 个随机字符）、ALLOWED_ORIGINS=https://zhdivision.github.io。
4. 发布 supabase/functions/cup-api，verify_jwt=false；该函数独立验证口令和限时编辑会话，公开读取不要求队员注册。
5. 在 GitHub Settings → Pages 中选择 GitHub Actions。推送 main 后自动测试、构建和部署。

数据库表启用 RLS，浏览器角色无直接读写权限；服务端事务完成版本检查、更新和修改记录写入。来源白名单和口令失败限流在服务端执行。

## 每周管理员提交

点击页面右上角“管理员”，使用独立管理员口令登录，在“轮次提交”选择第 1/2/3 轮。每轮应有 11 场且每队最多一场；轮次未确认或赛程不完整时须先补齐。核对全部比分并勾选确认后提交，系统同时将该轮比赛标为已结束、清除演示标记并锁定。

任一比赛版本冲突、比分非法、缺少场次或轮次已被其他管理员提交，都会整轮失败，须重新载入核对。普通用户不能通过移动轮次绕过锁定；即使管理员调整轮次，比赛自身的锁定仍然保留。管理员个人更正或重新提交会保留审计记录。不会依据日期或现有演示比分自动锁定。

编辑会话为 12 小时签名令牌，仅保存于当前标签页 sessionStorage（不可用时仅保留内存），退出编辑时清除。编辑口令及数据库管理密钥不进入前端，也不提交 GitHub。

## 迁移备份

migration-data/supabase-import.json 包含迁移前 23 支球队、33 场比赛及 71 条修改记录，保留演示比分标记。scripts/generate-supabase-seed.mjs 可重建导入 SQL。

测试覆盖积分与出线临界值、240 组随机比分的独立穷举比对、口令会话、来源限制、非法写入、真实 PostgreSQL 引擎中的版本冲突、审计原子性、取消结果和匿名权限拒绝。
