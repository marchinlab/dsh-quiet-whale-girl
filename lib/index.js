// dsh-quiet-whale-girl — Host（Node）半区
// 把 LivLiv Player 的运行时和两只鲸鱼（p01 / p02）作为同源静态路由提供给
// 浏览器半区，这样 Client 里的 canvas 可以直接 new Player().load() 而不需要外网。
// 所有注册都放进 ctx.effect，插件卸载时会自动撤销。

import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ASSETS = resolve(ROOT, 'assets')
const RUNTIME_DIR = resolve(ASSETS, 'runtime')
const CHARACTERS_DIR = resolve(ASSETS, 'characters')

export const name = 'dsh-quiet-whale-girl'
export const inject = ['webServer']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.css': 'text/css; charset=utf-8',
}

const DEFAULTS = {
  enabled: true,
  character: 'p01',
  size: 260,
  gaze: true,
  autoExpressions: true,
}

function urlPath(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}

/** 安全地在 root 下取文件：绝不允许 ../ 逃出目录 */
function safeTarget(root, relative) {
  let rel = relative
  try {
    rel = decodeURIComponent(rel)
  } catch {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  const target = resolve(root, rel)
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

function registerDir(ctx, prefix, root, label) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          const pathname = urlPath(req)
          const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname
          const target = safeTarget(root, relative)
          if (!target) {
            res.writeHead(403)
            res.end('forbidden')
            return
          }
          try {
            const info = await stat(target)
            if (!info.isFile()) throw new Error('not a file')
            const body = await readFile(target)
            res.writeHead(200, {
              'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
              'content-length': String(body.byteLength),
              'cache-control': 'public, max-age=3600',
            })
            res.end(req.method === 'HEAD' ? undefined : body)
          } catch {
            res.writeHead(404)
            res.end('not found')
          }
        },
      }),
    `dsh-quiet-whale-girl: ${label}`,
  )
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }

  // 给浏览器半区读当前配置（它是一个独立模块，拿不到宿主的 config 对象）
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/quiet-whale-girl/config',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          const body = Buffer.from(JSON.stringify(cfg), 'utf8')
          res.writeHead(200, {
            'content-type': MIME['.json'],
            'content-length': String(body.byteLength),
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : body)
        },
      }),
    'dsh-quiet-whale-girl: client config',
  )

  registerDir(ctx, '/quiet-whale-girl/runtime', RUNTIME_DIR, 'LivLiv Player runtime')
  registerDir(ctx, '/quiet-whale-girl/characters', CHARACTERS_DIR, 'Kujira characters')

  ctx.logger?.info('[dsh-quiet-whale-girl] host loaded; pet assets ready')
}
