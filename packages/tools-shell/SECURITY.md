# Shell and code exec — security limits (v0)

`shell` and `code_exec` run model-generated commands on the Botanical server. v0 confines them with a Linux namespace jail plus timeouts, output caps, and a scrubbed environment. That is a real boundary against casual filesystem and secret access. It is **not** a hardened multi-tenant sandbox (no seccomp, no separate uid, no cgroup).

The server must treat both tools as `approval: "ask"` and must not call `execute` until a person (or a stricter operator policy) allows that call. The tools do not prompt by themselves.

## What the jail enforces

Each call starts a new process under `unshare`:

| Namespace | Effect |
| --- | --- |
| user (`--map-root-user`) | The command is root *inside* the namespace. That maps back to the **server OS user**. Files it creates in the workspace are owned by that user. It does not gain host root. |
| mount | A new mount tree. `pivot_root` then detaches the host root. |
| pid | A fresh process tree. The command is pid 1. |
| network | **Off by default** (`--net`). There is no route to the host network or to abstract unix sockets that live in the host network namespace. |

Mounts the command can see:

| Path | What it is |
| --- | --- |
| `/workspace` | The call's `workspaceRoot`, read-write. This is the cwd jail. |
| `/usr` (and `/bin`, `/lib`, `/lib64` symlinks) | Host `/usr`, **read-only**. Needed so `sh`, Bun, and Python can run. |
| `/tmp`, `/dev/shm`, `/` | Size-capped tmpfs (32–64 MiB). Writes here die with the jail and do not fill the host disk. |
| `/botanical` | `code_exec` source, read-only. Absent for `shell`. |
| `/proc` | procfs for **this** pid namespace, not the host's process list. |
| `/etc` | A tiny generated `passwd`/`group`, plus a copy of `resolv.conf` and `hosts`, and read-only `/etc/ssl` when present. The host passwd file is not mounted. |
| `/dev` | `null`, `zero`, `urandom`, `random` only. |

Also applied from the parent, before the command runs:

- **Timeout.** Default 30s, operator ceiling 120s (both configurable). The process group is killed with `SIGKILL`. `ctx.signal` aborting does the same.
- **CPU rlimit** a couple of seconds above the wall-clock timeout, when `prlimit` exists, so a tight spin dies even if the timer is late.
- **File-size rlimit** default 64 MiB per file (`RLIMIT_FSIZE`).
- **Open-file rlimit** default 1024.
- **Core dumps** disabled.
- **Output cap** default 64 KiB combined stdout and stderr. Past that the process group is killed and the result is marked truncated.
- **Environment scrub.** The child does not inherit `process.env`. `PATH` is a fixed system path. `HOME` is `/workspace`, not the server user's home. `LD_*`, `NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, and similar knobs cannot be injected via `extraEnv`.
- **cwd check.** Requested `cwd` is `realpath`'d and must stay inside the workspace. A symlink that points outside is rejected before the jail starts. The mount namespace is what still blocks escape if the check were wrong.
- **Host paths in tool output** for the workspace and the jail scratch directory are redacted to `[redacted-path]` before `content` is returned.
- **Allowlist (optional).** `shellAllowlist` / `BOTANICAL_SHELL_ALLOWLIST` execs one basename directly. Pipes, redirects, command substitution, and absolute paths are rejected. This is an operator policy on top of the jail, not a replacement for it.

`code_exec` never interpolates source into a shell command. The source is written to a scratch file outside the workspace and mounted read-only. Python is started with `-I -B`.

## What this does not stop

Be explicit with operators. v0 will **not**:

1. **Drop privileges to a different uid.** The command can read and write anything the server OS user can read and write *inside the workspace bind*. Point `workspaceRoot` at a dedicated directory, never `/` (the tool rejects the filesystem root) and never a home directory full of keys.
2. **Hide `/usr`.** System binaries and libraries are readable. Do not keep secrets in `/usr`.
3. **Apply seccomp, landlock, or a container runtime.** A kernel bug in user namespaces is in scope for an attacker who already got code execution here. There is no gVisor, Kata, or VM boundary.
4. **Cap process count.** `RLIMIT_NPROC` is global per uid; setting it low breaks a busy server, so it is not set. A fork bomb is contained to the pid namespace and is killed when the wall-clock timeout fires, but it can still spike CPU for that window. cgroup delegation was not available in the reference environment, so there is no `pids.max`.
5. **Cap total disk written into the workspace.** `RLIMIT_FSIZE` limits each file, not the sum. The workspace is a normal directory on the host disk. Put it on a volume you can afford to fill.
6. **Stop a command from using the network when the operator enabled it.** `network: true` or `BOTANICAL_SHELL_NETWORK=1` shares the host net namespace. The process can then make outbound connections and reach abstract unix sockets. Default is off. Enabling network is the main way a prompt-injected command can exfiltrate workspace contents.
7. **Hide every host path.** `/proc/self/mountinfo` inside the jail can still contain the host path of the workspace bind. Tool output redacts the paths this process knows about; a determined command can still read mountinfo. That is an information leak, not a filesystem escape. The detached old root is unmounted and the jail refuses to continue if that mount is still a mountpoint.
8. **Block hardlinks that were already inside the workspace.** Creating new hardlinks to files the user owns outside the directory is constrained by `fs.protected_hardlinks`, but links that already exist in the workspace remain reachable. Don't pre-seed the workspace with links to secrets.
9. **Replace approval.** Jail + scrub is defense in depth after a human allows the call. A model should not get an unattended shell on a box that holds provider API keys.
10. **Run anywhere but Linux.** Without `unshare`, `pivot_root`, and user namespaces, `execute` returns `sandbox_error` and does not fall back to an unjailed process.

Copied into the jail for name resolution, even when network is off: `/etc/resolv.conf` and `/etc/hosts`. Those can reveal internal DNS config. They are copies, not a bind of all of `/etc`.

## Requirements

- Linux with unprivileged user namespaces (`kernel.unprivileged_userns_clone` / AppArmor policy allowing `unshare`).
- `unshare`, `bash`, `mount`, `mountpoint`, `pivot_root` on the standard paths checked by `checkShellSandbox()`.
- `prlimit` is used when present. If it is missing, the namespace jail still runs and the missing rlimits are noted by `checkShellSandbox().prlimit === false`.
- Bun on the fixed `PATH` for JavaScript and TypeScript (`/usr/local/bin` is included). `python3` on that same `PATH` for Python.

## Operator checklist

- Dedicated workspace directory per chat or per user. Not `$HOME`.
- Leave network disabled unless a task truly needs it.
- Keep `approval: "ask"` for both tools in the server policy.
- Prefer `shellAllowlist` when the agent only needs a few programs.
- Do not put `DATABASE_URL`, `BOTANICAL_PASSWORD`, or provider keys in `extraEnv`.
- Run the server user as a user that does not own the host secret store, and keep secrets out of the workspace.
