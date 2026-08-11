declare module 'markdown-it' {
  interface MarkdownToken {
    content: string
    info: string
  }

  type MarkdownRenderRule = (
    tokens: MarkdownToken[],
    index: number,
    options: unknown,
    env: unknown,
    self: MarkdownRenderer,
  ) => string

  interface MarkdownRenderer {
    rules: { fence?: MarkdownRenderRule }
  }

  export default class MarkdownIt {
    constructor(options?: { html?: boolean; linkify?: boolean; typographer?: boolean })
    readonly renderer: MarkdownRenderer
    render(source: string): string
  }
}
