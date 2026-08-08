import '@testing-library/jest-dom/vitest'

// jsdom has no Object URL implementation; stub it for image-paste previews.
if (!globalThis.URL.createObjectURL) {
  let counter = 0
  globalThis.URL.createObjectURL = () => `blob:mock/${(counter += 1)}`
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = () => {}
}

// jsdom in this setup exposes a non-functional localStorage (no getItem/
// setItem/clear); provide a minimal in-memory Storage so persistence code
// under test can round-trip.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => { store.delete(key) },
    setItem: (key, value) => { store.set(key, String(value)) },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  })
}
