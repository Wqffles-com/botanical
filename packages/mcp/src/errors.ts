/** Operator configuration is invalid. The server should fail boot. */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

/** A configured MCP server could not be used. Other servers may still be up. */
export class McpServerError extends Error {
  readonly serverId: string;

  constructor(serverId: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpServerError";
    this.serverId = serverId;
  }
}
