# Security

This tool is process/worktree isolation, not a hostile-code sandbox.

`limen spawn` launches `pi --approve` as the calling user. A worker can run the same commands you can, read the same environment, and write wherever you can write. Review candidate diffs before merging. Do not point `limen` at an untrusted repository if that would expose credentials.

Windows is unsupported. PID and process-group signals are POSIX-only.

## Reporting

Email [adam@overment.com](mailto:adam@overment.com) or open a private GitHub security advisory on this repository. Please do not file a public issue for an exploitable bug in spawn, stop, or the wake extension until there is a fix.
