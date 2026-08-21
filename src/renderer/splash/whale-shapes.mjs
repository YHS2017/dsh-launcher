/**
 * 鲸鱼标记的图形定义。
 *
 * 刻意写成纯 JS：渲染层（TypeScript）与图标生成脚本（Node）都直接 import 它。
 * 早先的做法是让脚本用正则从 .ts 源码里抠模板字符串，一改文件结构就静默
 * 产出错误图标——白圆盘也是合法 PNG，任何校验都发现不了。共用一份模块
 * 才能保证两边不可能漂移。
 *
 * 配色为青—靛—品红三段渐变，与 DeepSeek 官方单色蓝明确区分：
 * 上游品牌规范要求不得以容易引起误解的方式使用官方品牌素材。
 */

/** 白色圆盘底。托盘与任务栏底色不可控，需要它保证对比。 */
export const DISC = '<circle cx="100" cy="100" r="98" fill="#ffffff"/>'

export const gradient = id => `
<defs>
  <linearGradient id="${id}" x1="5%" y1="0%" x2="95%" y2="100%">
    <stop offset="0%" stop-color="#22D3EE"/>
    <stop offset="45%" stop-color="#6366F1"/>
    <stop offset="100%" stop-color="#D946EF"/>
  </linearGradient>
</defs>`

/** 完整字形：身体、分叉尾鳍、腹部月牙、眼睛。32px 以上使用。 */
export const detailed = fill => `
<g class="whale-body">
  <path class="whale-tail" fill="${fill}" d="
    M 128 92
    C 140 73, 152 55, 170 44
    C 170 66, 163 86, 151 101
    C 165 99, 179 102, 191 109
    C 177 121, 159 125, 142 120
    C 134 118, 129 112, 127 105
    Z"/>
  <path fill="${fill}" d="
    M 96 44
    C 63 45, 34 69, 29 102
    C 24 134, 46 160, 79 163
    C 107 166, 133 151, 144 126
    C 149 115, 148 104, 141 96
    C 133 87, 127 76, 122 65
    C 116 53, 107 45, 96 44
    Z"/>
  <path fill="#ffffff" d="
    M 46 108
    C 46 130, 63 148, 87 149
    C 99 149, 109 145, 116 139
    C 100 140, 82 135, 67 125
    C 57 118, 49 113, 46 108
    Z"/>
  <circle cx="74" cy="83" r="5.5" fill="#ffffff"/>
</g>`

/**
 * 简化字形：身体撑得更满、尾鳍并成一片、眼睛按比例放大、腹部只留一道粗弧。
 * 24px 及以下使用——完整字形在 16px 下细节全糊：尾鳍分叉只剩几个像素，
 * 眼睛与腹部弧线互相黏连。小尺寸要的是可辨识的剪影，不是细节。
 */
export const simple = fill => `
<g class="whale-body">
  <path class="whale-tail" fill="${fill}" d="
    M 132 96
    C 146 74, 162 56, 184 46
    C 182 78, 172 106, 156 124
    C 146 118, 137 108, 132 96
    Z"/>
  <ellipse cx="88" cy="104" rx="66" ry="60" fill="${fill}"/>
  <path fill="#ffffff" d="
    M 44 116
    C 52 142, 76 156, 104 150
    C 116 147, 126 141, 133 132
    C 112 138, 84 134, 62 122
    C 54 121, 48 119, 44 116
    Z"/>
  <circle cx="70" cy="82" r="10" fill="#ffffff"/>
</g>`

/** 低于等于该尺寸改用简化字形。 */
export const SIMPLIFY_AT_OR_BELOW = 24

/**
 * 组装完整的 SVG 内容（不含外层 svg 标签）。
 * @param {{ idPrefix?: string, disc?: boolean, simplified?: boolean }} options
 * @returns {string}
 */
export function whaleSvg(options = {}) {
  const id = `${options.idPrefix ?? 'whale'}-grad`
  const fill = `url(#${id})`
  const body = options.simplified === true ? simple(fill) : detailed(fill)
  return `${gradient(id)}
${options.disc === false ? '' : DISC}
${body}`
}
