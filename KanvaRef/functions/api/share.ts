interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface Env {
  DB: D1Database
}

const MAX_REQUEST_BYTES = 1_000_000
const MAX_BOARD_BYTES = 500 * 1024
const MAX_BOARD_ELEMENTS = 1_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30
const rateLimitByIp = new Map<string, { count: number; windowStart: number }>()

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin')
  if (!origin) {
    return {}
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
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

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) return cfIp
  const xff = request.headers.get('X-Forwarded-For')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const existing = rateLimitByIp.get(ip)

  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitByIp.set(ip, { count: 1, windowStart: now })
    return false
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true
  }

  existing.count += 1
  return false
}

function getArrayElementCount(board: unknown): number | null {
  if (Array.isArray(board)) return board.length
  if (!board || typeof board !== 'object') return null

  let hasArrays = false
  let total = 0
  for (const value of Object.values(board as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    hasArrays = true
    total += value.length
    if (total > MAX_BOARD_ELEMENTS) return total
  }

  return hasArrays ? total : null
}

export const onRequestOptions = async ({ request }: { request: Request }) => {
  if (!isSameOrigin(request)) {
    return jsonResponse(request, { error: 'Forbidden origin' }, 403)
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    },
  })
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!isSameOrigin(request)) {
    return jsonResponse(request, { error: 'Forbidden origin' }, 403)
  }

  if (isRateLimited(getClientIp(request))) {
    return jsonResponse(request, { error: 'Too many requests' }, 429)
  }

  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/json')) {
    return jsonResponse(request, { error: 'Unsupported Media Type' }, 415)
  }

  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_BYTES) {
    return jsonResponse(request, { error: 'Payload too large' }, 413)
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return jsonResponse(request, { error: 'Invalid request body' }, 400)
  }

  if (!rawBody || !rawBody.trim()) {
    return jsonResponse(request, { error: 'Invalid request body' }, 400)
  }

  const bodyBytes = new TextEncoder().encode(rawBody).byteLength
  if (bodyBytes > MAX_REQUEST_BYTES) {
    return jsonResponse(request, { error: 'Payload too large' }, 413)
  }

  let payload: { board?: unknown }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse(request, { error: 'Invalid JSON payload' }, 400)
  }

  if (!payload || typeof payload.board !== 'object' || payload.board === null) {
    return jsonResponse(request, { error: 'Invalid board payload' }, 400)
  }

  const boardJson = JSON.stringify(payload.board)
  if (new TextEncoder().encode(boardJson).byteLength > MAX_BOARD_BYTES) {
    return jsonResponse(request, { error: 'Board exceeds allowed size' }, 400)
  }

  const boardElementCount = getArrayElementCount(payload.board)
  if (boardElementCount !== null && boardElementCount > MAX_BOARD_ELEMENTS) {
    return jsonResponse(request, { error: 'Board exceeds allowed size' }, 400)
  }

  const shareId = crypto.randomUUID()

  try {
    await env.DB.prepare(
      'INSERT INTO shared_boards (id, board_json, created_at) VALUES (?1, ?2, ?3)',
    )
      .bind(shareId, boardJson, Date.now())
      .run()
  } catch {
    return jsonResponse(request, { error: 'Failed to persist board' }, 500)
  }

  return jsonResponse(request, { id: shareId }, 201)
}
