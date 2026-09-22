// Turns raw counts into a fully-described snapshot: statuses, bar widths, hero, flags, Slack text.
// Browser-safe (no Node imports) so preview/index.html can reuse it.

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const tasks = (n) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;

export function formatDate(date, timezone) {
  // "17 сентября 2026" without the trailing " г." that ru-RU adds
  const parts = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('day')} ${get('month')} ${get('year')}`;
}

function statusFor(count, thresholds) {
  if (count === 0) return 'empty';
  if (count >= thresholds.overload) return 'overload';
  if (count >= thresholds.watch) return 'watch';
  return 'stable';
}

export function buildSnapshot(config, raw, now = new Date()) {
  const d = config.defaults;
  const risks = { idleQueueMin: 3, lowProgressShare: 0.1, wipMax: 4, dryMaxOpen: 2, ...(d.risks || {}) };
  const byId = {};
  const sections = [];

  // First pass: person rows (have jql)
  for (const section of config.sections) {
    for (const row of section.rows) {
      if (row.divider || !row.jql) continue;
      const count = raw.counts[row.id];
      if (typeof count !== 'number') throw new Error(`no count collected for row ${row.id}`);
      const thresholds = { ...d.thresholds, ...(row.thresholds || {}) };
      const scale = row.scale || d.scale;
      const inProgress = raw.inProgress[row.id];
      byId[row.id] = {
        ...row,
        count,
        inProgress: typeof inProgress === 'number' ? inProgress : null,
        stale: raw.stale[row.id],
        breakdown: raw.breakdown[row.id],
        components: raw.components[row.id],
        status: statusFor(count, thresholds),
        width: Math.min(100, Math.round((count / scale) * 100)),
        widthProgress: Math.min(100, Math.round(((inProgress || 0) / scale) * 100)),
      };
    }
  }
  // Second pass: aggregates
  for (const section of config.sections) {
    for (const row of section.rows) {
      if (row.divider || !row.aggregateOf) continue;
      const parts = row.aggregateOf.map((id) => byId[id]);
      const count = parts.reduce((s, r) => s + r.count, 0);
      const inProgress = parts.every((r) => r.inProgress !== null) ? parts.reduce((s, r) => s + r.inProgress, 0) : null;
      const scale = row.scale || d.scale;
      byId[row.id] = {
        ...row,
        count,
        inProgress,
        status: 'aggregate',
        width: Math.min(100, Math.round((count / scale) * 100)),
        widthProgress: Math.min(100, Math.round(((inProgress || 0) / scale) * 100)),
      };
    }
  }

  // Meta text (right column) per row
  for (const r of Object.values(byId)) {
    const parts = [];
    if (r.inProgress !== null && r.inProgress !== undefined) parts.push(`${r.inProgress} в работе`);
    if (r.breakdown) parts.push(r.breakdown.map((b) => `${b.count} ${b.label}`).join(' · '));
    if (typeof r.stale === 'number') {
      parts.push(r.stale > 0 ? `${r.stale} старше ${config.staleDays}д` : `все моложе ${config.staleDays}д`);
    }
    r.meta = parts.join(' · ');
  }

  // Sections with flags
  for (const section of config.sections) {
    const rows = section.rows.map((r) => (r.divider ? { divider: true } : byId[r.id]));
    const flags = [];

    for (const r of rows) {
      if (r.divider || r.status === 'aggregate') continue;
      const who = r.shortName || r.person;
      // Wording avoids Russian case endings on surnames (nominative only).
      // `text` goes on the image, `short` is the one-liner for the Slack caption (slack: false = image only).
      if (r.status === 'overload') {
        const limit = r.thresholds?.overload ?? d.thresholds.overload;
        flags.push({
          kind: 'warn',
          text: `${who}: ${tasks(r.count)} в открытых статусах — выше порога ${limit}.`,
          short: `${who}: ${tasks(r.count)} в открытых статусах, выше порога ${limit}.`,
        });
      }
      if (typeof r.stale === 'number' && r.stale > 0) {
        flags.push({
          kind: 'warn',
          text: `${who}: ${r.stale} из ${r.count} открытых задач созданы больше ${config.staleDays} дней назад — похоже на залежавшийся беклог, а не активную нагрузку.`,
          short: `${who}: ${r.stale} из ${r.count} задач старше ${config.staleDays} дней.`,
        });
      }
      if (r.count === 0) {
        flags.push({
          kind: 'info',
          text: `${who}: ноль открытых задач в Jira — либо работа не трекается здесь, либо сейчас реально нет назначенных задач.`,
          short: `${who}: ноль открытых задач в Jira.`,
        });
      }
      if (r.components) {
        const top = Object.entries(r.components).sort((a, b) => b[1] - a[1]).slice(0, 3);
        flags.push({
          kind: 'info',
          text: `По компонентам: ${top.map(([k, v]) => `${k} — ${v}`).join(', ')} (из ${r.count}).`,
          slack: false,
        });
        // Unassigned queue above its watch threshold
        const watch = r.thresholds?.watch ?? d.thresholds.watch;
        if (r.count >= watch) {
          flags.push({
            kind: 'warn',
            text: `${r.label}: ${tasks(r.count)} без исполнителя — выше порога ${watch}.`,
            short: `${r.label}: ${tasks(r.count)} без исполнителя, выше порога ${watch}.`,
          });
        }
        continue; // ratio rules below are for people, not for the unassigned queue
      }

      // --- Ratio risks: open vs in progress ---
      if (r.inProgress === null || r.inProgress === undefined) continue;
      const watch = r.thresholds?.watch ?? d.thresholds.watch;
      if (r.count >= risks.idleQueueMin && r.inProgress === 0) {
        flags.push({
          kind: 'warn',
          text: `${who}: ${tasks(r.count)} в очереди и ни одной в работе — либо ничего не начато, либо статусы не двигаются.`,
          short: `${who}: ${tasks(r.count)} в очереди, ни одной в работе.`,
        });
      } else if (r.count >= watch && r.inProgress / r.count < risks.lowProgressShare) {
        const pct = Math.round((r.inProgress / r.count) * 100);
        flags.push({
          kind: 'warn',
          text: `${who}: в работе только ${r.inProgress} из ${r.count} (${pct}%) — очередь копится быстрее, чем разбирается.`,
          short: `${who}: в работе только ${r.inProgress} из ${r.count} (${pct}%), очередь копится.`,
        });
      }
      if (r.inProgress > risks.wipMax) {
        flags.push({
          kind: 'warn',
          text: `${who}: ${r.inProgress} задач одновременно в работе — больше ${risks.wipMax}, есть риск, что ни одна не закрывается.`,
          short: `${who}: ${r.inProgress} задач одновременно в работе, больше ${risks.wipMax}.`,
        });
      }
    }

    // Lead-vs-team pattern for 3D + seniors running dry
    if (section.id === '3d') {
      const lead = byId['3d-lead'];
      const seniors = rows.filter((r) => !r.divider && r.sub && r.id !== '3d-lead');
      const seniorSum = seniors.reduce((s, r) => s + r.count, 0);
      if (lead && lead.count > seniorSum) {
        flags.push({
          kind: 'info',
          text: `У лида (${lead.shortName}) открытых задач больше, чем у всех Senior вместе (${lead.count} vs ${seniorSum}). Стоит проверить: это реальная production-нагрузка на лида или задачи, которые пора раскидать на команду.`,
          short: `${lead.shortName}: у лида задач больше, чем у всех Senior вместе (${lead.count} vs ${seniorSum}).`,
        });
      }
      const dry = seniors.filter((r) => r.inProgress !== null && r.count > 0 && r.count <= risks.dryMaxOpen && r.inProgress === r.count);
      if (dry.length) {
        const names = dry.map((r) => r.shortName || r.person).join(', ');
        const queue = Object.values(byId).find((r) => r.componentBreakdown);
        const tail = queue && queue.count > 0 ? ` При этом в очереди art ${tasks(queue.count)} без исполнителя.` : '';
        flags.push({
          kind: 'warn',
          text: `${names}: вся очередь уже в работе, следующих задач нет.${tail}`,
          short: `${names}: следующих задач нет, всё уже в работе.${tail}`,
        });
      }
    }

    sections.push({ id: section.id, title: section.title, note: section.note, rows, flags, legend: section.id === 'narrow' });
  }

  // Hero: biggest personal queue
  const people = Object.values(byId).filter((r) => r.jql && !r.componentBreakdown);
  const top = people.reduce((a, b) => (b.count > a.count ? b : a));
  let heroDetail = `${top.label} (${top.person}) — ${tasks(top.count)} в открытых статусах`;
  if (top.inProgress !== null && top.inProgress !== undefined) heroDetail += `, из них ${top.inProgress} в работе`;
  heroDetail += '.';
  if (typeof top.stale === 'number') {
    heroDetail += top.stale > 0
      ? ` ${top.stale} ${plural(top.stale, 'задача создана', 'задачи созданы', 'задач созданы')} больше ${config.staleDays} дней назад.`
      : ` Все созданы за последние ${config.staleDays} дней.`;
  }

  const dateLabel = formatDate(now, config.timezone);

  return {
    generatedAt: now.toISOString(),
    dateLabel,
    title: 'Снимок нагрузки на конец дня',
    subtitle: 'PG3D Art · проекты PROD + CON, статусы «К выполнению» / «В работе» / «Отзыв»',
    badge: `Данные Jira на конец дня · ${dateLabel}`,
    hero: { number: top.count, label: 'Самая большая очередь открытых задач', detail: heroDetail, status: top.status },
    sections,
    capacity: config.capacity,
    footnote: [
      `Все числа — снимок Jira на ${dateLabel} (JQL по PROD + CON). PROD: «К выполнению»/«В работе»; CON: всё, что не Done, включая «Отзыв».`,
      `Порог «старой» задачи — ${config.staleDays} дней от создания (пока считается только для 2D).`,
      'Capacity лидов — ручной ввод из config.json, не связан с worklogs.',
    ],
    byId,
  };
}

/** Caption under the image: header + warning flags only, all numbers live on the picture. */
export function slackCaption(snap) {
  const lines = [`*PG3D Art · нагрузка на конец дня · ${snap.dateLabel}*`, ''];
  const flags = snap.sections.flatMap((s) => s.flags).filter((f) => f.slack !== false);
  if (flags.length === 0) lines.push('Без предупреждений, подробности на картинке.');
  else lines.push('ОБРАТИТЬ ВНИМАНИЕ');
  for (const f of flags) {
    const s = f.short || f.text;
    // "Фамилия: текст" -> "*Фамилия*: текст", no icon prefix
    lines.push(s.replace(/^([^:]+): /, '*$1*: '));
  }
  return lines.join('\n');
}
