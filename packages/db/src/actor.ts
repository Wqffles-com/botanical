import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

/** User id for the current request, job, or hook. Null outside a user scope. */
export function currentUserId(): string | null {
  return storage.getStore() ?? null;
}

export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.run(userId, fn);
}

/**
 * Return a store view whose method calls run as `userId`.
 * `close` is a no-op so a view cannot shut the shared pool.
 */
export function pinStore<T extends object>(store: T, userId: string): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'forUser') return (id: string) => pinStore(target, id);
      if (prop === 'close') return async () => {};
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => runAsUser(userId, () => (value as (...inner: unknown[]) => unknown).apply(target, args));
      }
      if (value && typeof value === 'object') return pinRepo(value, userId);
      return value;
    },
  }) as T;
}

function pinRepo(repo: object, userId: string): object {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => runAsUser(userId, () => (value as (...inner: unknown[]) => unknown).apply(target, args));
    },
  });
}
