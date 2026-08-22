/**
 * 围栏代码块空行规整。
 *
 * 背景：AI 生成的 ASCII 图 / 代码块常见病态排版——每两个内容行之间都插一个空行
 * （"\n\n" 连缀），渲染出来行距翻倍、观感"空了一行"。本工具识别这种病态模式并
 * 剥离空行；正常代码块（有意空行、连续空行不多）原样保留，不做任何改动。
 */

function isFenceLine(line: string): boolean {
  return /^\s{0,3}```/.test(line)
}

function normalizeFenceBody(body: string[]): string[] {
  if (body.length === 0) return body
  const nonBlank = body.filter((line) => line.trim() !== '').length
  const blank = body.length - nonBlank
  if (blank === 0 || nonBlank === 0) return body

  // 统计"内容行后紧跟空行"的交替次数；病态特征是几乎每个内容行后面都垫一个空行，
  // 且规模上足以排除巧合（≥3 次）。正常代码块的偶发空行一律不动。
  let alternations = 0
  for (let i = 0; i < body.length - 1; i += 1) {
    if (body[i].trim() !== '' && body[i + 1].trim() === '') alternations += 1
  }
  const pathological = nonBlank >= 2 && alternations >= 3 && alternations >= nonBlank - 1
  if (!pathological) return body

  return body.filter((line) => line.trim() !== '')
}

/**
 * 规整 markdown 中围栏代码块内的病态空行；仅改动命中病态模式的围栏内容，
 * 其余文本（围栏外的空行、正常围栏）逐字保留。
 */
export function normalizeFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let fenceStart = -1

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (isFenceLine(line)) {
      if (fenceStart === -1) {
        fenceStart = i
      } else {
        out.push(...normalizeFenceBody(lines.slice(fenceStart + 1, i)))
        fenceStart = -1
      }
      out.push(line)
      continue
    }
    if (fenceStart === -1) out.push(line)
  }
  // 未闭合围栏（编辑到一半）同样处理。
  if (fenceStart !== -1) out.push(...normalizeFenceBody(lines.slice(fenceStart + 1)))
  return out.join('\n')
}
