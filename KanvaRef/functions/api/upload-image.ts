const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export const onRequestPost = async ({ request }: { request: Request }) => {
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'Invalid file' }, 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return json({ error: 'Invalid file' }, 400)
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return json({ error: 'Invalid file' }, 400)
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return json({ error: 'Invalid file' }, 400)
  }

  if (file.size <= 0) {
    return json({ error: 'Invalid file' }, 400)
  }

  if (file.size > MAX_FILE_BYTES) {
    return json({ error: 'Payload too large' }, 413)
  }

  return json({ error: 'R2 temporarily disabled' }, 501)
}
