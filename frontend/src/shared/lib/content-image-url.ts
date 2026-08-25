import { resolveMediaUrl } from '@/shared/lib/backend-public-url'

export function proxyImageHostAllowed(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return (
      h.endsWith('cdninstagram.com') ||
      h.endsWith('instagram.com') ||
      h.endsWith('fbcdn.net') ||
      h.endsWith('fbsbx.com') ||
      h.endsWith('ytimg.com') ||
      h.endsWith('googleusercontent.com') ||
      h.endsWith('ggpht.com')
    )
  } catch {
    return false
  }
}

/** URL final para `<img src>`: `/media/*` local o proxy solo para hosts de IG/YouTube. */
export function contentImageSrc(raw: string | null | undefined): string {
  const path = (raw || '').trim()
  if (!path) return ''
  if (path.startsWith('/') && !path.startsWith('//')) return resolveMediaUrl(path)
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return proxyImageHostAllowed(path) ? `/api/proxy-image?url=${encodeURIComponent(path)}` : path
  }
  return resolveMediaUrl(path)
}
