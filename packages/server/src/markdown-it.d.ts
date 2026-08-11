declare module 'markdown-it' {
  export default class MarkdownIt {
    constructor(options?: { html?: boolean; linkify?: boolean; typographer?: boolean })
    render(source: string): string
  }
}
