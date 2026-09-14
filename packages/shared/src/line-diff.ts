export interface DiffLine {
  text: string
  type: 'same' | 'add' | 'del'
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.split('\n')
  const right = after.split('\n')
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  )

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ text: left[i], type: 'same' })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      result.push({ text: left[i], type: 'del' })
      i += 1
    } else {
      result.push({ text: right[j], type: 'add' })
      j += 1
    }
  }
  while (i < left.length) result.push({ text: left[i++], type: 'del' })
  while (j < right.length) result.push({ text: right[j++], type: 'add' })
  return result
}
