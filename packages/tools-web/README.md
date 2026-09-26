# @botanical/tools

Built-in tools for the Botanical server. This package is the shared tool contract plus the v0 web tools. Shell, file, and MCP tools can register beside these later.

Import TypeScript source directly. Botanical runs on Bun, which executes these files without a build step.

```ts
import { ToolRegistry, builtinWebTools } from "@botanical/tools";

const tools = new ToolRegistry().registerAll(builtinWebTools());
const definitions = tools.definitions(); // name, description, JSON Schema parameters
const result = await tools.execute("web_search", { query: "botanical" });
```

A tool is `{ name, description, parameters, execute }`. `parameters` is a JSON Schema for the arguments object. `execute` returns `{ ok, content, errorCode?, data? }` and does not throw for bad arguments, HTTP failures, or a missing search key. `content` is what the model should see.

## web_search

Provider selection:

| `BOTANICAL_SEARCH_PROVIDER` | Credential |
| --- | --- |
| `brave` (default when its key is set) | `BRAVE_SEARCH_API_KEY` or `BRAVE_API_KEY` |
| `tavily` | `TAVILY_API_KEY` |
| `serper` | `SERPER_API_KEY` |
| `searxng` | `SEARXNG_URL` (optional `SEARXNG_API_KEY` bearer token) |
| `stub` | none |

When the provider is unset, the first configured backend in that table wins. With no key and no SearXNG URL, `web_search` returns a stub result and does not call the network. An explicit provider without its credential also makes no request and names the missing variable.

## web_fetch

Fetches `http`/`https` URLs and returns markdown (HTML) or plain text. It refuses non-http protocols, embedded credentials, and non-public hosts (loopback, private, link-local, cloud metadata). Redirects are checked the same way, up to 5 hops.

`BOTANICAL_WEB_ALLOW_PRIVATE_URLS=1` skips the public-host check. That is a development switch. The address is looked up before connect and is not pinned to the socket.

| Variable | Default |
| --- | --- |
| `BOTANICAL_WEB_FETCH_TIMEOUT_MS` | 15000 |
| `BOTANICAL_WEB_FETCH_MAX_BYTES` | 2000000 |
| `BOTANICAL_WEB_FETCH_MAX_CHARS` | 20000 |
| `BOTANICAL_WEB_SEARCH_TIMEOUT_MS` | 15000 |
| `BOTANICAL_WEB_USER_AGENT` | Botanical/0.1 |

## Tests

```bash
bun test
bun run typecheck
```
