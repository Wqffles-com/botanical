# Security policy

## Reporting a vulnerability

**Please do not report security vulnerabilities in public issues, discussions, or pull requests.**

Report them privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/Wqffles-com/botanical/security) of this repository.
2. Click **Report a vulnerability** ([direct link](https://github.com/Wqffles-com/botanical/security/advisories/new)).
3. Describe the issue, affected version or commit, reproduction steps, and impact.

Maintainers will follow up in the private advisory thread. Once a fix is available, an advisory is published, crediting the reporter unless they prefer to stay anonymous.

## Supported versions

Botanical is in early alpha. Only the latest `main` branch and the most recent release receive security fixes.

## Scope and known limitations

The following are documented design limits, not vulnerabilities by themselves. Reports that bypass them in unexpected ways are welcome.

- **`shell` and `code_exec` are not a hardened sandbox.** They run inside a Linux namespace jail (no network by default, read-only `/usr`, scrubbed environment, resource limits), but without seccomp, a separate uid, or cgroups. See [packages/tools-shell/SECURITY.md](./packages/tools-shell/SECURITY.md). Run Botanical on a host you trust.
- **Coding-agent CLI profiles** (Grok Build, Claude Code, Codex) run with their own approval prompts disabled, inside the agent's workspace directory.
- **MCP servers** are operator-installed code and are trusted by design.
- **Auth is a single shared passcode.** There are no per-user accounts yet.
- The operator REST API can read all memories. Memory isolation applies to agent tools and prompts.

In scope, for example: escaping the shell jail or per-agent workspace, reading another agent's private memory through agent tools, bypassing role/permission checks, leaking provider API keys to the browser or into logs, authentication or session bypass, SSRF past the web tool's protections.

## Handling secrets

Never commit `.env` files or API keys. If you think a secret was committed to this repository, report it privately as above.
