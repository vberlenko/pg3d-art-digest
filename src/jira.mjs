// Jira Cloud REST v3 client: only what the digest needs (counts + light issue lists).
// Auth: Basic (email:apiToken). Token is read from env by the caller, never logged.

const RETRIES = 3;

export function makeJira({ baseUrl, email, token }) {
  if (!email || !token) throw new Error('JIRA_EMAIL / JIRA_API_TOKEN are not set');
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  async function call(path, { method = 'GET', body } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 1500 * attempt;
        lastErr = new Error(`Jira ${res.status} on ${path}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`Jira ${res.status} on ${path}: ${(await res.text()).slice(0, 500)}`);
      return res.json();
    }
    throw lastErr;
  }

  /** Exact-enough count for small result sets (Jira's approximate-count is precise below ~thousands). */
  async function count(jql) {
    const r = await call('/rest/api/3/search/approximate-count', { method: 'POST', body: { jql } });
    return r.count;
  }

  /** All issues for a JQL with the given fields (paginates with nextPageToken). */
  async function issues(jql, fields = ['summary']) {
    const out = [];
    let nextPageToken;
    do {
      const r = await call('/rest/api/3/search/jql', {
        method: 'POST',
        body: { jql, fields, maxResults: 100, nextPageToken },
      });
      out.push(...(r.issues || []));
      nextPageToken = r.nextPageToken;
    } while (nextPageToken);
    return out;
  }

  return { count, issues };
}

/** Offline stand-in: answers from sample/counts.json (used by --sample and by preview/). */
export function makeSampleJira(sample) {
  return {
    async count(jql) {
      if (!(jql in sample.byJql)) throw new Error(`sample has no count for JQL: ${jql}`);
      return sample.byJql[jql];
    },
    async issues(jql) {
      const list = sample.issuesByJql?.[jql];
      if (!list) throw new Error(`sample has no issues for JQL: ${jql}`);
      return list;
    },
  };
}
