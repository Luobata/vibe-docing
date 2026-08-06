export interface AnnotationRange {
  from: number
  id: string
  to: number
}

export interface HighlightRun {
  annId: string | null
  text: string
}

export function splitByAnnotations(
  text: string,
  annotations: AnnotationRange[],
): HighlightRun[] {
  if (!text) return [{ annId: null, text: '' }]

  const normalized = annotations
    .map((annotation, index) => ({
      ...annotation,
      from: Math.max(0, Math.min(text.length, annotation.from)),
      index,
      to: Math.max(0, Math.min(text.length, annotation.to)),
    }))
    .filter((annotation) => annotation.from < annotation.to)
    .sort((left, right) => left.from - right.from || left.index - right.index)
  if (normalized.length === 0) return [{ annId: null, text }]

  const boundaries = new Set<number>([0, text.length])
  for (const annotation of normalized) {
    boundaries.add(annotation.from)
    boundaries.add(annotation.to)
  }
  const points = [...boundaries].sort((left, right) => left - right)
  const runs: HighlightRun[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const owner = normalized.find(
      (annotation) => annotation.from <= from && annotation.to >= to,
    )
    const annId = owner?.id ?? null
    const previous = runs[runs.length - 1]
    if (previous?.annId === annId) previous.text += text.slice(from, to)
    else runs.push({ annId, text: text.slice(from, to) })
  }
  return runs
}
