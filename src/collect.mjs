// Runs every JQL from config against Jira and returns the raw numbers keyed by row id.
// Pure I/O layer: no thresholds, no wording — that lives in model.mjs.

export function allRows(config) {
  return config.sections.flatMap((s) => s.rows).filter((r) => !r.divider);
}

function fillStale(jql, staleDays) {
  return jql.replaceAll('{staleDays}', String(staleDays));
}

/** "project = PROD AND ..." -> "PROD" */
export function projectOf(jql) {
  const m = /project\s*=\s*"?([A-Za-z0-9_]+)"?/.exec(jql);
  return m ? m[1] : null;
}

/** JQL for the "in progress" subset of a row, using the project-specific status id. */
export function inProgressJql(row, config) {
  const byProject = config.defaults?.inProgressStatusByProject || {};
  const id = row.inProgressStatus || byProject[projectOf(row.jql)];
  return id ? `${row.jql} AND status = ${id}` : null;
}

export async function collect(config, jira) {
  const raw = { counts: {}, inProgress: {}, stale: {}, breakdown: {}, components: {} };
  const jobs = [];

  for (const row of allRows(config)) {
    if (!row.jql) continue; // aggregates are computed in model.mjs

    jobs.push(jira.count(row.jql).then((n) => (raw.counts[row.id] = n)));

    const ipJql = inProgressJql(row, config);
    if (ipJql) jobs.push(jira.count(ipJql).then((n) => (raw.inProgress[row.id] = n)));

    if (row.staleJql) {
      const jql = fillStale(row.staleJql, config.staleDays);
      jobs.push(jira.count(jql).then((n) => (raw.stale[row.id] = n)));
    }

    if (row.breakdown) {
      jobs.push(
        Promise.all(row.breakdown.map((b) => jira.count(b.jql).then((n) => ({ label: b.label, count: n })))).then(
          (list) => (raw.breakdown[row.id] = list),
        ),
      );
    }

    if (row.componentBreakdown) {
      jobs.push(
        jira.issues(row.jql, ['components']).then((issues) => {
          const groups = {};
          for (const it of issues) {
            const names = (it.fields?.components || []).map((c) => c.name).sort();
            const key = names.length ? names.join('+') : 'без компонента';
            groups[key] = (groups[key] || 0) + 1;
          }
          raw.components[row.id] = groups;
        }),
      );
    }
  }

  await Promise.all(jobs);
  return raw;
}
