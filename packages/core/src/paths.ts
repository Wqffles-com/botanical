/**
 * Botanical server routes. The v0 server mounts these under `/api`
 * (`GET /api/health`, `POST /api/auth/login`, …). `baseUrl` is an optional
 * origin (`http://127.0.0.1:8787`); leave it empty when the web app is
 * same-origin and a dev proxy forwards `/api`.
 */
export const API = {
  health: "/api/health",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  profiles: "/api/profiles",
  tools: "/api/tools",
  agents: "/api/agents",
  agent: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
  chats: "/api/chats",
  chat: (id: string) => `/api/chats/${encodeURIComponent(id)}`,
  messages: (chatId: string) => `/api/chats/${encodeURIComponent(chatId)}/messages`,
} as const;
