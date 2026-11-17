import app from '../server/index.js'

export default function handler(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost')
  const apiPath = requestUrl.searchParams.get('__api_path')

  if (apiPath?.startsWith('/api/')) {
    requestUrl.searchParams.delete('__api_path')
    req.url = `${apiPath}${requestUrl.search}`
    req.originalUrl = req.url
  }

  return app(req, res)
}
