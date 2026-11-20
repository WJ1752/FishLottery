const silent = process.env.LOG_SILENT === '1'

const emit = (level, message, detail) => {
  if (silent) return
  const line = detail
    ? `${new Date().toISOString()} ${level} ${message} ${JSON.stringify(detail)}`
    : `${new Date().toISOString()} ${level} ${message}`
  if (level === 'ERROR') console.error(line)
  else console.log(line)
}

export const log = {
  info: (message, detail) => emit('INFO', message, detail),
  warn: (message, detail) => emit('WARN', message, detail),
  error: (message, detail) => emit('ERROR', message, detail),
}
