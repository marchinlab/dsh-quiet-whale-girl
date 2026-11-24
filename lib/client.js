/* dsh-quiet-whale-girl — 浏览器（Client）半区
 *
 * 在 DSH Web GUI 上挂一只「安静的鲸鱼娘」浮层桌宠。
 * 用 LivLiv Player 渲染，运行时与角色都由宿主半区的同源路由提供，不依赖外网。
 * 手写 __ModuleLoader__ 工厂，无前端构建步骤。
 *
 * 交互约定（0.1.2 起）：
 *   - 整只桌宠都能拖，不再只有顶端 22px 的隐形条；
 *   - 悬停（或刚出现的那几秒）显示控制条：换形象 + 表情选择；
 *   - canvas 自己不吃指针事件，所有指针都落在自建的交互层上，避免
 *     LivLiv Player 的指针跟踪把点击吞掉。
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
      const CHARS = { p01: 'Kujira', p02: 'Kujira Q' }
      // 角色自带的四张表情（见 model.json 的 expressions）+ 默认
      const EXPRESSIONS = [
        { id: null, label: '默认' },
        { id: 'smile', label: '笑' },
        { id: 'shy', label: '害羞' },
        { id: 'angry', label: '生气' },
        { id: 'sad', label: '难过' },
      ]
      const TAP_ACTS = ['nod', 'tilt', 'shy']
      const RATIO = 1.45
      const EDGE = 4
      const MIN_VISIBLE = 48

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

      const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

      function viewport() {
        try {
          return {
            w: window.innerWidth || document.documentElement.clientWidth || 1280,
            h: window.innerHeight || document.documentElement.clientHeight || 800,
          }
        } catch {
          return { w: 1280, h: 800 }
        }
      }

      function defaultPos(size) {
        const v = viewport()
        return {
          x: Math.max(EDGE, v.w - size - 24),
          y: Math.max(EDGE, v.h - Math.round(size * RATIO) - 24),
        }
      }

      const CHIP = {
        border: '0',
        borderRadius: 999,
        padding: '3px 8px',
        color: '#0d1b2a',
        font: '11px/1.35 system-ui, "Microsoft YaHei", sans-serif',
        background: 'rgba(255,255,255,0.86)',
        boxShadow: '0 1px 3px rgba(12,24,40,0.22)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }
      const CHIP_ON = {
        background: 'rgba(28,110,196,0.92)',
        color: '#fff',
      }

      function WhaleLayer() {
        const [state, setState] = useStickyState(DEFAULTS)
        const [pos, setPos] = useState(() => {
          const w = Number(state.size) || DEFAULTS.size
          if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
            return { x: state.x, y: state.y }
          }
          return defaultPos(w)
        })
        const posRef = useRef(pos)
        const [expr, setExpr] = useState(null) // 手选表情；null = 默认
        const [dragging, setDragging] = useState(false)
        const [hint, setHint] = useState(true)
        const [err, setErr] = useState('')
        const canvasRef = useRef(null)
        const playerRef = useRef(null)
        const dragRef = useRef(null)
        const flashRef = useRef(0)
        const size = Number(state.size) || DEFAULTS.size

        const moveTo = useCallback((x, y) => {
          posRef.current = { x, y }
          setPos({ x, y })
        }, [])

        const clampInto = useCallback(() => {
          const v = viewport()
          const w = Number(state.size) || DEFAULTS.size
          const next = {
            x: clamp(posRef.current.x, EDGE - w + MIN_VISIBLE, v.w - MIN_VISIBLE),
            y: clamp(posRef.current.y, EDGE, v.h - MIN_VISIBLE),
          }
          if (next.x !== posRef.current.x || next.y !== posRef.current.y) moveTo(next.x, next.y)
        }, [state.size, moveTo])

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
              // 位置是本地状态，别被站点配置覆盖掉
              if (Number.isFinite(prev.x)) next.x = prev.x
              if (Number.isFinite(prev.y)) next.y = prev.y
              return next
            })
          })
          return () => {
            alive = false
          }
        }, [])

        // 窗口尺寸变化时把桌宠拉回可见范围
        useEffect(() => {
          clampInto()
          window.addEventListener('resize', clampInto)
          return () => window.removeEventListener('resize', clampInto)
        }, [clampInto])

        // 控制条只在前几秒露一下，之后靠悬停
        useEffect(() => {
          const t = setTimeout(() => setHint(false), 4200)
          return () => clearTimeout(t)
        }, [])

        // 初始化 / 切换角色时重建 Player
        useEffect(() => {
          if (!state.enabled) return
          const canvas = canvasRef.current
          if (!canvas) return
          let alive = true
          let player = null
          let idleTimer = null
          let onMove = null
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
              // 换形象后把手选表情续上
              if (expr) {
                try {
                  player.setExpression(expr, 1)
                } catch {}
              }

              // 全窗鼠标视线跟随：pointer 位置换算成 -1..1（y 向上）
              if (state.gaze) {
                onMove = (e) => {
                  const b = canvas.getBoundingClientRect()
                  if (!b.width || !b.height) return
                  const x = clamp(((e.clientX - b.left) / b.width) * 2 - 1, -1, 1)
                  const y = clamp(1 - ((e.clientY - b.top) / b.height) * 2, -1, 1)
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
                    else if (!expr) {
                      const pick = gentle[Math.floor(Math.random() * gentle.length)]
                      player.setExpression(pick, 0.75)
                    }
                  } catch {}
                  idleTimer = setTimeout(tick, 9000 + Math.random() * 12000)
                }
                idleTimer = setTimeout(tick, 7000)
              }

              canvas.__whaleCleanup = () => {
                if (onMove) window.removeEventListener('pointermove', onMove)
                if (idleTimer) clearTimeout(idleTimer)
              }
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
            if (flashRef.current) {
              clearTimeout(flashRef.current)
              flashRef.current = 0
            }
            try {
              if (player) player.dispose()
            } catch {}
            if (playerRef.current === player) playerRef.current = null
          }
        }, [state.enabled, state.character, state.gaze, state.autoExpressions])

        // 点一下角色：轻反应
        const tap = useCallback(() => {
          const p = playerRef.current
          if (!p) return
          try {
            p.act(TAP_ACTS[Math.floor(Math.random() * TAP_ACTS.length)])
          } catch {}
          try {
            p.blink()
          } catch {}
          if (expr) return
          const pick = Math.random() < 0.5 ? 'smile' : 'shy'
          try {
            p.setExpression(pick, 1)
          } catch {}
          if (flashRef.current) clearTimeout(flashRef.current)
          flashRef.current = setTimeout(() => {
            const cur = playerRef.current
            flashRef.current = 0
            try {
              if (cur) cur.setExpression(null)
            } catch {}
          }, 1600)
        }, [expr])

        // 拖动：整只都能抓；没移动就当成点击
        const onPointerDown = useCallback((e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          dragRef.current = {
            id: e.pointerId,
            sx: e.clientX,
            sy: e.clientY,
            ox: posRef.current.x,
            oy: posRef.current.y,
            moved: false,
          }
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {}
          setDragging(true)
        }, [])

        useEffect(() => {
          const onMove = (e) => {
            const d = dragRef.current
            if (!d || e.pointerId !== d.id) return
            const dx = e.clientX - d.sx
            const dy = e.clientY - d.sy
            if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return
            d.moved = true
            const v = viewport()
            moveTo(
              clamp(d.ox + dx, EDGE - size + MIN_VISIBLE, v.w - MIN_VISIBLE),
              clamp(d.oy + dy, EDGE, v.h - MIN_VISIBLE),
            )
          }
          const onUp = () => {
            const d = dragRef.current
            dragRef.current = null
            setDragging(false)
            if (!d) return
            if (d.moved) {
              // 拖完才落盘，避免每帧写一次 localStorage
              setState({ x: posRef.current.x, y: posRef.current.y })
            } else {
              tap()
            }
          }
          window.addEventListener('pointermove', onMove, { passive: true })
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
          }
        }, [moveTo, setState, size, tap])

        const toggleCharacter = useCallback(() => {
          setState((prev) => ({ character: prev.character === 'p02' ? 'p01' : 'p02' }))
        }, [setState])

        const chooseExpr = useCallback((id) => {
          setExpr(id)
          const p = playerRef.current
          try {
            if (p) p.setExpression(id, 1)
          } catch {}
        }, [])

        if (!state.enabled) return null

        const hgt = Math.round(size * RATIO)
        const rootStyle = {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: size,
          height: hgt,
          zIndex: 2147483000,
          userSelect: 'none',
          // 浮层父级是 pointer-events:none，这句把命中测试还给自己
          pointerEvents: 'auto',
          touchAction: 'none',
          filter: 'drop-shadow(0 6px 18px rgba(0,0,0,.35))',
        }
        const canvasStyle = {
          width: '100%',
          height: '100%',
          display: 'block',
          borderRadius: 12,
          // 指针全交给上层交互层，避免 Player 的指针跟踪吞掉点击
          pointerEvents: 'none',
        }
        const surfaceStyle = {
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }
        const toolsStyle = {
          position: 'absolute',
          right: 2,
          bottom: 2,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
          maxWidth: size - 4,
        }
        const rowStyle = { display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }
        const stop = (e) => e.stopPropagation()

        return h(
          'div',
          {
            style: rootStyle,
            'data-quiet-whale': '1',
            'data-hint': hint ? '1' : '0',
            'data-dragging': dragging ? '1' : '0',
          },
          h('canvas', { ref: canvasRef, style: canvasStyle }),
          h('div', {
            style: surfaceStyle,
            onPointerDown,
            title: '拖动移动 · 单击互动',
          }),
          h(
            'div',
            { style: toolsStyle, className: 'qwg-tools' },
            h(
              'button',
              {
                type: 'button',
                style: { ...CHIP, fontWeight: 600 },
                onPointerDown: stop,
                onClick: toggleCharacter,
                title: '切换 Kujira / Kujira Q',
              },
              '形象：' + (CHARS[state.character] || '鲸鱼娘'),
            ),
            h(
              'div',
              { style: rowStyle },
              EXPRESSIONS.map((item) =>
                h(
                  'button',
                  {
                    key: item.id === null ? 'none' : item.id,
                    type: 'button',
                    style: { ...CHIP, ...(expr === item.id ? CHIP_ON : null) },
                    onPointerDown: stop,
                    onClick: () => chooseExpr(item.id),
                    title: '表情：' + item.label,
                  },
                  item.label,
                ),
              ),
            ),
          ),
          err
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    left: 6,
                    right: 6,
                    bottom: 6,
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'rgba(120,20,30,.72)',
                    color: '#fff',
                    font: '11px/1.4 system-ui',
                    zIndex: 6,
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
            style.textContent = [
              '[data-quiet-whale]{pointer-events:auto}',
              '[data-quiet-whale] canvas{touch-action:none}',
              '[data-quiet-whale] .qwg-tools{opacity:0;pointer-events:none;transition:opacity .18s ease}',
              '[data-quiet-whale][data-hint="1"] .qwg-tools,',
              '[data-quiet-whale]:hover .qwg-tools,',
              '[data-quiet-whale][data-dragging="1"] .qwg-tools{opacity:1;pointer-events:auto}',
            ].join('\n')
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
