import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders title', () => {
    render(<App api={{ listTrees: () => new Promise(() => {}) } as never} />)

    expect(screen.getByText('树形对话工作台')).toBeInTheDocument()
  })
})
