import { NextResponse } from 'next/server'
import { getBackendInternalUrl } from '@/shared/lib/backend-internal-url'

/** POST /api/webhooks/calendly — proxy al backend FastAPI (match de cuenta + leads). */
const FORWARD_HEADERS = [
  'content-type',
  'calendly-webhook-signature',
  'calendly-webhook-timestamp',
  'user-agent',
] as const

export async function POST(request: Request) {
  const backend = getBackendInternalUrl()
  const incoming = new URL(request.url)
  const target = `${backend}/webhooks/calendly${incoming.search}`

  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let body: string
  try {
    body = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const res = await fetch(target, { method: 'POST', headers, body })
    const text = await res.text()
    const outType = res.headers.get('content-type') || 'application/json'
    return new NextResponse(text, { status: res.status, headers: { 'content-type': outType } })
  } catch {
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}

export async function GET() {
  const backend = getBackendInternalUrl()
  try {
    const res = await fetch(`${backend}/webhooks/calendly`, { method: 'GET' })
    const text = await res.text()
    const outType = res.headers.get('content-type') || 'application/json'
    return new NextResponse(text, { status: res.status, headers: { 'content-type': outType } })
  } catch {
    return NextResponse.json({ status: 'ok', service: 'calendly-webhook' })
  }
}
