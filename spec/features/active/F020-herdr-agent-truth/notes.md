# F020 notes

## Live `agent get` envelope (Herdr 0.8.0, this job)

```
herdr 0.8.0
HERDR_PANE_ID=w14:pF
```

```
$ herdr agent get w14:pF
{"id":"cli:agent:get","result":{"agent":{"agent":"pi","agent_status":"working","cwd":"/Users/overment/.overment/.limen-limen-worktrees/2026-08-19-f020-herdr-agent-truth-c27e72de","focused":false,"foreground_cwd":"/Users/overment/.overment/.limen-limen-worktrees/2026-08-19-f020-herdr-agent-truth-c27e72de","interactive_ready":true,"name":"limen-f020-herdr-agent-truth-c27","pane_id":"w14:pF","revision":3,"state_change_seq":470,"tab_id":"w14:tF","terminal_id":"term_6595b60e1de5e49","terminal_title":"π - limen: F020 herdr agent truth - 2026-08-19-f020-herdr-agent-truth-c27e72de","terminal_title_stripped":"π - limen: F020 herdr agent truth - 2026-08-19-f020-herdr-agent-truth-c27e72de","workspace_id":"w14"},"type":"agent_info"}}
```

`result.agent_status` is absent. `result.agent.agent_status` is `working`. `call()` unwraps `result`, so the reader is `row.agent.agent_status` with flat `row.agent_status` as fallback.

## `agent send-keys` spelling

Unknown keys fail before delivery:

```
$ herdr agent send-keys w14:pF not-a-real-key
{"error":{"code":"invalid_key","message":"unsupported key not-a-real-key"},"id":"cli:agent:send-keys"}
exit=1
```

Missing target is resolved before the key is checked (both spellings look the same):

```
$ herdr agent send-keys no-such-agent-f020 C-c
{"error":{"code":"agent_not_found","message":"agent target no-such-agent-f020 not found"},"id":"cli:agent:send-keys"}

$ herdr agent send-keys no-such-agent-f020 ctrl+c
{"error":{"code":"agent_not_found","message":"agent target no-such-agent-f020 not found"},"id":"cli:agent:send-keys"}
```

Throwaway pane `w14:pK` (tab `w14:tK`, then closed):

```
$ herdr pane send-keys w14:pK C-c      # exit=0
$ herdr pane send-keys w14:pK ctrl+c   # exit=0
$ herdr pane send-keys w14:pK Ctrl+c   # exit=0
$ herdr pane send-keys w14:pK ctrl-c
{"error":{"code":"invalid_key","message":"unsupported key ctrl-c"},"id":"cli:request"}
exit=1
```

Live agent (one press; pi clears the editor, does not exit):

```
$ herdr agent send-keys w14:pF C-c
{"id":"cli:agent:send-keys","result":{"type":"ok"}}
exit=0
```

Did not send a second interrupt (`ctrl+c`) to this live agent. The key parser is shared with `pane send-keys` (same help text, same `invalid_key` code); `ctrl+c` is accepted there. Herdr 0.8.0 binary examples use `herdr agent send-keys reviewer ctrl+c`. `ctrl-c` is rejected.

**Accepted spelling: `ctrl+c`.** `C-c` also works. `stopHostedAgent` now sends `ctrl+c`.
