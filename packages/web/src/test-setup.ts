import '@testing-library/jest-dom/vitest'

// jsdom has no Object URL implementation; stub it for image-paste previews.
if (!globalThis.URL.createObjectURL) {
  let counter = 0
  globalThis.URL.createObjectURL = () => `blob:mock/${(counter += 1)}`
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = () => {}
}
