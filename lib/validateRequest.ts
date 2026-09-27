export function validateContentType(req: Request): boolean {
  const contentType = req.headers.get('content-type') || ''
  return contentType.includes('application/json')
}

export function rejectInvalidContentType(req: Request) {
  if (!validateContentType(req)) {
    return new Response(
      JSON.stringify({ error: 'Invalid content type. Only application/json is accepted.' }),
      {
        status: 415,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
  return null
}
