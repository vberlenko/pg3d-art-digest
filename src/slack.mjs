// Slack: image upload via the current 3-step external-upload flow
// (files.upload is deprecated and returns errors for new apps).
// Scopes needed on the bot token: files:write, chat:write. Bot must be a member of the channel.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

async function slackApi(token, method, body, { form = false } = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: form
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error}${json.needed ? ` (needed scope: ${json.needed})` : ''}`);
  return json;
}

async function uploadBytes(token, filePath) {
  const bytes = await readFile(filePath);
  const filename = basename(filePath);
  const { upload_url, file_id } = await slackApi(token, 'files.getUploadURLExternal', { filename, length: String(bytes.length) }, { form: true });
  const put = await fetch(upload_url, { method: 'POST', body: bytes });
  if (!put.ok) throw new Error(`Slack upload_url POST failed for ${filename}: ${put.status}`);
  return file_id;
}

/** Uploads one or more files and shares them to the channel as ONE message with `comment` as its text. */
export async function uploadFiles({ token, channelId, files, comment }) {
  const ids = [];
  for (const f of files) ids.push({ id: await uploadBytes(token, f.path), title: f.title });
  const done = await slackApi(token, 'files.completeUploadExternal', {
    files: ids,
    channel_id: channelId,
    initial_comment: comment,
  });
  return done.files || [];
}

/** Single-file convenience wrapper. */
export async function uploadFile({ token, channelId, filePath, title, comment }) {
  const [f] = await uploadFiles({ token, channelId, files: [{ path: filePath, title }], comment });
  return f;
}

/** Text-only fallback so the digest still lands if the image path breaks. */
export async function postMessage({ token, channelId, text }) {
  return slackApi(token, 'chat.postMessage', { channel: channelId, text, unfurl_links: false });
}
