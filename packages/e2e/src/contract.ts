/** Tool name the mock profile emits on a demo turn. */
export const MOCK_TOOL_NAME = "file_list";

/** Page routes from the MVP shell. */
export const ROUTES = {
  login: "/login",
  agents: "/agents",
  newAgent: "/agents/new",
  inbox: "/inbox",
  settings: "/settings",
} as const;

export const SETTINGS_TABS = ["Profiles", "Tools", "MCP", "Deployment"] as const;
