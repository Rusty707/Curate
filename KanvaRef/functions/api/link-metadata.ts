interface QueryParams {
  url?: string
}

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin')
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  return origin === new URL(request.url).origin
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...getCorsHeaders(request),
    },
  })
}

function sanitizeUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

function sanitizeImageUrl(raw: string | null, base: URL): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const value = raw.trim()
  const lowered = value.toLowerCase()
  if (
    lowered.startsWith('data:') ||
    lowered.startsWith('blob:') ||
    lowered.startsWith('javascript:')
  ) {
    return ''
  }
  try {
    const resolved = new URL(value, base)
    if (resolved.protocol !== 'https:') return ''
    return resolved.toString()
  } catch {
    return ''
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function extractMetaContent(html: string, key: string): string | null {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i')
  const match = html.match(pattern)
  return match?.[1] ? decodeHtml(match[1]) : null
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1] ? decodeHtml(match[1]) : null
}

function screenshotFallbackUrl(url: string): string {
  return `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(url)}`
}

export const onRequestOptions = async ({ request }: { request: Request }) => {
  if (!isSameOrigin(request)) return jsonResponse(request, { error: 'Forbidden origin' }, 403)
  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    },
  })
}

export const onRequestGet = async ({
  request,
}: {
  request: Request
  params: QueryParams
}) => {
  if (!isSameOrigin(request)) return jsonResponse(request, { error: 'Forbidden origin' }, 403)
  const rawUrl = new URL(request.url).searchParams.get('url') || ''
  const url = sanitizeUrl(rawUrl)
  if (!url) return jsonResponse(request, { error: 'Invalid URL' }, 400)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 7000)

  let html = ''
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'KanvaRefBot/1.0 (+https://kanvaref.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Fetch failed')
    html = await response.text()
  } catch {
    clearTimeout(timeoutId)
    return jsonResponse(request, {
      href: url.toString(),
      title: url.hostname,
      domain: url.hostname.replace(/^www\./, ''),
      siteName: url.hostname.replace(/^www\./, ''),
      imageUrl: screenshotFallbackUrl(url.toString()),
      fallback: true,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  const ogImage = extractMetaContent(html, 'og:image')
  const ogTitle = extractMetaContent(html, 'og:title')
  const ogSiteName = extractMetaContent(html, 'og:site_name')
  const title = ogTitle || extractTitle(html) || url.hostname
  const domain = url.hostname.replace(/^www\./, '')
  const siteName = ogSiteName || domain
  const ogImageUrl = sanitizeImageUrl(ogImage, url)
  const screenshotUrl = screenshotFallbackUrl(url.toString())
  const imageUrl = ogImageUrl || screenshotUrl

  return jsonResponse(request, {
    href: url.toString(),
    title,
    domain,
    siteName,
    ogImageUrl,
    screenshotUrl,
    imageUrl,
    fallback: !ogImageUrl,
  })
}
