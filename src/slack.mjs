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

/** Uploads a file and shares it to the channel with `comment` as the message text. */
export async function uploadFile({ token, channelId, filePath, title, comment }) {
  const bytes = await readFile(filePath);
  const filename = basename(filePath);

  const { upload_url, file_id } = await slackApi(token, 'files.getUploadURLExternal', { filename, length: String(bytes.length) }, { form: true });

  const put = await fetch(upload_url, { method: 'POST', body: bytes });
  if (!put.ok) throw new Error(`Slack upload_url POST failed: ${put.status}`);

  const done = await slackApi(token, 'files.completeUploadExternal', {
    files: [{ id: file_id, title }],
    channel_id: channelId,
    initial_comment: comment,
  });
  return done.files?.[0];
}

/** Text-only fallback so the digest still lands if the image path breaks. */
export async function postMessage({ token, channelId, text }) {
  return slackApi(token, 'chat.postMessage', { channel: channelId, text, unfurl_links: false });
}
