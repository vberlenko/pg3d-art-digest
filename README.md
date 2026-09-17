# PG3D Art · Weekly Digest

Снимок нагрузки арт-команды из Jira → PNG-дашборд → Slack `#dev_art_leads`.
Расписание: понедельник и среда, 09:30 Ереван (05:30 UTC), через GitHub Actions.

```
Jira (JQL counts) ──► snapshot.json ──► digest.html ──► digest.png ──► Slack (картинка + текст)
   src/jira.mjs        src/model.mjs     src/render.mjs   src/png.mjs    src/slack.mjs
   src/collect.mjs
```

## Что нужно один раз

### 1. Jira API token
Создать на <https://id.atlassian.com/manage-profile/security/api-tokens> под аккаунтом, который видит проекты PROD и CON.
Секреты: `JIRA_EMAIL` (почта аккаунта), `JIRA_API_TOKEN`.

### 2. Slack-приложение
1. <https://api.slack.com/apps> → Create New App → From scratch, workspace Cubic Games.
2. OAuth & Permissions → Bot Token Scopes: `files:write`, `chat:write`.
3. Install to Workspace → скопировать `xoxb-…` в секрет `SLACK_BOT_TOKEN`.
4. В канале `#dev_art_leads` выполнить `/invite @<имя бота>` — без этого `completeUploadExternal` вернёт `not_in_channel`.

### 3. GitHub
Положить репозиторий, в Settings → Secrets and variables → Actions добавить три секрета из п.1–2.
Workflow `.github/workflows/digest.yml` уже содержит cron `30 5 * * 1,3` и ручной запуск (Run workflow → галка `dry_run`, чтобы только отрендерить без поста).

## Локальный запуск

```bash
npm install
npx playwright install --with-deps chromium
```

Без Jira и без Slack, на сохранённых цифрах (`sample/counts.json`, снимок 17.09.2026):
```bash
node src/digest.mjs --sample --dry-run
```
Результат в `out/`: `digest.png`, `digest.html`, `snapshot.json`, `slack.txt`.

Боевой прогон, но без поста в Slack (секреты передаются по имени, значения в чат/argv не попадают):
```bash
run-with-secrets --names=JIRA_EMAIL,JIRA_API_TOKEN -- node src/digest.mjs --dry-run
```

Полный прогон:
```bash
run-with-secrets --names=JIRA_EMAIL,JIRA_API_TOKEN,SLACK_BOT_TOKEN -- node src/digest.mjs
```

Флаги: `--dry-run` (не постить), `--sample` (не ходить в Jira), `--no-png` (без Playwright, только текст).
Переменная `SLACK_CHANNEL_ID` переопределяет канал из конфига — удобно для тестового канала.

## Предпросмотр вёрстки без Node
Любой статический сервер из корня проекта, затем открыть `/preview/` — страница собирает дашборд из `sample/counts.json` прямо в браузере.

## Конфиг (`config.json`)

- `sections[].rows[]` — строки отчёта. У строки-человека есть `jql`; у агрегата — `aggregateOf: [ids]`; `{ "divider": true }` — пунктирная линия.
- `thresholds.watch / overload` — с какого числа задач строка жёлтая / красная. Есть глобальные `defaults`, у строки можно переопределить. `0` задач всегда серый («нет задач»).
- `scale` — сколько задач = 100% ширины полоски (только визуал).
- `staleJql` с плейсхолдером `{staleDays}` — сейчас только у 2D; `staleDays` глобальный (60).
- `breakdown` — дополнительные счётчики в правой колонке (у Трушникова: К вып. / В работе / Отзыв).
- `componentBreakdown: true` — вытащить задачи и сгруппировать по компонентам (у очереди art).
- `capacity.leads` — ручной ввод Production / Review / Feedback для лидов, как договорились. Меняется руками.

Флаги под секциями генерируются автоматически: превышение порога, stale-задачи, ноль задач, лид с бОльшей очередью, чем все Senior вместе, разбивка очереди art по компонентам.

## Грабли, которые уже собраны

- Статусы «К выполнению»/«В работе» — project-specific ID. PROD: `10088`, `10181`. CON: `10028`, `10029`, `10250` («Отзыв»). Не переносить между проектами.
- Concept живёт в проекте `CON`, а не `PROD`.
- У Соколовой 0 задач — реальная цифра, не ошибка запроса.
- На 17.09.2026 у 2D 0 задач старше 60 дней: самая старая открытая создана 20.07.2026, старый беклог 2025 года разобран. Флаг заработает, как только появятся задачи старше порога.
- `files.upload` в Slack deprecated — используется `files.getUploadURLExternal` → POST байтов → `files.completeUploadExternal`. Если картинка не загрузилась, скрипт постит текстовую версию, чтобы дайджест не пропал.
- Счётчики берутся через `POST /rest/api/3/search/approximate-count` (старый `/search` с `total` отключён в Jira Cloud). На выборках в десятки задач он точный.

## Что ещё не сделано

- Не проверено на живых Jira/Slack токенах из этого окружения (здесь нет Node) — первый запуск делать через `workflow_dispatch` с `dry_run`, посмотреть артефакт `out/`, потом без галки.
- Дельта к прошлому снимку («+5 за неделю») — не считается; история в артефактах Actions (30 дней), можно добавить позже.
