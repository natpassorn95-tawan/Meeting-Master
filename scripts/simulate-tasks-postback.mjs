// Local test: fire a fake LINE "action=aiai_tasks" postback at the running
// Meeting Master webhook, so you can watch the routing + resolve/fetch flow in
// the server logs WITHOUT tapping the real rich menu.
//
// Usage (server must be running, e.g. `npm run dev:api`):
//   node scripts/simulate-tasks-postback.mjs [userId] [webhookUrl]
//   node scripts/simulate-tasks-postback.mjs U1234...  http://localhost:8899/api/line/webhook
//
// If LINE_CHANNEL_SECRET is set (in ../.env or the env), the request is signed
// so it passes verifySignature; otherwise it's sent unsigned (the handler treats
// "no secret configured" as skip-verification).
//
// Note: the reply uses a fake replyToken, so the actual LINE reply call will
// fail (expected) — the point is to confirm the webhook ROUTES the postback and
// invokes the identity-resolve + tasks-fetch path. Watch /tmp/mm_api.log or the
// server console.
import { createHmac } from 'node:crypto';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}

const userId = process.argv[2] || process.env.LINE_TEST_USER_ID || 'Usimulated0000000000000000000000';
const url = process.argv[3] || `http://localhost:${process.env.PORT || 8899}/api/line/webhook`;

const body = JSON.stringify({
  destination: 'xxxxxxxxxx',
  events: [
    {
      type: 'postback',
      mode: 'active',
      timestamp: 1_600_000_000_000,
      replyToken: 'SIMULATED_REPLY_TOKEN_0000000000',
      source: { type: 'user', userId },
      postback: { data: 'action=aiai_tasks' },
    },
  ],
});

const headers = { 'content-type': 'application/json' };
const secret = process.env.LINE_CHANNEL_SECRET;
if (secret) {
  headers['x-line-signature'] = createHmac('sha256', secret).update(body).digest('base64');
  console.log('→ signed request (LINE_CHANNEL_SECRET present)');
} else {
  console.log('→ unsigned request (no LINE_CHANNEL_SECRET; handler skips verification)');
}

console.log(`POST ${url}\n  userId=${userId}  data=action=aiai_tasks`);
try {
  const res = await fetch(url, { method: 'POST', headers, body });
  console.log(`← HTTP ${res.status} ${await res.text()}`);
  console.log('\nCheck the server log for the [webhook] postback + [aiai-tasks] lines.');
  console.log('(The reply itself fails on the fake replyToken — that is expected.)');
} catch (e) {
  console.error(`✗ request failed: ${e.message}\n  Is the API server running? (npm run dev:api)`);
  process.exit(1);
}
