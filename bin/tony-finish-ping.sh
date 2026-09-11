#!/bin/sh
# Node is Limen's existing runtime; credentials never enter a shell or child argv.
exec node --input-type=module - "$@" <<'NODE'
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

function fail(message) {
  console.error(`finish webhook: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 3) fail('usage: tony-finish-ping.sh <label> <status> <branch>');

let envFile = process.env.LIMEN_FINISH_WEBHOOK_ENV;
if (envFile !== undefined) {
  if (!isAbsolute(envFile)) fail('LIMEN_FINISH_WEBHOOK_ENV must be an absolute file path');
} else {
  const git = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    encoding: 'utf8', timeout: 2000, env: { ...process.env, LC_ALL: 'C' },
  });
  if (git.status === 0) {
    try {
      envFile = join(dirname(realpathSync(resolve(git.stdout.trim()))), '.limen', 'finish-webhook.env');
    } catch {
      fail('cannot resolve the canonical Git directory');
    }
  } else if (!git.error && /fatal: not a git repository/.test(git.stderr)) {
    // Legacy fallback is for manual calls outside Git only. Automation supplies an override.
    if (!process.env.HOME) fail('no manual configuration home');
    envFile = join(process.env.HOME, '.overment', 'tony-finish-webhook.env');
  } else {
    fail('cannot resolve the project configuration');
  }
}

let config;
try {
  config = parseEnv(readFileSync(envFile, 'utf8'));
} catch {
  fail('cannot read the selected env file');
}
const multi = config.LIMEN_FINISH_WEBHOOK_TARGETS !== undefined;
let targets = [{ url: config.LIMEN_FINISH_WEBHOOK_URL, auth: config.LIMEN_FINISH_WEBHOOK_AUTH }];
if (multi) {
  try {
    targets = JSON.parse(config.LIMEN_FINISH_WEBHOOK_TARGETS);
    if (!Array.isArray(targets) || !targets.length || targets.length > 64) throw new Error();
    if (targets.some(target => !target || typeof target !== 'object' || Array.isArray(target)
      || Object.keys(target).some(key => !['url', 'auth'].includes(key)))) throw new Error();
  } catch {
    fail('LIMEN_FINISH_WEBHOOK_TARGETS must be a JSON array of 1–64 {url, auth} targets');
  }
}
// Validate the entire selection before contacting any destination. Explicit fan-out never falls back.
for (const [index, target] of targets.entries()) {
  const prefix = multi ? `target ${index + 1}` : 'LIMEN_FINISH_WEBHOOK';
  if (typeof target.auth !== 'string' || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(target.auth)) {
    fail(`${prefix}${multi ? ' auth' : '_AUTH'} must be a complete Bearer value`);
  }
  try {
    const url = new URL(target.url);
    if (typeof target.url !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    target.url = url;
  } catch {
    fail(`${prefix}${multi ? ' url' : '_URL'} must be an HTTPS URL without userinfo or fragment`);
  }
}

// Automatic finalization supplies a stable job-derived identity and fd 3.
const event = /^limen-finish-[a-f0-9]{64}$/.test(process.env.LIMEN_FINISH_EVENT ?? '') ? process.env.LIMEN_FINISH_EVENT : undefined;
function receipt(index, transport, http = 'none') {
  if (!event) return;
  try {
    writeSync(3, JSON.stringify({ target: index + 1, at: new Date().toISOString(), transport, http }) + '\n');
  } catch {
    // Manual invocation may carry correlation without the private receipt channel.
  }
}
for (const index of targets.keys()) receipt(index, 'pending');
function send(target, index) {
  return new Promise(resolve => {
    const controller = new AbortController();
    let settled = false;
    const finish = (accepted, message, http = 'none') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort(); // Do not read or print a possibly sensitive response body.
      receipt(index, accepted ? 'accepted' : http === 'none' ? 'unknown' : 'rejected', http);
      const line = multi ? `target ${index + 1} ${message}; owner wake unobserved` : message;
      console[accepted || multi ? 'log' : 'error'](`finish webhook: ${line}`);
      resolve(accepted);
    };
    const timer = setTimeout(() => finish(false, 'request timed out after 10000ms'), 10000);
    fetch(target.url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: target.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: args[0], status: args[1], branch: args[2], ...(event ? { finishEvent: event } : {}) }),
    }).then(response => {
      const accepted = response.status >= 200 && response.status < 300;
      finish(accepted, accepted ? `accepted (HTTP ${response.status})` : `HTTP ${response.status} rejected`, `${Math.floor(response.status / 100)}xx`);
    }, () => finish(false, 'request failed'));
  });
}
// Start every route before waiting: a failed or stalled bot must not prevent another bot's request.
const results = await Promise.all(targets.map(send));
process.exit(results.every(Boolean) ? 0 : 1);
NODE
