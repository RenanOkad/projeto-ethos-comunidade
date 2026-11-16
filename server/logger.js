const redact = (value) => String(value)
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email ocultado]')
  .replace(/\b(?:sb_(?:secret|publishable)_|sk-ant-)[A-Za-z0-9_-]+\b/g, '[chave ocultada]')
  .replace(/\b(password|pin|token|authorization|cookie)(["'\s:=]+)[^\s,;]+/gi, '$1$2[valor ocultado]')
  .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[token ocultado]')
  .replace(/\b\d{10,15}\b/g, '[número ocultado]')
  .slice(0, 1000)

export function log(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  }
  console[level](JSON.stringify(entry))
}

export function errorDetails(error) {
  const stack = typeof error?.stack === 'string'
    ? error.stack.split('\n').slice(1).join('\n')
    : undefined
  return {
    errorName: error?.name || 'Error',
    errorCode: error?.code,
    errorStatus: error?.status,
    errorMessage: redact(error?.message || 'Erro desconhecido'),
    ...(stack ? { stack: redact(stack) } : {})
  }
}
