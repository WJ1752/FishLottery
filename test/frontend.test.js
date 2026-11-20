import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 不用 npx / .bin 里的 shell 包装（Windows 上是 .cmd，execFileSync 会 EINVAL），
// 直接用当前 node 去跑 typescript 的 JS 入口，跨平台且不依赖 PATH。
const tscEntry = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')

// 前端「未定义变量」检查。
//
// 为什么需要这条测试：Vite/rolldown 只做语法检查，不做作用域分析。
// 删掉一个 useState 却漏改引用处，构建照样成功，到了浏览器才抛
// ReferenceError，表现为整页白屏（线上真实发生过一次）。
// tsc 的 --checkJs 能准确抓出 TS2304 / TS2552 这类「找不到名字」，
// 所以这里把它接进 npm test，保证同类问题不会再上线。
function undefinedNames(files) {
  const problems = []
  // 逐个文件检查：一次传多个入口时 tsc 会把它们当成一个程序，
  // 某个文件出错会掩盖其他文件的问题。
  for (const file of files) {
    let output = ''
    try {
      output = execFileSync(process.execPath, [
        tscEntry, '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx',
        '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
        // 项目里没有 @types/react，关掉隐式 any 的噪声，只留真正的「找不到名字」。
        '--skipLibCheck', '--noImplicitAny', 'false', file,
      ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      // tsc 发现问题时以非零退出，报错信息在 stdout 里。
      output = `${error.stdout || ''}${error.stderr || ''}`
      // 工具本身跑不起来（缺依赖等）要显式失败，不能当成「没问题」。
      if (!output.trim()) problems.push(`无法运行 tsc 检查 ${file}: ${error.message}`)
    }
    output.split('\n')
      .filter((line) => /error TS(2304|2552|2551):/.test(line))
      .forEach((line) => problems.push(line.trim()))
  }
  return problems
}

test('前端源码里没有「找不到的名字」这类会在运行时炸掉的引用', () => {
  const problems = undefinedNames(['src/main.jsx', 'src/admin.jsx', 'src/fx-chart.jsx'])
  assert.deepEqual(problems, [], `发现未定义引用，构建能过但浏览器会白屏：\n${problems.join('\n')}`)
})

// React #310（Rendered more hooks than during the previous render）的静态守护。
//
// 这类 bug 构建期完全看不出来：组件里先 `if (!x) return <p/>`，后面又写 useEffect，
// 一旦 x 从假变真，Hook 数量就变了，React 直接抛错导致整页崩溃。
// 这里扫每个 `function Xxx(` 的函数体：只要出现「顶层提前 return」，
// 其后就不允许再出现任何 Hook 调用。
function hookOrderProblems(file) {
  const source = readFileSync(join(root, file), 'utf8')
  const lines = source.split('\n')
  const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext|useLayoutEffect)\s*\(/
  const problems = []
  let current = null
  let depth = 0
  let earlyReturnLine = 0

  lines.forEach((line, index) => {
    // 只看组件（首字母大写）。自定义 Hook（useXxx）本身就是 Hook 实现，
    // 里面的 useState/useEffect 不算「组件里的条件 Hook」。
    const funcMatch = line.match(/^(?:export\s+)?function\s+([A-Z]\w*)/)
    if (!funcMatch && /^(?:export\s+)?function\s+use[A-Z]\w*/.test(line)) {
      current = null
      return
    }
    if (funcMatch) {
      current = funcMatch[1]
      depth = 0
      earlyReturnLine = 0
    }
    if (!current) return

    // 函数体顶层（第 1 层缩进内）的 return → 视为提前 return 的起点。
    // 三种形态都要认：
    //   1) `  if (x) return ...`
    //   2) `  return ...`（单行）
    //   3) `  if (x) {` / `  return (` 这种跨行块的起始行（真实踩过的坑就是这种）
    const isInlineIfReturn = /^ {2}if\s*\([^)]*\)\s*return\b/.test(line)
    const isBareReturn = /^ {2}return\b/.test(line)
    const isBlockReturn = /^ {2}return\s*[({<]?\s*$/.test(line)
    const isBlockIf = /^ {2}if\s*\([^)]*\)\s*\{\s*$/.test(line)
    const isEarlyReturn = isInlineIfReturn || (isBareReturn && !/^ {2}return\s*<>?/.test(line)) || isBlockReturn || isBlockIf
    if (isEarlyReturn) earlyReturnLine = earlyReturnLine || index + 1

    if (earlyReturnLine && HOOK.test(line) && index > earlyReturnLine) {
      problems.push(`${file}:${index + 1} 在 ${current} 的提前 return（第 ${earlyReturnLine + 1} 行）之后调用了 Hook`)
      earlyReturnLine = 0
    }
    if (/^}$/.test(line)) current = null
  })
  return problems
}

test('组件里没有「提前 return 之后又调用 Hook」的写法（React #310）', () => {
  const problems = ['src/main.jsx', 'src/admin.jsx', 'src/fx-chart.jsx'].flatMap(hookOrderProblems)
  assert.deepEqual(problems, [], `Hook 顺序会随条件变化，运行时会直接崩溃：\n${problems.join('\n')}`)
})
