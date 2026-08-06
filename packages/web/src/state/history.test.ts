import { describe, expect, it } from 'vitest'
import { createHistory } from './history'

describe('navigation history', () => {
  it('supports back/forward and drops a stale forward branch after push', () => {
    const history = createHistory()
    history.push('root')
    history.push('a')
    history.push('b')

    expect(history.back()).toBe('a')
    expect(history.back()).toBe('root')
    expect(history.forward()).toBe('a')
    history.push('c')
    expect(history.canForward()).toBe(false)
    expect(history.back()).toBe('a')
  })
})

