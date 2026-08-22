import { useState } from 'react'
import clsx from 'clsx'
import type { ImageContent } from '@shared/rpc'
import { ModalOverlay } from '@/components/Modal'
import { useExtensionUiStore } from '@/stores/extensionUi'

/** Data URL for a chat image (history and pending composer attachments alike). */
export function imageUrl(img: ImageContent): string {
  return `data:${img.mimeType};base64,${img.data}`
}

/**
 * Copy a chat image to the system clipboard and toast the outcome.
 *
 * The write goes through main (`clipboard:writeImage`): the renderer is
 * sandboxed, and the web ClipboardItem API would drop gif/webp/bmp. The
 * browser harness implements the same channel best-effort (png/jpeg).
 */
export async function copyChatImage(img: ImageContent): Promise<void> {
  try {
    await window.pidex.invoke('clipboard:writeImage', {
      data: img.data,
      mimeType: img.mimeType,
    })
    useExtensionUiStore.getState().pushToast('Image copied')
  } catch (error) {
    useExtensionUiStore.getState().pushToast(`Copy failed: ${(error as Error).message}`, 'error')
  }
}

/**
 * One chat image, with the interaction contract that holds everywhere an
 * image appears (composer attachments, user messages, extension messages):
 * hover highlights it so it reads as openable, click opens it full-size, and
 * right-click copies it to the system clipboard.
 *
 * `className` styles the IMG — callers pass their previous size classes
 * verbatim (the 16×16 composer thumbnail, the `max-h-*` history cap). The
 * wrapper button is an unsized inline-flex that hugs the image, so layout is
 * exactly what the old plain `<img>` produced; the ring is the only new
 * geometry, and it is hover-only.
 */
export function ChatImage({
  image,
  className,
}: {
  image: ImageContent
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const src = imageUrl(image)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onContextMenu={(event) => {
          // Copy, not the OS menu: right-click on a chat image is "copy
          // this", per the interaction contract.
          event.preventDefault()
          event.stopPropagation()
          void copyChatImage(image)
        }}
        title="Click to open · right-click to copy"
        className="hover:ring-accent/50 hover:shadow-md inline-flex shrink-0 cursor-zoom-in overflow-hidden rounded-lg outline-none transition-all hover:ring-2"
      >
        <img
          src={src}
          alt="Attached image"
          draggable={false}
          className={clsx('block', className)}
        />
      </button>
      {open && <ImageLightbox image={image} onClose={() => setOpen(false)} copy={copyChatImage} />}
    </>
  )
}

/**
 * Full-size view of a chat image: click the backdrop or press Escape to
 * close, right-click the image to copy it (the same contract as the
 * thumbnails, so copy works from either surface).
 */
export function ImageLightbox({
  image,
  onClose,
  copy,
}: {
  image: ImageContent
  onClose: () => void
  copy: (img: ImageContent) => Promise<void>
}): React.JSX.Element {
  return (
    <ModalOverlay onClose={onClose} backdrop="photo">
      <img
        src={imageUrl(image)}
        alt="Attached image, full size"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copy(image)
        }}
        className="max-h-[90vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
    </ModalOverlay>
  )
}
