import { type ChildProcess, spawn } from "node:child_process";

// Platform differences for a remote host live here: the ssh command line, quoting, paths, and how a pid is signaled.
// Darwin and Linux run the script over OpenSSH into bash. Windows OpenSSH's default shell may be cmd.exe or
// PowerShell, so that command line holds no `$` and the starter is base64. The job itself still runs in WSL bash.
export type HostPlatform = "darwin" | "linux" | "windows-wsl";

export type HostClone = {
	/** Origin url or `owner/repo`. Empty is the shorthand `root`: the clone's own origin is the match. */
	readonly key: string;
	readonly path: string;
};

export type RemoteHost = {
	readonly alias: string;
	readonly ssh: string;
	readonly platform: HostPlatform;
	/** Clone this job uses. On a pool entry, the shorthand path, or "" when the entry only lists `roots`. */
	readonly root: string;
	/** `root` from hosts.json. Empty when the entry only lists `roots`. */
	readonly shorthand: string;
	/** `roots` from hosts.json. The shorthand is not repeated here. */
	readonly clones: readonly HostClone[];
	/** Absolute POSIX path of this package's `hook/` directory on the host. */
	readonly hook: string;
	readonly maxConcurrent: number;
	readonly enabled: boolean;
	/** WSL distribution. Ignored on darwin and linux. */
	readonly distro: string;
	/** Prepended to PATH inside the job. Empty uses whatever non-interactive ssh already has. */
	readonly path: string;
	/** Used when spawn or continue does not pass `--model`. Empty means the seat default. */
	readonly model: string;
};

/** Reads stdin into a temp file and runs it, so the script and the engine do not share one stdin stream. */
const STARTER = "t=$(mktemp); cat >$t; bash $t; c=$?; rm -f $t; exit $c";

const SSH_OPTIONS = [
	"-T",
	"-o",
	"BatchMode=yes",
	"-o",
	"ConnectTimeout=20",
	"-o",
	"ServerAliveInterval=15",
	"-o",
	"ServerAliveCountMax=4",
] as const;

export function sshBinary(): string {
	return process.env.LIMEN_SSH?.trim() || "ssh";
}

/** One remote command. The script is the process's stdin, not part of the command line. */
export function sshArgv(binary: string, host: Pick<RemoteHost, "ssh" | "platform" | "distro">): readonly string[] {
	return [binary, ...SSH_OPTIONS, host.ssh, remoteCommand(host)];
}

/**
 * The remote shell reads this command. Darwin and Linux are bash. Windows OpenSSH may be PowerShell, which would
 * expand `$(...)` inside the double quotes cmd.exe accepts, so the starter is base64 and the command line has no `$`.
 */
function remoteCommand(host: Pick<RemoteHost, "platform" | "distro">): string {
	if (host.platform !== "windows-wsl") {
		return `bash -c ${posixQuote(STARTER)}`;
	}
	const starter = Buffer.from(STARTER, "utf8").toString("base64");
	// Decode beside the pipe. Piping into bash would swallow the job script, which arrives on stdin.
	const inner = `echo ${starter} | base64 -d > /tmp/limen-starter && bash /tmp/limen-starter`;
	return `wsl.exe -d ${cmdQuote(host.distro)} -- bash -c ${cmdQuote(inner)}`;
}

/** POSIX single quotes. The only character they cannot hold is a single quote, which is closed and reopened. */
export function posixQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/** cmd.exe double quotes. The starter and the WSL distro name have no embedded quotes; `%` is doubled. */
export function cmdQuote(value: string): string {
	return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function remoteLayout(host: Pick<RemoteHost, "root">, jobId: string): { jobDir: string; worktree: string } {
	const root = host.root.replace(/\/+$/, "") || "/";
	const slash = root.lastIndexOf("/");
	const parent = slash <= 0 ? "/" : root.slice(0, slash);
	const name = root.slice(slash + 1);
	return {
		jobDir: `${root}/.limen/jobs/${jobId}`,
		worktree: `${parent}/.${name}-limen-worktrees/${jobId}`,
	};
}

/**
 * A short load sample. `fixed` is JSON already read on the seat (`LIMEN_HOST_READING`); the host prints it and exits.
 * Otherwise Node samples CPU, and macOS prefers `memory_pressure` when the script is running natively. `path` is the
 * host's configured PATH prefix: a non-interactive ssh session often has no `node`, so the sample must see it too.
 */
export function probeScript(sampleMs: number, fixed?: string, path?: string): string {
	if (fixed !== undefined) {
		return `printf %s ${posixQuote(fixed)}\n`;
	}
	const ms = Number.isFinite(sampleMs) && sampleMs >= 0 ? Math.round(sampleMs) : 400;
	const pathLine = path ? `export PATH=${posixQuote(path)}:"$PATH"\n` : "";
	return `${pathLine}mem=""
if [ "$(uname -s)" = "Darwin" ] && [ -x /usr/bin/memory_pressure ]; then
  mem=$(/usr/bin/memory_pressure | sed -n 's/.*memory free percentage: *\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)
elif [ -r /proc/meminfo ]; then
  mem=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{if(t>0) printf "%.4f", 100*a/t}' /proc/meminfo)
fi
LIMEN_REMOTE_MEM="$mem" node --input-type=module <<'END'
import { cpus, freemem, totalmem } from "node:os";
const before = cpus();
await new Promise((resolve) => setTimeout(resolve, ${ms}));
const after = cpus();
let idle = 0;
let total = 0;
const sum = (times) => Object.values(times).reduce((acc, value) => acc + value, 0);
after.forEach((core, index) => {
  const earlier = before[index]?.times;
  if (!earlier) return;
  idle += core.times.idle - earlier.idle;
  total += sum(core.times) - sum(earlier);
});
const hinted = process.env.LIMEN_REMOTE_MEM ?? "";
const memoryFree = hinted !== "" && Number.isFinite(Number(hinted))
  ? Number(hinted)
  : totalmem() > 0 ? (100 * freemem()) / totalmem() : null;
const cpuIdle = total > 0 ? (100 * idle) / total : null;
process.stdout.write(JSON.stringify({ cpuIdle, memoryFree }));
END
`;
}

/** Asks the host's Claude Code whether it holds a login of its own. Prints `loggedIn` or `loggedOut`, never a secret. */
export function loginProbeScript(path?: string): string {
	const pathLine = path ? `export PATH=${posixQuote(path)}:"$PATH"\n` : "";
	return `${pathLine}if ! command -v claude >/dev/null 2>&1; then echo claudeMissing; exit 0; fi
if claude auth status 2>&1 | grep -q '"loggedIn": *true'; then echo loggedIn; else echo loggedOut; fi
`;
}

/** Signals the pid recorded in the remote job folder, then its children. Both platforms run this inside bash. */
export function killScript(jobDir: string): string {
	const dir = posixQuote(jobDir);
	return `set +e
pid=$(cat ${dir}/remote-pid 2>/dev/null)
if [ -n "$pid" ]; then
  kill -TERM "$pid" 2>/dev/null
  pkill -TERM -P "$pid" 2>/dev/null
  sleep 1
  kill -KILL "$pid" 2>/dev/null
  pkill -KILL -P "$pid" 2>/dev/null
fi
exit 0
`;
}

export type LaunchScript = {
	readonly host: RemoteHost;
	readonly jobId: string;
	readonly branch: string;
	readonly label: string;
	readonly piArgs: readonly string[];
	readonly bridged: boolean;
	readonly task: string;
	/** Seat repo-local identity, or the broker's bot. Empty means the host's own git config. */
	readonly author?: { readonly name: string; readonly email: string };
};

/** The bash script that prepares the worktree, runs Pi, and pushes the branch before it exits. */
export function launchScript(input: LaunchScript): string {
	const { jobDir, worktree } = remoteLayout(input.host, input.jobId);
	const task = Buffer.from(input.task, "utf8").toString("base64");
	const args = ["pi", ...input.piArgs].map((arg) => posixQuote(arg)).join("\n");
	const pathLine = input.host.path ? `export PATH=${posixQuote(input.host.path)}:"$PATH"` : "";
	const lines = [
		"set -eu",
		"export GIT_TERMINAL_PROMPT=0",
		pathLine,
		loadGithub(input.jobId, input.author),
		bridgeFinder(),
		`root=${posixQuote(input.host.root)}`,
		`jobdir=${posixQuote(jobDir)}`,
		`wt=${posixQuote(worktree)}`,
		`branch=${posixQuote(input.branch)}`,
		`mkdir -p "$jobdir/steer/inbox" "$jobdir/steer/delivered" "$jobdir/session"`,
		decodeTo(`"$jobdir/task.md"`, "LIMEN_TASK", task),
		`echo "limen-remote: fetch $branch" >&2`,
		`git -C "$root" fetch origin "$branch:$branch"`,
		`if [ -e "$wt" ]; then`,
		`  git -C "$root" worktree remove --force "$wt" || rm -rf "$wt"`,
		"fi",
		`mkdir -p "$(dirname "$wt")"`,
		`git -C "$root" worktree add "$wt" "$branch"`,
		`echo "limen-remote: worktree $wt" >&2`,
		"export LIMEN_JOB=1",
		loadOauth(input.jobId),
		`export LIMEN_JOB_ID=${posixQuote(input.jobId)}`,
		`export LIMEN_JOB_LABEL=${posixQuote(input.label)}`,
		`export LIMEN_CONTEXT_ROOT="$root"`,
		'BRIDGE=""',
		`if [ ${input.bridged ? "1" : "0"} = 1 ]; then`,
		"  BRIDGE=$(find_bridge || true)",
		'  if [ -z "$BRIDGE" ]; then',
		'    echo "limen: no pi-claude-bridge under ~/.pi/agent/npm on this host" >&2',
		"    exit 1",
		"  fi",
		"fi",
		"args=(",
		args,
		")",
		"i=0",
		`while [ "$i" -lt "${bashAt("#args[@]")}" ]; do`,
		`  if [ "${bashAt("args[$i]")}" = "__LIMEN_BRIDGE__" ]; then`,
		"    args[$i]=$BRIDGE",
		"  fi",
		"  i=$((i + 1))",
		"done",
		`echo limen-remote-ready ${posixQuote(input.jobId)} >&2`,
		'cd "$wt"',
		`"${bashAt("args[@]")}" </dev/null &`,
		"pid=$!",
		'echo "$pid" > "$jobdir/remote-pid"',
		'echo "limen-remote-pid $pid" >&2',
		"code=0",
		'wait "$pid" || code=$?',
		'git -C "$wt" push origin "HEAD:refs/heads/$branch" || echo "limen-remote-push-failed" >&2',
		'exit "$code"',
	];
	return `${lines.filter((line) => line !== "").join("\n")}\n`;
}

/** A bash `${...}` built in two pieces so a quoted string does not contain a template placeholder. */
function bashAt(expression: string): string {
	const open = "$" + "{";
	return `${open}${expression}}`;
}

function decodeTo(target: string, marker: string, b64: string): string {
	return `node -e 'const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.from(Buffer.concat(c).toString().trim(),"base64")))' <<'${marker}' > ${target}
${b64}
${marker}`;
}

function bridgeFinder(): string {
	return `find_bridge() {
  modules="$HOME/.pi/agent/npm/node_modules"
  [ -d "$modules" ] || return 0
  if [ -e "$modules/pi-claude-bridge" ]; then
    (cd "$modules/pi-claude-bridge" && pwd -P)
    return 0
  fi
  for candidate in "$modules"/@*/pi-claude-bridge; do
    if [ -e "$candidate" ]; then
      (cd "$candidate" && pwd -P)
      return 0
    fi
  done
  return 0
}`;
}

/** Copies the handoff, the note, and the session back as one base64 tar on stdout. Uses the host PATH so node is found. */
export function bundleScript(host: RemoteHost, jobId: string): string {
	const dir = posixQuote(remoteLayout(host, jobId).jobDir);
	const pathLine = host.path ? `export PATH=${posixQuote(host.path)}:"$PATH"\n` : "";
	return `set +e
${pathLine}jobdir=${dir}
files=""
for name in result session-ended session note.md note.first.md; do
  if [ -e "$jobdir/$name" ]; then
    files="$files $name"
  fi
done
if [ -n "$files" ]; then
  tar -C "$jobdir" -cf - $files | node -e 'const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.concat(c).toString("base64")))'
fi
exit 0
`;
}

export function oauthPath(jobId: string): string {
	return `/tmp/limen-oauth-${jobId}`;
}

/** Writes the seat token to a 0600 file. The token is in this script, which ssh carries on stdin, never in argv. */
export function oauthInstallScript(jobId: string, token: string): string {
	let marker = "LIMEN_OAUTH_END";
	while (token.includes(marker)) {
		marker += "X";
	}
	const dest = posixQuote(oauthPath(jobId));
	return `set -eu
umask 077
cat > ${dest} <<'${marker}'
${token}
${marker}
chmod 600 ${dest}
`;
}

export function ghPath(jobId: string): string {
	return `/tmp/limen-gh-${jobId}`;
}

/** Writes the seat's GitHub token to a 0600 file. The token is in this script, on ssh stdin, never in argv. */
export function githubInstallScript(jobId: string, token: string): string {
	let marker = "LIMEN_GH_END";
	while (token.includes(marker)) {
		marker += "X";
	}
	const dest = posixQuote(ghPath(jobId));
	return `set -eu
umask 077
cat > ${dest} <<'${marker}'
${token}
${marker}
chmod 600 ${dest}
`;
}

function loadGithub(jobId: string, author: LaunchScript["author"]): string {
	const dest = posixQuote(ghPath(jobId));
	const authorLines = author
		? [
				`export GIT_AUTHOR_NAME=${posixQuote(author.name)}`,
				`export GIT_AUTHOR_EMAIL=${posixQuote(author.email)}`,
				`export GIT_COMMITTER_NAME=${posixQuote(author.name)}`,
				`export GIT_COMMITTER_EMAIL=${posixQuote(author.email)}`,
			].join("\n")
		: "";
	// The helper reads GH_TOKEN when git asks. The value itself does not contain the token. It is tried before a
	// helper already configured on the host, and an ssh GitHub url is fetched over HTTPS so the token is what pushes.
	return `ghfile=${dest}
if [ -f "$ghfile" ]; then
  GH_TOKEN=$(tr -d '\\n' < "$ghfile")
  export GH_TOKEN
  export GITHUB_TOKEN="$GH_TOKEN"
  rm -f "$ghfile"
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0=credential.helper
  export GIT_CONFIG_VALUE_0='!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
  export GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf
  export GIT_CONFIG_VALUE_1=git@github.com:
fi
${authorLines}`;
}

function loadOauth(jobId: string): string {
	const dest = posixQuote(oauthPath(jobId));
	return `oauth=${dest}
if [ -f "$oauth" ]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(tr -d '\\n' < "$oauth")
  export CLAUDE_CODE_OAUTH_TOKEN
  rm -f "$oauth"
fi`;
}

export function cleanupScript(host: Pick<RemoteHost, "root">, jobId: string, branch: string): string {
	const { jobDir, worktree } = remoteLayout(host, jobId);
	const dropBranch = branch.startsWith("limen/")
		? `git -C ${posixQuote(host.root)} branch -D ${posixQuote(branch)} >/dev/null 2>&1\n`
		: "";
	return `set +e
git -C ${posixQuote(host.root)} worktree remove --force ${posixQuote(worktree)} 2>/dev/null
rm -rf ${posixQuote(worktree)} ${posixQuote(jobDir)} ${posixQuote(oauthPath(jobId))} ${posixQuote(ghPath(jobId))}
${dropBranch}git -C ${posixQuote(host.root)} worktree prune >/dev/null 2>&1
exit 0
`;
}

/** Every clone a pool entry names: the shorthand `root`, then each `roots` path. */
export function configuredClones(host: Pick<RemoteHost, "shorthand" | "clones">): readonly HostClone[] {
	return host.shorthand ? [{ key: "", path: host.shorthand }, ...host.clones] : [...host.clones];
}

/** Prints the clone's origin, or `missing`. The seat matches a shorthand `root` against this line. */
export function originProbeScript(path: string): string {
	const quoted = posixQuote(path);
	return `set +e
if ! git -C ${quoted} rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo missing
  exit 0
fi
url=$(git -C ${quoted} remote get-url origin 2>/dev/null) || url=""
if [ -z "$url" ]; then
  echo missing
  exit 0
fi
printf '%s\\n' "$url"
exit 0
`;
}

/** One tab-separated line per clone: branch, origin, and whether it is a non-job branch of a readable origin. */
function rootCheckFunction(): string {
	return `check_root() {
  path="$1"
  if ! git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'root fail\\t%s\\t-\\t-\\tnot a git clone\\n' "$path"
    return 1
  fi
  origin=$(git -C "$path" remote get-url origin 2>/dev/null) || origin=""
  if [ -z "$origin" ]; then
    printf 'root fail\\t%s\\t-\\t-\\tno origin\\n' "$path"
    return 1
  fi
  branch=$(git -C "$path" branch --show-current 2>/dev/null) || branch=""
  if [ -z "$branch" ]; then
    printf 'root fail\\t%s\\t-\\t%s\\tdetached HEAD\\n' "$path" "$origin"
    return 1
  fi
  case "$branch" in
    limen/*)
      printf 'root fail\\t%s\\t%s\\t%s\\ton job branch\\n' "$path" "$branch" "$origin"
      return 1
      ;;
  esac
  err=$(git -C "$path" ls-remote --exit-code origin HEAD 2>&1)
  code=$?
  if [ "$code" != 0 ]; then
    one=$(printf '%s\\n' "$err" | head -n 1 | tr '\\t' ' ')
    printf 'root fail\\t%s\\t%s\\t%s\\tls-remote failed: %s\\n' "$path" "$branch" "$origin" "$one"
    return 1
  fi
  printf 'root ok\\t%s\\t%s\\t%s\\t-\\n' "$path" "$branch" "$origin"
  return 0
}`;
}

/** Confirms node, Pi, the hook directory, each clone, and the host's own Claude login. */
export function hostCheckScript(host: RemoteHost): string {
	const pathLine = host.path ? `export PATH=${posixQuote(host.path)}:"$PATH"\n` : "";
	const calls = configuredClones(host)
		.map((clone) => `check_root ${posixQuote(clone.path)} || bad=1`)
		.join("\n");
	return `set +e
${pathLine}${rootCheckFunction()}
bad=0
${calls}
if [ "$bad" = 0 ]; then echo "git ok"; else echo "git fail"; fi
hook=${posixQuote(host.hook)}
if command -v node >/dev/null 2>&1; then echo "node ok $(command -v node)"; else echo "node missing"; fi
if command -v pi >/dev/null 2>&1; then echo "pi ok $(command -v pi)"; else echo "pi missing"; fi
if [ -f "$hook/finish.ts" ]; then echo "hook ok $hook"; else echo "hook missing $hook"; fi
if ! command -v claude >/dev/null 2>&1; then
  echo "claude missing"
  exit 0
fi
claude_err=$(claude auth status 2>&1)
claude_code=$?
if [ "$claude_code" = 0 ]; then
  echo "claude ok"
else
  echo "claude fail"
  if [ -n "$claude_err" ]; then
    printf '%s\n' "$claude_err" | head -n 8 | sed 's/^/claude /'
  else
    echo "claude no output, exit $claude_code"
  fi
fi
exit 0
`;
}

/** Pi, and the bridge when the model needs it. Run before a host job so the seat's own PATH is not the check. */
export function hostEngineScript(host: RemoteHost, bridged: boolean): string {
	const pathLine = host.path ? `export PATH=${posixQuote(host.path)}:"$PATH"\n` : "";
	return `set +e
${pathLine}${bridgeFinder()}
if ! command -v pi >/dev/null 2>&1; then
  echo "pi is not on PATH"
  exit 1
fi
echo "pi ok"
if [ ${bridged ? "1" : "0"} = 1 ]; then
  bridge=$(find_bridge || true)
  if [ -z "$bridge" ]; then
    echo "bridge missing: no pi-claude-bridge under ~/.pi/agent/npm on this host"
    exit 1
  fi
  echo "bridge ok"
fi
exit 0
`;
}

/** Prefix each complete line. `pending` is a tail with no newline yet. */
export function prefixHostChunk(
	alias: string,
	pending: string,
	chunk: string,
): { readonly text: string; readonly pending: string } {
	const lines = `${pending}${chunk}`.split("\n");
	const rest = lines.pop() ?? "";
	const text = lines.map((line) => `[${alias}] ${line}`).join("\n");
	return { text: text.length > 0 ? `${text}\n` : "", pending: rest };
}

/** Writes one inbox file. The name is already a single path segment. */
export function steerPushScript(jobDir: string, name: string, body: Buffer): string {
	const b64 = body.toString("base64");
	return `set -eu
mkdir -p ${posixQuote(`${jobDir}/steer/inbox`)} ${posixQuote(`${jobDir}/steer/delivered`)}
node -e 'const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.from(Buffer.concat(c).toString().trim(),"base64")))' <<'LIMEN_STEER' > ${posixQuote(`${jobDir}/steer/inbox/${name}`)}
${b64}
LIMEN_STEER
`;
}

export function steerListScript(jobDir: string): string {
	return `ls -1 ${posixQuote(`${jobDir}/steer/delivered`)} 2>/dev/null || true\n`;
}

export function openRemoteShell(host: RemoteHost, script: string): ChildProcess {
	const [binary, ...args] = sshArgv(sshBinary(), host);
	const child = spawn(binary ?? "ssh", args, {
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (!child.stdin) {
		throw new Error("ssh stdin is not a pipe");
	}
	child.stdin.end(script);
	return child;
}

export type ShellText = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

/** Runs one script to completion. A timeout or a lost connection resolves; it does not throw. */
export function shellText(host: RemoteHost, script: string, timeoutMs: number, stop?: AbortSignal): Promise<ShellText> {
	const { promise, resolve } = Promise.withResolvers<ShellText>();
	let stdout = "";
	let stderr = "";
	let settled = false;
	const finish = (code: number | null) => {
		if (settled) {
			return;
		}
		settled = true;
		resolve({ code, stdout, stderr });
	};
	let child: ChildProcess;
	try {
		child = openRemoteShell(host, script);
	} catch (error) {
		stderr = error instanceof Error ? error.message : String(error);
		finish(null);
		return promise;
	}
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		finish(null);
	}, timeoutMs);
	timer.unref?.();
	const onStop = () => child.kill("SIGTERM");
	stop?.addEventListener("abort", onStop, { once: true });
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.once("error", (error) => {
		stderr += error.message;
		clearTimeout(timer);
		stop?.removeEventListener("abort", onStop);
		finish(null);
	});
	child.once("close", (code) => {
		clearTimeout(timer);
		stop?.removeEventListener("abort", onStop);
		finish(code);
	});
	return promise;
}
