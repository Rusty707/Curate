interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>
}

interface Env {
  IMAGES: R2Bucket
  R2_PUBLIC_URL?: string
}

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

function extensionFromMime(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  return 'bin'
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
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

  const publicBaseUrl = (env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (!publicBaseUrl || publicBaseUrl.includes('<your-public-r2-domain>')) {
    return json({ error: 'Server misconfigured' }, 500)
  }

  const filename = `${crypto.randomUUID()}.${extensionFromMime(file.type)}`

  try {
    await env.IMAGES.put(filename, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    })
  } catch {
    return json({ error: 'Server error' }, 500)
  }

  return json({ url: `${publicBaseUrl}/${filename}` }, 200)
}
