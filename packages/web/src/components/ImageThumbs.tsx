import type { PastedImage } from '../flow/use-pasted-images'

export function ImageThumbs({ images, onRemove }: { images: PastedImage[]; onRemove(id: string): void }) {
  if (images.length === 0) return null
  return (
    <div className="chat-images">
      {images.map((image) => (
        <span className="chat-image-thumb" data-testid="chat-image-thumb" key={image.id}>
          <img alt={image.name} src={image.url} />
          <button aria-label="移除图片" onClick={() => onRemove(image.id)} type="button">×</button>
        </span>
      ))}
    </div>
  )
}
