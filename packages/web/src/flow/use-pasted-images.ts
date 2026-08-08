import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

export interface PastedImage { id: string; name: string; url: string }

export function usePastedImages() {
  const [images, setImages] = useState<PastedImage[]>([])
  const seq = useRef(0)
  useEffect(() => () => { for (const i of images) URL.revokeObjectURL(i.url) }, [images])
  function addFiles(files: FileList | File[]): void {
    const picked: PastedImage[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      seq.current += 1
      picked.push({ id: `img-${seq.current}`, name: file.name, url: URL.createObjectURL(file) })
    }
    if (picked.length) setImages((c) => [...c, ...picked])
  }
  function removeImage(id: string): void {
    setImages((c) => { const t = c.find((i) => i.id === id); if (t) URL.revokeObjectURL(t.url); return c.filter((i) => i.id !== id) })
  }
  function clear(): void { setImages((c) => { for (const i of c) URL.revokeObjectURL(i.url); return [] }) }
  function handlePaste(e: ClipboardEvent): void { const f = e.clipboardData?.files; if (f && f.length) addFiles(f) }
  function handleDrop(e: DragEvent): void { const f = e.dataTransfer?.files; if (f && f.length) { e.preventDefault(); addFiles(f) } }
  return { images, addFiles, removeImage, clear, handlePaste, handleDrop }
}
