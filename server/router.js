// 极简路由器：方法 + 路径模板（:param）匹配。
// 不引第三方框架，Windows 上零编译依赖。
export function createRouter() {
  const routes = []

  const add = (method, pattern, handler) => {
    const keys = []
    const source = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        keys.push(segment.slice(1))
        return '([^/]+)'
      })
      .join('/')
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, pattern })
  }

  const router = {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    // 返回 { handler, params }；方法不匹配时返回该路由支持的方法。
    match(method, pathname) {
      const allow = []
      for (const route of routes) {
        const found = route.regex.exec(pathname)
        if (!found) continue
        allow.push(route.method)
        if (route.method !== method) continue
        const params = {}
        route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1]) })
        return { handler: route.handler, params, pattern: route.pattern }
      }
      return allow.length ? { methodMismatch: true, allow } : null
    },
  }
  return router
}
