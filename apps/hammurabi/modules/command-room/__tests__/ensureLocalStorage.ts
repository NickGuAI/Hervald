export function ensureLocalStorage(): Storage {
  try {
    if (window.localStorage) return window.localStorage
  } catch {
    // Fall through to a test-local storage shim when jsdom storage is unavailable.
  }

  const store = new Map<string, string>()
  const storage = {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    get length() {
      return store.size
    },
  } satisfies Storage

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })

  return storage
}
