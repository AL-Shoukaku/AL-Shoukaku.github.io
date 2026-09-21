/**
 * 蓝色模式扩展
 *
 * 作用：把主题右下角的"月亮"按钮，从「日间 ⇄ 夜间」二选一，
 *       改成「日间 → 夜间 → 蓝色 → 日间」三态循环。
 *
 * 实现：通过 _config.butterfly.yml 的 inject 注入，不改主题源码，
 *       主题升级时这份定制不会丢失。
 *
 * 原理：主题的切换逻辑写死在 main.js 里（只认 light / dark）；
 *       这里用【捕获阶段】的 click 监听抢在它前面处理，然后
 *       stopPropagation() 阻止主题原本的委托逻辑（绑定在 #rightside 上）。
 */
(function () {
  'use strict'

  var STORAGE_KEY = 'theme' // 复用主题的存储键，格式 { value, expiry }
  var MODES = ['light', 'dark', 'blue']
  var LABEL = { light: '日间', dark: '夜间', blue: '蓝色' }
  var META_COLOR = { light: '#ffffff', dark: '#0d0d0d', blue: '#eaf3fb' }
  // 每种模式对应的按钮图标：太阳 / 月亮 / 水滴
  var ICON = { light: 'fas fa-sun', dark: 'fas fa-moon', blue: 'fas fa-tint' }

  function readTheme() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return undefined
      var data = JSON.parse(raw)
      if (data && data.expiry && Date.now() > data.expiry) {
        localStorage.removeItem(STORAGE_KEY)
        return undefined
      }
      return data && data.value
    } catch (e) {
      return undefined
    }
  }

  function saveTheme(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        value: mode,
        expiry: Date.now() + 2 * 86400000 // 与主题一致：2 天
      }))
    } catch (e) {
      /* 隐私模式 / 禁用存储时忽略 */
    }
  }

  // 更新按钮图标与提示：图标表示"当前模式"，提示表示"点击后会切到哪"
  function updateButton(mode) {
    var btn = document.getElementById('darkmode')
    if (!btn) return

    var next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    btn.title = '切换到' + LABEL[next] + '模式'

    var icon = btn.querySelector('i')
    if (icon && ICON[mode]) icon.className = ICON[mode]
  }

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode)

    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta && META_COLOR[mode]) meta.setAttribute('content', META_COLOR[mode])

    updateButton(mode)
  }

  // 1) 应用已保存的主题。
  //    主题自带的初始化脚本只认识 light / dark，保存为 blue 时它什么都不做，
  //    所以这里补上（头部另有一段内联脚本更早执行，用于避免刷新时闪白屏）。
  var saved = readTheme()
  if (saved && MODES.indexOf(saved) !== -1) {
    applyTheme(saved)
  } else {
    // 首次访问、还没有保存过选择时，也要把图标换成太阳/月亮
    // （主题默认用的是 fa-adjust，白天黑夜共用一个图标）
    var cur = document.documentElement.getAttribute('data-theme')
    updateButton(MODES.indexOf(cur) !== -1 ? cur : 'light')
  }

  // 2) 捕获阶段拦截"月亮"按钮的点击，实现三态循环
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#darkmode')
    if (!btn) return

    e.stopPropagation() // 抢在主题原有逻辑（冒泡委托）之前，阻止它执行

    var cur = document.documentElement.getAttribute('data-theme') || 'light'
    var idx = MODES.indexOf(cur)
    var next = idx === -1 ? 'dark' : MODES[(idx + 1) % MODES.length]

    applyTheme(next)
    saveTheme(next)
  }, true)
})()
