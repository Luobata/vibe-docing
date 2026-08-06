import { describe, expect, it } from 'vitest'
import { createMockProvider } from './mock-provider'

const messages = [{ content: 'hello', role: 'user' as const }]

describe('MockProvider', () => {
  it('streams configured chunks and completes with their concatenation', async () => {
    const provider = createMockProvider({ chunks: ['A', 'B'] })
    const chunks: string[] = []
    for await (const chunk of provider.stream(messages)) chunks.push(chunk)

    expect(chunks).toEqual(['A', 'B'])
    expect(await provider.complete(messages)).toBe('AB')
  })

  it('throws after the configured number of emitted chunks', async () => {
    const provider = createMockProvider({ chunks: ['A', 'B'], failAfter: 1 })
    const chunks: string[] = []

    await expect(async () => {
      for await (const chunk of provider.stream(messages)) chunks.push(chunk)
    }).rejects.toThrow('mock stream failure')
    expect(chunks).toEqual(['A'])
  })
})
