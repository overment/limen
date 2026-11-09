import { type ChildProcess, spawn } from "node:child_process";

// Platform differences for a remote host live here: the ssh command line, quoting, paths, and how a pid is signaled.
// Darwin runs the script over OpenSSH. Windows OpenSSH lands in cmd.exe, so the command is one double-quoted
// `wsl.exe` line and the job itself runs in WSL2 Ubuntu, which is a Linux host from the script's point of view.
export type HostPlatform = "darwin" | "windows-wsl";

export type RemoteHost = {
	readonly alias: string;
	readonly ssh: string;
	readonly platform: HostPlatform;
	/** Absolute POSIX path of the repo checkout on the host. WSL paths stay POSIX (`/home/...`). */
	readonly root: string;
	/** Absolute POSIX path of this package's `hook/` directory on the host. */
	readonly hook: string;
	readonly maxConcurrent: number;
	readonly enabled: boolean;
	/** WSL distribution. Ignored on darwin. */
	readonly distro: string;
	/** Prepended to PATH inside the job. Empty uses whatever non-interactive ssh already has. */
	readonly path: string;
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
	const command =
		host.platform === "windows-wsl"
			? `wsl.exe -d ${cmdQuote(host.distro)} -- bash -c ${cmdQuote(STARTER)}`
			: `bash -c ${posixQuote(STARTER)}`;
	return [binary, ...SSH_OPTIONS, host.ssh, command];
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
 * Otherwise Node samples CPU, and macOS prefers `memory_pressure` when the script is running natively.
 */
export function probeScript(sampleMs: number, fixed: string | undefined): string {
	if (fixed !== undefined) {
		return `printf %s ${posixQuote(fixed)}\n`;
	}
	const ms = Number.isFinite(sampleMs) && sampleMs >= 0 ? Math.round(sampleMs) : 400;
	return `mem=""
if [ "$(uname -s)" = "Darwin" ] && [ -x /usr/bin/memory_pressure ]; then
  mem=$(/usr/bin/memory_pressure | sed -n 's/.*memory free percentage: *\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)
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
		bridgeFinder(),
		`root=${posixQuote(input.host.root)}`,
		`jobdir=${posixQuote(jobDir)}`,
		`wt=${posixQuote(worktree)}`,
		`branch=${posixQuote(input.branch)}`,
		`mkdir -p "$jobdir/steer/inbox" "$jobdir/steer/delivered" "$jobdir/session"`,
		decodeTo(`"$jobdir/task.md"`, "LIMEN_TASK", task),
		`git -C "$root" fetch origin "$branch:$branch"`,
		`if [ -e "$wt" ]; then`,
		`  git -C "$root" worktree remove --force "$wt" || rm -rf "$wt"`,
		"fi",
		`mkdir -p "$(dirname "$wt")"`,
		`git -C "$root" worktree add "$wt" "$branch"`,
		"export LIMEN_JOB=1",
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

/** Copies result, session-ended, and the session directory back as one base64 tar on stdout. */
export function bundleScript(jobDir: string): string {
	const dir = posixQuote(jobDir);
	return `set +e
jobdir=${dir}
files=""
for name in result session-ended session; do
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

export function cleanupScript(host: Pick<RemoteHost, "root">, jobId: string): string {
	const { jobDir, worktree } = remoteLayout(host, jobId);
	return `set +e
git -C ${posixQuote(host.root)} worktree remove --force ${posixQuote(worktree)} 2>/dev/null
rm -rf ${posixQuote(worktree)} ${posixQuote(jobDir)}
git -C ${posixQuote(host.root)} worktree prune >/dev/null 2>&1
exit 0
`;
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
