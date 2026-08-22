import type { ImageContent } from '@shared/rpc'
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
