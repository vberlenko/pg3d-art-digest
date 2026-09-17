#!/usr/bin/env node
// PG3D Art weekly digest: Jira counts -> snapshot -> HTML -> PNG -> Slack.
//
//   node src/digest.mjs                 # full run (needs JIRA_EMAIL, JIRA_API_TOKEN, SLACK_BOT_TOKEN)
//   node src/digest.mjs --dry-run       # everything except posting to Slack; files land in out/
//   node src/digest.mjs --sample        # no Jira: use sample/counts.json (combine with --dry-run)
//   node src/digest.mjs --no-png        # skip Playwright (text-only post / quick check)
//
// Env: JIRA_EMAIL, JIRA_API_TOKEN, SLACK_BOT_TOKEN, optional SLACK_CHANNEL_ID (overrides config).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJira, makeSampleJira } from './jira.mjs';
import { collect } from './collect.mjs';
import { buildSnapshot, slackText } from './model.mjs';
import { renderHtml } from './render.mjs';
import { uploadFile, postMessage } from './slack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const SAMPLE = args.has('--sample');
const NO_PNG = args.has('--no-png');

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  const config = JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8'));
  const outDir = resolve(root, 'out');
  await mkdir(outDir, { recursive: true });

  // 1. Collect
  const jira = SAMPLE
    ? makeSampleJira(JSON.parse(await readFile(resolve(root, 'sample/counts.json'), 'utf8')))
    : makeJira({ baseUrl: config.jira.baseUrl, email: process.env.JIRA_EMAIL, token: process.env.JIRA_API_TOKEN });
  log(SAMPLE ? 'using sample counts' : `querying Jira ${config.jira.baseUrl}`);
  const raw = await collect(config, jira);
  log('counts:', JSON.stringify(raw.counts));

  // 2. Model
  const snap = buildSnapshot(config, raw, new Date());
  await writeFile(resolve(outDir, 'snapshot.json'), JSON.stringify(snap, null, 2));
  const text = slackText(snap);
  await writeFile(resolve(outDir, 'slack.txt'), text);

  // 3. Render
  const html = renderHtml(snap);
  const htmlPath = resolve(outDir, 'digest.html');
  await writeFile(htmlPath, html);
  let pngPath = null;
  if (!NO_PNG) {
    const { renderPng } = await import('./png.mjs');
    pngPath = resolve(outDir, `pg3d-art-digest-${snap.generatedAt.slice(0, 10)}.png`);
    await renderPng(html, pngPath);
    log('png written', pngPath);
  }

  // 4. Post
  if (DRY) {
    log('dry run: not posting. Slack text would be:\n' + text);
    return;
  }
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  const channelId = process.env.SLACK_CHANNEL_ID || config.slack.channelId;

  if (pngPath) {
    try {
      const f = await uploadFile({ token, channelId, filePath: pngPath, title: `PG3D Art · снимок нагрузки · ${snap.dateLabel}`, comment: text });
      log('posted image to', channelId, f?.id || '');
      return;
    } catch (e) {
      console.error('image upload failed, falling back to text:', e.message);
    }
  }
  await postMessage({ token, channelId, text });
  log('posted text to', channelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
