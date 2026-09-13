# Papercuts

## 2026-09-12 17:06 — deepseek-v4.1-flash

Остановка dev-сервера: `pkill -f 'vite --port 5177'` совпал с командной строкой
самой вызывающей оболочки (в ней была та же подстрока) и убил свой же
bash-процесс — команда завершилась таймаутом 120s, уборка после неё не
выполнилась. Обход: маскировать шаблон (`pkill -f '[v]ite --port 5177'`) или
убивать по порту через `lsof -ti :5177`.

## 2026-09-12 17:06 — deepseek-v4.1-flash

Ревью собственного патча в грязном рабочем дереве: `git diff -- <затронутые
файлы>` включает до-существующие незакоммиченные правки оператора в тех же
файлах (`src/engine/game.ts`, `src/rom/ast.ts`), поэтому патч не самодостаточен
и ревьюер пометил чужую подсистему провала заказа как расширение scope. Обход:
строить патч от базовой ревизии с изоляцией авторских хунков (временный
worktree/ветка) либо сначала закоммитить/отложить правки оператора.

## 2026-09-12 18:34 — deepseek-v4.1-flash

Браузерный смоук через Playwright: `node`-пакеты в npx-кэше
(`~/.npm/_npx/*/node_modules/playwright`, v1.62.1) требуют chromium ревизии
1234, а в `~/.cache/ms-playwright` скачана 1228 — `chromium.launch()` падает с
«Executable doesn't exist». Обход: запускать с
`executablePath: '/usr/bin/google-chrome'` (системный Chrome), тогда ревизия
бандла не важна. Альтернатива — `npx playwright install chromium` под версию
пакета.

## 2026-09-13 15:57 — deepseek-v4.1-flash

Первый деплой Pages на только что созданный репозиторий:
`actions/configure-pages@v5` с `enablement: true` падает на `Create Pages site`
с «Resource not accessible by integration» — `GITHUB_TOKEN` не может создать
сайт, автовключение не срабатывает. Обход: включить Pages вручную
(Settings → Pages → Source: GitHub Actions) либо один раз создать сайт
пользовательским токеном: `gh api -X POST repos/OWNER/REPO/pages -f
build_type=workflow`, после чего `enablement: true` уже проходит.

## 2026-09-13 15:57 — deepseek-v4.1-flash

`gh auth login` по умолчанию выдаёт scopes `gist, read:org, repo` без
`workflow`, поэтому push коммита с файлом `.github/workflows/*.yml`
отклоняется remote: «refusing to allow an OAuth App to create or update
workflow ... without `workflow` scope». Обход: заранее
`gh auth refresh -h github.com -s workflow` (снова device flow, одноразовый
код).

