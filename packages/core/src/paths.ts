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
  agentRoles: (id: string) => `/api/agents/${encodeURIComponent(id)}/roles`,
  memories: "/api/memories",
  memory: (id: string) => `/api/memories/${encodeURIComponent(id)}`,
  roles: "/api/roles",
  role: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
  chats: "/api/chats",
  chat: (id: string) => `/api/chats/${encodeURIComponent(id)}`,
  messages: (chatId: string) => `/api/chats/${encodeURIComponent(chatId)}/messages`,
  agentMessages: "/api/agent-messages",
  agentMessage: (id: string) => `/api/agent-messages/${encodeURIComponent(id)}`,
  routines: "/api/routines",
  routinePreview: "/api/routines/preview",
  routine: (id: string) => `/api/routines/${encodeURIComponent(id)}`,
  routinePause: (id: string) => `/api/routines/${encodeURIComponent(id)}/pause`,
  routineResume: (id: string) => `/api/routines/${encodeURIComponent(id)}/resume`,
  routineRun: (id: string) => `/api/routines/${encodeURIComponent(id)}/run`,
  routineRuns: (id: string) => `/api/routines/${encodeURIComponent(id)}/runs`,
  listeners: "/api/listeners",
  listener: (id: string) => `/api/listeners/${encodeURIComponent(id)}`,
  listenerSecret: (id: string) => `/api/listeners/${encodeURIComponent(id)}/rotate-secret`,
  listenerDeliveries: (id: string) => `/api/listeners/${encodeURIComponent(id)}/deliveries`,
  alwaysOnSettings: "/api/settings/always-on",
  notifications: "/api/notifications",
  notificationRead: (id: string) => `/api/notifications/${encodeURIComponent(id)}/read`,
  notificationsReadAll: "/api/notifications/read-all",
} as const;
