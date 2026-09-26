export {
  DEFAULT_USER_AGENT,
  FRESHNESS_VALUES,
  SEARCH_PROVIDER_IDS,
  WEB_LIMITS,
  WEB_TOOL_ENV,
  envFrom,
  loadWebToolConfig,
} from "./config.ts";
export type { EnvMap, Freshness, SearchProviderId, WebToolConfig } from "./config.ts";
export { webFetchParameters, webFetchTool, WEB_FETCH_DESCRIPTION } from "./fetch-tool.ts";
export type { WebFetchData } from "./fetch-tool.ts";
export { formatSearchResults, webSearchParameters, webSearchTool, WEB_SEARCH_DESCRIPTION } from "./search-tool.ts";
export type { WebSearchData } from "./search-tool.ts";
export type { SearchHit } from "./providers/parse.ts";

import type { Tool } from "../types.ts";
import { webFetchTool } from "./fetch-tool.ts";
import { webSearchTool } from "./search-tool.ts";

/** Built-in web tools, search first. */
export function builtinWebTools(): readonly Tool[] {
  return [webSearchTool, webFetchTool];
}
