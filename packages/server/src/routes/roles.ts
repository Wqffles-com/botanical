import { PermissionsError, parseRolePermissions } from "@botanical/agent-runtime";

import { HttpError, json, noContent, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { RoleRecord, Store } from "../types.ts";
import { readBoundedString, requireParam } from "../validate.ts";

export function registerRoles(router: Router): void {
  router.add(
    "GET",
    "/api/roles",
    authed(async (ctx) => {
      const roles = await ctx.store.roles.list();
      return json(200, { roles: roles.map(presentRole) });
    }),
  );

  router.add(
    "POST",
    "/api/roles",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const input = parseNewRole(body);
      const existing = await ctx.store.roles.getByName(input.name);
      if (existing) throw new HttpError(409, "role_exists", `Role ${JSON.stringify(input.name)} already exists`);
      try {
        const role = await ctx.store.roles.create(input);
        return json(201, { role: presentRole(role) });
      } catch (error) {
        throw roleWriteError(error);
      }
    }),
  );

  router.add(
    "GET",
    "/api/roles/:id",
    authed(async (ctx) => {
      const role = await loadRole(ctx.store, requireParam(ctx.params, "id"));
      return json(200, { role: presentRole(role) });
    }),
  );

  router.add(
    "PATCH",
    "/api/roles/:id",
    authed(async (ctx) => {
      const current = await loadRole(ctx.store, requireParam(ctx.params, "id"));
      const patch = parseRolePatch(bodyOf(await readJson(ctx.request, ctx.config)), current.builtin);
      try {
        const role = await ctx.store.roles.update(current.id, patch);
        if (!role) throw new HttpError(404, "not_found", "Role not found");
        return json(200, { role: presentRole(role) });
      } catch (error) {
        throw roleWriteError(error);
      }
    }),
  );

  router.add(
    "DELETE",
    "/api/roles/:id",
    authed(async (ctx) => {
      const current = await loadRole(ctx.store, requireParam(ctx.params, "id"));
      if (current.builtin) {
        throw new HttpError(409, "builtin_role", "Builtin roles cannot be deleted. Edit their permissions instead.");
      }
      try {
        const removed = await ctx.store.roles.delete(current.id);
        if (!removed) throw new HttpError(404, "not_found", "Role not found");
      } catch (error) {
        throw roleWriteError(error);
      }
      return noContent();
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id/roles",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { roleIds: agent.roleIds, roles: agent.roles });
    }),
  );

  router.add(
    "PUT",
    "/api/agents/:id/roles",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      const body = bodyOf(await readJson(ctx.request, ctx.config));
      const roleIds = await resolveRoleIds(ctx.store, body.roleIds);
      const updated = await ctx.store.agents.update(agent.id, { roleIds });
      if (!updated) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { roleIds: updated.roleIds, roles: updated.roles });
    }),
  );
}

export function presentRole(role: RoleRecord) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    builtin: role.builtin,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

async function loadRole(store: Store, id: string): Promise<RoleRecord> {
  const role = (await store.roles.get(id)) ?? (await store.roles.getByName(id));
  if (!role) throw new HttpError(404, "not_found", "Role not found");
  return role;
}

function parseNewRole(body: unknown): { name: string; description: string; permissions: RoleRecord["permissions"] } {
  const record = bodyOf(body);
  const name = readBoundedString(record.name, "name", { required: true, max: 80 });
  if (!name) throw new HttpError(400, "invalid_body", "name is required");
  const description = readBoundedString(record.description, "description", { required: false, max: 4_000 }) ?? "";
  return { name, description, permissions: readPermissions(record.permissions) };
}

function parseRolePatch(
  record: Record<string, unknown>,
  builtin: boolean,
): { name?: string; description?: string; permissions?: RoleRecord["permissions"] } {
  const patch: { name?: string; description?: string; permissions?: RoleRecord["permissions"] } = {};
  if (Object.prototype.hasOwnProperty.call(record, "name")) {
    if (builtin) throw new HttpError(400, "builtin_role", "Builtin role names cannot be changed");
    const name = readBoundedString(record.name, "name", { required: true, max: 80 });
    if (!name) throw new HttpError(400, "invalid_body", "name is required");
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(record, "description")) {
    patch.description = readBoundedString(record.description, "description", { required: false, max: 4_000 }) ?? "";
  }
  if (Object.prototype.hasOwnProperty.call(record, "permissions")) {
    patch.permissions = readPermissions(record.permissions);
  }
  if (patch.name === undefined && patch.description === undefined && patch.permissions === undefined) {
    throw new HttpError(400, "invalid_body", "No fields to update");
  }
  return patch;
}

export function readPermissions(value: unknown): RoleRecord["permissions"] {
  try {
    return parseRolePermissions(value);
  } catch (error) {
    if (error instanceof PermissionsError) throw new HttpError(400, "invalid_body", error.message);
    throw error;
  }
}

export async function resolveRoleIds(store: Store, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) throw new HttpError(400, "invalid_body", "roleIds must be an array");
  if (value.length > 20) throw new HttpError(400, "invalid_body", "roleIds cannot exceed 20 entries");
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new HttpError(400, "invalid_body", "roleIds must be role ids or names");
    }
    const key = item.trim();
    const role = (await store.roles.get(key)) ?? (await store.roles.getByName(key));
    if (!role) throw new HttpError(400, "unknown_role", `Unknown role ${JSON.stringify(key)}`);
    if (!ids.includes(role.id)) ids.push(role.id);
  }
  return ids;
}

function bodyOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "JSON object expected");
  }
  return body as Record<string, unknown>;
}

function roleWriteError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : "Role update failed";
  if (/already exists/i.test(message)) return new HttpError(409, "role_exists", message);
  if (/builtin/i.test(message)) return new HttpError(409, "builtin_role", message);
  if (/assigned/i.test(message)) return new HttpError(409, "role_in_use", message);
  return new HttpError(400, "invalid_body", message);
}
