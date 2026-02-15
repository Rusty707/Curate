interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T>(): Promise<T | null>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface Env {
  DB: D1Database
}

interface Params {
  id?: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    },
  })
}

export const onRequestGet = async ({
  request,
  env,
  params,
}: {
  request: Request
  env: Env
  params: Params
}) => {
  if (!isSameOrigin(request)) {
    return jsonResponse(request, { error: 'Forbidden origin' }, 403)
  }

  const shareId = params.id || ''
  if (!UUID_REGEX.test(shareId)) {
    return jsonResponse(request, { error: 'Invalid board id' }, 400)
  }

  type Row = { board_json: string; created_at: number }
  let row: Row | null = null
  try {
    row = await env.DB.prepare(
      'SELECT board_json, created_at FROM shared_boards WHERE id = ?1',
    )
      .bind(shareId)
      .first<Row>()
  } catch {
    return jsonResponse(request, { error: 'Database query failed' }, 500)
  }

  if (!row) {
    return jsonResponse(request, { error: 'Board not found' }, 404)
  }

  let board: unknown
  try {
    board = JSON.parse(row.board_json)
  } catch {
    return jsonResponse(request, { error: 'Stored board is invalid' }, 500)
  }

  return jsonResponse(request, {
    id: shareId,
    board,
    createdAt: row.created_at,
  })
}

