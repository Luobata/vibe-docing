import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

export interface PastedImage { id: string; name: string; url: string }

export function usePastedImages() {
  const [images, setImages] = useState<PastedImage[]>([])
  const seq = useRef(0)
  // Hold the live images in a ref and revoke ONLY on unmount. Keying the cleanup
  // on [images] would revoke a still-mounted thumbnail's URL on every add.
  // Per-item revokes remain in removeImage/clear for explicit disposal.
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => { for (const i of imagesRef.current) URL.revokeObjectURL(i.url) }, [])
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
