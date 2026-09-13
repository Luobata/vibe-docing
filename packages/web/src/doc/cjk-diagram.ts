/** Box Drawing characters identify diagrams without affecting ordinary code. */
export function isCjkDiagram(source: string): boolean {
  return /[\u2500-\u257f]/u.test(source)
}
