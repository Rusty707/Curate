interface QueryParams {
  url?: string
  proxy?: string
}

const HTML_FETCH_TIMEOUT_MS = 7000
const IMAGE_FETCH_TIMEOUT_MS = 8000

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
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    const parsed = new URL(input.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch {
    return null
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

function sanitizeImageCandidate(raw: string | null, base: URL): string {
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
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return ''
    return resolved.toString()
  } catch {
    return ''
  }
}

function screenshotFallbackUrl(href: string): string {
  return `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(href)}`
}

function buildProxyUrl(request: Request, sourceUrl: string): string {
  const parsed = new URL(request.url)
  parsed.searchParams.delete('url')
  parsed.searchParams.set('proxy', sourceUrl)
  return parsed.toString()
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function canProxyImage(sourceUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(sourceUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'KanvaRefBot/1.0 (+https://kanvaref.app)',
      },
      redirect: 'follow',
    }, IMAGE_FETCH_TIMEOUT_MS)
    if (!response.ok) return false
    const contentType = response.headers.get('content-type') || ''
    return contentType.toLowerCase().startsWith('image/')
  } catch {
    return false
  }
}

async function handleProxyRequest(request: Request, sourceRaw: string): Promise<Response> {
  const source = sanitizeUrl(sourceRaw)
  if (!source) return jsonResponse(request, { error: 'Invalid proxy URL' }, 400)
  try {
    const response = await fetchWithTimeout(source.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'KanvaRefBot/1.0 (+https://kanvaref.app)',
      },
      redirect: 'follow',
    }, IMAGE_FETCH_TIMEOUT_MS)
    if (!response.ok) return jsonResponse(request, { error: 'Upstream image fetch failed' }, 502)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return jsonResponse(request, { error: 'Upstream response is not an image' }, 415)
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=1800',
        ...getCorsHeaders(request),
      },
    })
  } catch {
    return jsonResponse(request, { error: 'Image proxy error' }, 504)
  }
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
  const parsedRequestUrl = new URL(request.url)
  const proxyRaw = parsedRequestUrl.searchParams.get('proxy') || ''
  if (proxyRaw) {
    return handleProxyRequest(request, proxyRaw)
  }

  const rawUrl = parsedRequestUrl.searchParams.get('url') || ''
  const target = sanitizeUrl(rawUrl)
  if (!target) return jsonResponse(request, { error: 'Invalid URL' }, 400)

  let html = ''
  try {
    const response = await fetchWithTimeout(target.toString(), {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'KanvaRefBot/1.0 (+https://kanvaref.app)',
      },
      redirect: 'follow',
    }, HTML_FETCH_TIMEOUT_MS)
    if (!response.ok) throw new Error('HTML fetch failed')
    html = await response.text()
  } catch {
    const screenshot = screenshotFallbackUrl(target.toString())
    const usable = await canProxyImage(screenshot)
    return jsonResponse(request, {
      href: target.toString(),
      title: target.hostname.replace(/^www\./, ''),
      domain: target.hostname.replace(/^www\./, ''),
      siteName: target.hostname.replace(/^www\./, ''),
      imageUrl: usable ? buildProxyUrl(request, screenshot) : '',
      fallback: true,
    })
  }

  const domain = target.hostname.replace(/^www\./, '')
  const ogTitle = extractMetaContent(html, 'og:title')
  const ogSiteName = extractMetaContent(html, 'og:site_name')
  const ogImage = extractMetaContent(html, 'og:image')
  const title = ogTitle || extractTitle(html) || domain
  const siteName = ogSiteName || domain

  const candidates = [
    sanitizeImageCandidate(ogImage, target),
    screenshotFallbackUrl(target.toString()),
  ].filter(Boolean)

  let proxiedImageUrl = ''
  for (const candidate of candidates) {
    if (!(await canProxyImage(candidate))) continue
    proxiedImageUrl = buildProxyUrl(request, candidate)
    break
  }

  return jsonResponse(request, {
    href: target.toString(),
    title,
    domain,
    siteName,
    imageUrl: proxiedImageUrl,
    fallback: !proxiedImageUrl,
  })
}
