export interface NavigationHistory {
  back(): string | null
  canBack(): boolean
  canForward(): boolean
  forward(): string | null
  push(id: string): void
}

export function createHistory(): NavigationHistory {
  const entries: string[] = []
  let index = -1

  return {
    back() {
      if (index <= 0) return null
      index -= 1
      return entries[index]
    },
    canBack() {
      return index > 0
    },
    canForward() {
      return index >= 0 && index < entries.length - 1
    },
    forward() {
      if (index < 0 || index >= entries.length - 1) return null
      index += 1
      return entries[index]
    },
    push(id) {
      if (entries[index] === id) return
      entries.splice(index + 1)
      entries.push(id)
      index = entries.length - 1
    },
  }
}

