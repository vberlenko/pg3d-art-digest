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
  const byId = {};
  const sections = [];

  // First pass: person rows (have jql)
  for (const section of config.sections) {
    for (const row of section.rows) {
      if (row.divider || !row.jql) continue;
      const count = raw.counts[row.id];
      if (typeof count !== 'number') throw new Error(`no count collected for row ${row.id}`);
      const thresholds = { ...d.thresholds, ...(row.thresholds || {}) };
      byId[row.id] = {
        ...row,
        count,
        stale: raw.stale[row.id],
        breakdown: raw.breakdown[row.id],
        components: raw.components[row.id],
        status: statusFor(count, thresholds),
        width: Math.min(100, Math.round((count / (row.scale || d.scale)) * 100)),
      };
    }
  }
  // Second pass: aggregates
  for (const section of config.sections) {
    for (const row of section.rows) {
      if (row.divider || !row.aggregateOf) continue;
      const count = row.aggregateOf.reduce((s, id) => s + byId[id].count, 0);
      byId[row.id] = {
        ...row,
        count,
        status: 'aggregate',
        width: Math.min(100, Math.round((count / (row.scale || d.scale)) * 100)),
      };
    }
  }

  // Meta text (right column) per row
  for (const r of Object.values(byId)) {
    const parts = [];
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
      }
    }

    // Lead-vs-team pattern for 3D
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
    }

    sections.push({ id: section.id, title: section.title, note: section.note, rows, flags, legend: section.id === 'narrow' });
  }

  // Hero: biggest personal queue
  const people = Object.values(byId).filter((r) => r.jql && !r.componentBreakdown);
  const top = people.reduce((a, b) => (b.count > a.count ? b : a));
  let heroDetail = `${top.label} (${top.person}) — ${tasks(top.count)} в открытых статусах.`;
  if (typeof top.stale === 'number') {
    heroDetail += top.stale > 0
      ? ` Из них ${top.stale} созданы больше ${config.staleDays} дней назад.`
      : ` Все созданы за последние ${config.staleDays} дней.`;
  }

  const dateLabel = formatDate(now, config.timezone);

  return {
    generatedAt: now.toISOString(),
    dateLabel,
    title: 'Недельный снимок нагрузки',
    subtitle: 'PG3D Art · проекты PROD + CON, статусы «К выполнению» / «В работе» / «Отзыв»',
    badge: `Снимок на реальных данных Jira · ${dateLabel}`,
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
  const lines = [`*PG3D Art · снимок нагрузки · ${snap.dateLabel}*`, ''];
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
