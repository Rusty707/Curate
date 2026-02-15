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

const MAX_BOARD_BYTES = 1_000_000

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

  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/json')) {
    return jsonResponse(request, { error: 'Unsupported Media Type' }, 415)
  }

  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BOARD_BYTES) {
    return jsonResponse(request, { error: 'Payload too large' }, 413)
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return jsonResponse(request, { error: 'Invalid request body' }, 400)
  }

  const bodyBytes = new TextEncoder().encode(rawBody).byteLength
  if (!bodyBytes || bodyBytes > MAX_BOARD_BYTES) {
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

  const shareId = crypto.randomUUID()
  const boardJson = JSON.stringify(payload.board)

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

