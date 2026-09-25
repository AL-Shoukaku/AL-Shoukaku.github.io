/**
 * 修复中文写作下的 Markdown 加粗/斜体边界问题
 *
 * 背景：CommonMark 规定，作为"收尾"的 * 号如果紧跟在标点之后，
 *       那么它后面还必须也是空白或标点，才算合法闭合。
 *       中文句子字与字之间不空格，于是这种写法会失效：
 *
 *         **超级页(superpage)**功能      ← 收尾 ** 前是 ) 、后是"功"
 *
 *       结果是整对 ** 原样输出，不会加粗。
 *
 * 做法：渲染前，在"无法闭合"的 * 定界符【前面】插入一个零宽空格
 *       （U+200B，不可见）。这样定界符就不再是"紧跟在标点之后"，
 *       CommonMark 便会正常闭合。
 *
 * 安全性：
 *   - 仅对"前是标点、后既非空白也非标点"的 * 连续串生效，条件很窄
 *   - 围栏代码块（``` / ~~~）和行内代码（`...`）会被跳过，
 *     所以代码里的 char **argv 之类完全不受影响
 *   - 被转义的 \* 不处理
 */

'use strict'

const ZWSP = '​'

// 标点：ASCII 标点 + 常见中英文全角标点
const PUNCT = new Set(
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' +
  '（）【】「」『』《》〈〉〔〕，。、；：？！…—～·“”‘’'
)

const isPunct = c => c !== undefined && PUNCT.has(c)
const isBlank = c => c === undefined || /\s/.test(c)

// 在需要的位置插入零宽空格
function fixSegment(text) {
  return text.replace(/\*+/g, (match, offset, str) => {
    const prev = str[offset - 1]
    const next = str[offset + match.length]

    if (prev === '\\') return match // 被转义的字面 * ，不动
    if (!isPunct(prev)) return match // 前面不是标点 → 本来就能正常闭合
    if (next === undefined) return match // 后面没内容 → 正常闭合
    if (isBlank(next) || isPunct(next)) return match // 后面是空白/标点 → 正常闭合

    return ZWSP + match
  })
}

// 代码区（围栏代码块 / 行内代码）不处理
const CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g

hexo.extend.filter.register('before_post_render', data => {
  if (!data.content) return data

  data.content = data.content
    .split(CODE_RE)
    .map((segment, i) => (i % 2 === 1 ? segment : fixSegment(segment)))
    .join('')

  return data
})
