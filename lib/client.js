/* dsh-quiet-whale-girl — 浏览器（Client）半区
 *
 * 在 DSH Web GUI 上挂一只「安静的鲸鱼娘」浮层桌宠。
 * 用 LivLiv Player 渲染，运行时与角色都由宿主半区的同源路由提供，不依赖外网。
 * 手写 __ModuleLoader__ 工厂，无前端构建步骤。
 */
;(() => {
  function makeFactory() {
    return (require) => {
      const module = { exports: {} }
      const React = require('react')
      const { useEffect, useRef, useState, useCallback } = React
      const h = React.createElement

      const name = 'quiet-whale-girl'
      const inject = ['slots']

      // 路由前缀：允许宿主页面把它挂在某个子路径下
      const PREFIX = (() => {
        try {
          const g = window.__QUIET_WHALE_PREFIX__ || window.__DSH_MOUNT_PREFIX__
          if (typeof g === 'string' && g) return g.replace(/\/+$/, '')
        } catch {}
        return ''
      })()
      const api = (p) => PREFIX + '/quiet-whale-girl' + p

      const STORE = 'dsh-quiet-whale-girl.v1'
      const DEFAULTS = {
        enabled: true,
        character: 'p01',
        size: 260,
        gaze: true,
        autoExpressions: true,
      }
      const safeLocal = (() => {
        try {
          return window.localStorage
        } catch {
          return null
        }
      })()
      const mem = {}
      const readStore = () => {
        let raw = null
        try {
          raw = safeLocal && safeLocal.getItem(STORE)
        } catch {}
        if (!raw) raw = mem[STORE] || null
        try {
          return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
        } catch {
          return { ...DEFAULTS }
        }
      }
      const writeStore = (v) => {
        mem[STORE] = JSON.stringify(v)
        try {
          if (safeLocal) safeLocal.setItem(STORE, mem[STORE])
        } catch {}
      }

      // 站点级配置（来自宿主半区），失败就用本地默认值
      async function hostConfig() {
        try {
          const r = await fetch(api('/config'), { cache: 'no-store' })
          if (!r.ok) return { ...DEFAULTS }
          return { ...DEFAULTS, ...(await r.json()) }
        } catch {
          return { ...DEFAULTS }
        }
      }

      // 动态 import LivLiv Player（浏览器原生 import，绝对路径）
      let playerModulePromise = null
      function loadPlayerModule() {
        if (!playerModulePromise) {
          playerModulePromise = import(/* @vite-ignore */ api('/runtime/index.js'))
        }
        return playerModulePromise
      }

      const CHARS = {
        p01: 'Kujira',
        p02: 'Kujira Q',
      }

      function useStickyState(initial) {
        const [value, setValue] = useState(() => ({ ...initial, ...readStore() }))
        const set = useCallback((patch) => {
          setValue((prev) => {
            const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
            writeStore(next)
            return next
          })
        }, [])
        return [value, set]
      }

      const DRAG_BAR = {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 22,
        cursor: 'grab',
        zIndex: 3,
        touchAction: 'none',
      }
      const BTN = {
        border: '0',
        borderRadius: 8,
        padding: '3px 8px',
        color: '#eaf4ff',
        font: '12px/1.2 system-ui, "Microsoft YaHei", sans-serif',
        background: 'rgba(18,26,38,0.45)',
        cursor: 'pointer',
      }

      function WhaleLayer() {
        const [state, setState] = useStickyState(DEFAULTS)
        const [pos, setPos] = useState(() => {
          try {
            return {
              x: Math.max(8, window.innerWidth - DEFAULTS.size - 24),
              y: Math.max(8, window.innerHeight - Math.round(DEFAULTS.size * 1.45) - 24),
            }
          } catch {
            return { x: 24, y: 24 }
          }
        })
        const [err, setErr] = useState('')
        const canvasRef = useRef(null)
        const playerRef = useRef(null)
        const dragRef = useRef(null)

        // 拉宿主配置（只在首次挂载时，用户本地改动优先）
        useEffect(() => {
          let alive = true
          hostConfig().then((cfg) => {
            if (!alive) return
            setState((prev) => {
              const next = { ...cfg }
              try {
                const raw = safeLocal && safeLocal.getItem(STORE)
                if (raw) Object.assign(next, JSON.parse(raw))
              } catch {}
              return next
            })
          })
          return () => {
            alive = false
          }
        }, [])

        // 初始化 / 切换角色时重建 Player
        useEffect(() => {
          if (!state.enabled) return
          const canvas = canvasRef.current
          if (!canvas) return
          let alive = true
          let player = null
          let idleTimer = null
          ;(async () => {
            try {
              const { Player } = await loadPlayerModule()
              if (!alive || !canvasRef.current) return
              player = new Player(canvas, { followPointer: false, maxPixelRatio: 2 })
              playerRef.current = player
              await player.load(api('/characters/' + state.character + '/'))
              if (!alive) {
                player.dispose()
                return
              }
              setErr('')

              // 全窗鼠标视线跟随：pointer 位置换算成 -1..1（y 向上）
              let onMove = null
              if (state.gaze) {
                onMove = (e) => {
                  const b = canvas.getBoundingClientRect()
                  const x = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1))
                  const y = Math.max(-1, Math.min(1, 1 - ((e.clientY - b.top) / b.height) * 2))
                  try {
                    player.lookAt(x, y)
                  } catch {}
                }
                window.addEventListener('pointermove', onMove, { passive: true })
              }

              // 「安静」：偶尔眨眼 / 浅笑，间隔较长，不做夸张演出
              if (state.autoExpressions) {
                const gentle = ['smile', 'shy', null]
                const tick = () => {
                  if (!alive || !playerRef.current) return
                  try {
                    if (Math.random() < 0.5) player.blink()
                    else {
                      const pick = gentle[Math.floor(Math.random() * gentle.length)]
                      player.setExpression(pick, 0.75)
                    }
                  } catch {}
                  idleTimer = setTimeout(tick, 9000 + Math.random() * 12000)
                }
                idleTimer = setTimeout(tick, 6000)
              }

              // 卸载时清理跟随与定时器
              const cleanupExtra = () => {
                if (onMove) window.removeEventListener('pointermove', onMove)
                if (idleTimer) clearTimeout(idleTimer)
              }
              canvas.__whaleCleanup = cleanupExtra
            } catch (e) {
              if (alive) setErr(e && e.message ? e.message : String(e))
            }
          })()
          return () => {
            alive = false
            const c = canvasRef.current
            if (c && c.__whaleCleanup) {
              c.__whaleCleanup()
              c.__whaleCleanup = null
            }
            try {
              if (player) player.dispose()
            } catch {}
            if (playerRef.current === player) playerRef.current = null
          }
        }, [state.enabled, state.character])

        // 拖动：透明标题条
        const onDown = useCallback(
          (e) => {
            if (e.button !== 0) return
            dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {}
          },
          [pos],
        )
        const onDrag = useCallback((e) => {
          const d = dragRef.current
          if (!d) return
          setPos({
            x: Math.max(0, Math.min(window.innerWidth - 40, e.clientX - d.dx)),
            y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)),
          })
        }, [])
        const onUp = useCallback(() => {
          dragRef.current = null
        }, [])

        // 点角色：轻反应（动作 + 表情）
        const onPet = useCallback(() => {
          const p = playerRef.current
          if (!p) return
          try {
            const acts = ['nod', 'tilt', 'shy']
            p.act(acts[Math.floor(Math.random() * acts.length)])
            p.setExpression(Math.random() < 0.5 ? 'smile' : 'shy', 1)
            setTimeout(() => {
              try {
                p.setExpression(null)
              } catch {}
            }, 1600)
          } catch {}
        }, [])

        const toggleCharacter = useCallback(() => {
          setState({ character: state.character === 'p01' ? 'p02' : 'p01' })
        }, [state.character, setState])

        if (!state.enabled) return null

        const w = state.size
        const hgt = Math.round(w * 1.45)
        const rootStyle = {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: w,
          height: hgt,
          zIndex: 2147483000,
          userSelect: 'none',
          filter: 'drop-shadow(0 6px 18px rgba(0,0,0,.35))',
        }
        const canvasStyle = {
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'pointer',
          borderRadius: 12,
        }
        const barStyle = {
          ...BTN,
          position: 'absolute',
          right: 6,
          top: 26,
          zIndex: 4,
          padding: '2px 7px',
        }

        return h(
          'div',
          { style: rootStyle, 'data-quiet-whale': '1' },
          h('div', {
            style: DRAG_BAR,
            onPointerDown: onDown,
            onPointerMove: onDrag,
            onPointerUp: onUp,
            onPointerCancel: onUp,
            title: '拖动移动 · 单击角色互动',
          }),
          h('canvas', { ref: canvasRef, style: canvasStyle, onClick: onPet }),
          h('button', { style: barStyle, onClick: toggleCharacter, title: '切换 Kujira / Kujira Q' }, CHARS[state.character] || '鲸鱼娘'),
          err
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: 8,
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'rgba(120,20,30,.72)',
                    color: '#fff',
                    font: '11px/1.4 system-ui',
                    zIndex: 5,
                  },
                },
                '鲸鱼娘加载失败：' + err,
              )
            : null,
        )
      }

      function apply(ctx) {
        try {
          ctx.effect(() => {
            const style = document.createElement('style')
            style.dataset.plugin = 'dsh-quiet-whale-girl'
            style.textContent = '[data-quiet-whale] canvas{touch-action:none}'
            document.head.appendChild(style)
            return () => style.remove()
          }, 'dsh-quiet-whale-girl: styles')

          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'quiet-whale-girl-pet', order: 900 },
              WhaleLayer,
            ),
          )
          console.info('[dsh-quiet-whale-girl] client mounted')
        } catch (e) {
          console.warn('[dsh-quiet-whale-girl] client mount skipped:', e)
        }
      }

      module.exports = { name, inject, apply }
      return module.exports
    }
  }

  window.__ModuleLoader__.load({
    id: 'dsh-quiet-whale-girl',
    factory: makeFactory(),
  })
})()
