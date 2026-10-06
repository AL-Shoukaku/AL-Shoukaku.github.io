/**
 * Butterfly 访问统计：使用自建不蒜子的公共 API。
 * 文档：https://github.com/soxft/busuanzi/wiki/Usage
 * 通过 CDN.option.busuanzi 加载，不修改主题源码。
 * 新服务独立计数，不继承原不蒜子的历史数据。
 */
(function () {
  'use strict'

  if (window.__blogVisitCounterInitialized) return
  window.__blogVisitCounterInitialized = true
  // 本脚本自行监听 Pjax，避免主题重新执行脚本而重复计数。
  if (document.currentScript) document.currentScript.removeAttribute('data-pjax')

  const API_URL = 'https://busuanzi.9420.ltd/api'
  const IDENTITY_KEY = 'visit-counter:busuanzi.9420.ltd:identity'
  const TIMEOUT_MS = 10000
  const COUNTERS = ['site_uv', 'site_pv', 'page_pv']
  let activeRequest = null

  function readIdentity() {
    try {
      return localStorage.getItem(IDENTITY_KEY)
    } catch (error) {
      return null
    }
  }

  function saveIdentity(identity) {
    if (!identity) return
    try {
      localStorage.setItem(IDENTITY_KEY, identity)
    } catch (error) {
      // 禁用存储时仍可显示计数。
    }
  }

  function showUnavailable(counters, message) {
    counters.forEach(({ element }) => {
      element.textContent = '—'
      element.title = message
      element.setAttribute('aria-label', message)
    })
  }

  async function loadCounts() {
    if (activeRequest) activeRequest.abort()

    const counters = COUNTERS.map(key => ({
      key,
      element: document.getElementById('busuanzi_value_' + key)
    })).filter(counter => counter.element)
    if (!counters.length) return

    const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

    counters.forEach(({ element }) => {
      element.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'
      element.removeAttribute('title')
      element.setAttribute('aria-label', '访问统计加载中')
    })

    const controller = new AbortController()
    activeRequest = controller
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const headers = { 'x-bsz-referer': window.location.href }
      const identity = readIdentity()
      if (identity) headers.Authorization = 'Bearer ' + identity

      const response = await fetch(API_URL, {
        method: 'POST',
        credentials: 'omit',
        headers,
        signal: controller.signal
      })
      if (!response.ok) throw new Error('统计服务请求失败')

      const result = await response.json()
      if (activeRequest !== controller || controller.signal.aborted) return
      if (result.success !== true || !result.data || counters.some(({ key }) => (
        !Number.isSafeInteger(result.data[key]) || result.data[key] < 0
      ))) {
        throw new Error('统计服务返回的数据无效')
      }

      counters.forEach(({ key, element }) => {
        element.textContent = String(result.data[key])
        element.removeAttribute('aria-label')
        if (localPreview) element.title = '本地预览地址的统计，不代表线上博客访问量'
      })
      saveIdentity(response.headers.get('Set-Bsz-Identity'))
    } catch (error) {
      if (activeRequest === controller) {
        showUnavailable(counters, '访问统计暂不可用，请稍后重试')
      }
    } finally {
      clearTimeout(timeout)
      if (activeRequest === controller) activeRequest = null
    }
  }

  // 异步脚本可能在 DOMContentLoaded 前或后完成加载。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCounts, { once: true })
  } else {
    loadCounts()
  }
  // 兼容以后开启 Butterfly 的 Pjax；新页面会取消上一页的请求。
  document.addEventListener('pjax:send', () => {
    if (activeRequest) {
      const request = activeRequest
      activeRequest = null
      request.abort()
    }
  })
  document.addEventListener('pjax:complete', loadCounts)
})()
