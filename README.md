# 六和·星辰杯

校园足球小组赛积分、共享比分与出线推演工具，支持手机和电脑。

- 23 支队伍、6 个小组、33 场比赛；D 组 3 队，其他组 4 队。
- 胜平负积 3/1/0 分，排名只比较积分、净胜球，并列保持待定。
- 六个小组第一和最好的两个小组第二晋级，D 组不折算。
- 队员免注册查看；队内编辑口令由 Supabase 后端验证，每场显式保存。
- 个人推演不写入共享结果；可计算其余比赛固定时的最低所需比分。

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
3. 在 Supabase Edge Function Secrets 设置 EDITOR_PASSWORD、SESSION_SECRET（至少 32 个随机字符）、ALLOWED_ORIGINS=https://zhdivision.github.io。
4. 发布 supabase/functions/cup-api，verify_jwt=false；该函数独立验证口令和限时编辑会话，公开读取不要求队员注册。
5. 在 GitHub Settings → Pages 中选择 GitHub Actions。推送 main 后自动测试、构建和部署。

数据库表启用 RLS，浏览器角色无直接读写权限；服务端事务完成版本检查、更新和修改记录写入。来源白名单和口令失败限流在服务端执行。

编辑会话为 12 小时签名令牌，仅保存于当前标签页 sessionStorage（不可用时仅保留内存），退出编辑时清除。编辑口令及数据库管理密钥不进入前端，也不提交 GitHub。

## 迁移备份

migration-data/supabase-import.json 包含迁移前 23 支球队、33 场比赛及 71 条修改记录，保留演示比分标记。scripts/generate-supabase-seed.mjs 可重建导入 SQL。

测试覆盖积分与出线临界值、240 组随机比分的独立穷举比对、口令会话、来源限制、非法写入、真实 PostgreSQL 引擎中的版本冲突、审计原子性、取消结果和匿名权限拒绝。

