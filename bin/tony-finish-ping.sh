#!/bin/sh
# Node is Limen's existing runtime; credentials never enter a shell or child argv.
exec node --input-type=module - "$@" <<'NODE'
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

function fail(message) {
  console.error(`finish webhook: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 3) fail('usage: tony-finish-ping.sh <label> <status> <branch>');

let envFile = process.env.TONY_FINISH_WEBHOOK_ENV;
if (envFile !== undefined) {
  if (!isAbsolute(envFile)) fail('TONY_FINISH_WEBHOOK_ENV must be an absolute file path');
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
const auth = config.TONY_FINISH_WEBHOOK_AUTH;
if (!auth || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(auth)) {
  fail('TONY_FINISH_WEBHOOK_AUTH must be a complete Bearer value');
}
let url;
try {
  url = new URL(config.TONY_FINISH_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
} catch {
  fail('TONY_FINISH_WEBHOOK_URL must be an HTTPS URL without userinfo or fragment');
}

const controller = new AbortController();
setTimeout(() => {
  controller.abort();
  fail('request timed out after 10000ms');
}, 10000);
try {
  const response = await fetch(url, {
    method: 'POST', redirect: 'manual', signal: controller.signal,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: args[0], status: args[1], branch: args[2] }),
  });
  controller.abort(); // Do not read or print a possibly sensitive response body.
  if (response.status < 200 || response.status >= 300) fail(`HTTP ${response.status} rejected`);
  console.log(`finish webhook: accepted (HTTP ${response.status})`);
  process.exit(0);
} catch {
  fail('request failed');
}
NODE
