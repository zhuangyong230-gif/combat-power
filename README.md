# 个人战斗力成长系统

纯静态手机网页，使用 HTML/CSS/JavaScript 和 LocalStorage 保存数据。可选配置 Supabase 后支持账号登录和跨浏览器同步。

## 本地打开

直接打开 `index.html` 即可使用。也可以启动静态服务：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/`。

## GitHub Pages 发布

1. 在 GitHub 创建一个仓库，例如 `combat-power`。
2. 把本目录文件推送到仓库的 `main` 分支。
3. 仓库里已包含 `.github/workflows/pages.yml`，推送后会用 GitHub Actions 发布 Pages。
4. 发布完成后网址通常是：

```text
https://你的用户名.github.io/combat-power/
```

## 账号同步配置

跨浏览器同步需要一个轻量云端。当前实现使用 Supabase Auth + 一张 JSON 表，前端仍然部署在 GitHub Pages，不需要自己写服务器。

1. 在 Supabase 新建项目。
2. 进入 SQL Editor 执行 `supabase-setup.sql`，或直接执行：

```sql
create table if not exists public.combat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.combat_profiles enable row level security;

grant select, insert, update on public.combat_profiles to authenticated;

create policy "combat_profiles_select_own"
on public.combat_profiles
for select
using (auth.uid() = user_id);

create policy "combat_profiles_insert_own"
on public.combat_profiles
for insert
with check (auth.uid() = user_id);

create policy "combat_profiles_update_own"
on public.combat_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

3. 在 Supabase 的 Project Settings / API 里复制 Project URL 和 anon public key。
4. 修改 `sync-config.js`：

```js
window.COMBAT_CLOUD_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 anon public key",
  tableName: "combat_profiles"
};
```

5. 推送到 GitHub Pages 后，页面会显示账号登录。创建账号后，同一账号的数据会自动同步。

如果使用普通账号名而不是邮箱，系统会自动转成内部邮箱格式。Supabase 默认可能要求邮箱确认；想直接账号密码登录，可以在 Supabase Auth 设置里关闭邮箱确认。

## 数据备份

未配置账号同步时，数据保存在当前设备、当前浏览器的 LocalStorage 中。配置账号同步后，本机仍会保留缓存。请定期进入「设置」页点击「导出数据」保存 JSON 备份。
