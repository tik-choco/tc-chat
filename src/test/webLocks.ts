// happy-dom has no Web Locks; model the origin-wide exclusive queues for journal tests.
const queues = new Map<string, Promise<unknown>>();
Object.defineProperty(navigator, 'locks', { configurable: true, value: {
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const next = (queues.get(name) ?? Promise.resolve()).then(callback);
    const settled = next.catch(() => {});
    queues.set(name, settled);
    void settled.then(() => { if (queues.get(name) === settled) queues.delete(name); });
    return next;
  },
} });
