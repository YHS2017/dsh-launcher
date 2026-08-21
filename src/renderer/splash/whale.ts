/**
 * 应用标记：一只跃动的鲸鱼。
 *
 * 造型沿用鲸鱼意象以贴合 DeepSeek Harness 生态，但配色刻意改为青—靛—品红
 * 三段渐变，与官方单色蓝明确区分——上游品牌规范要求不得以容易引起误解的
 * 方式使用官方品牌素材。
 *
 * 这份 SVG 同时供启动页与图标生成脚本使用，两处外观因此始终一致。
 */

/** 渐变与形状定义。`idPrefix` 避免同页多次内联时 id 冲突。 */
export function whaleSvg(options: { idPrefix?: string; disc?: boolean } = {}): string {
  const p = options.idPrefix ?? 'whale'
  const disc = options.disc ?? true
  return `
<defs>
  <linearGradient id="${p}-grad" x1="5%" y1="0%" x2="95%" y2="100%">
    <stop offset="0%" stop-color="#22D3EE"/>
    <stop offset="45%" stop-color="#6366F1"/>
    <stop offset="100%" stop-color="#D946EF"/>
  </linearGradient>
</defs>
${disc ? '<circle cx="100" cy="100" r="98" fill="#ffffff"/>' : ''}
<g class="whale-body">
  <path class="whale-tail" fill="url(#${p}-grad)" d="
    M 128 92
    C 140 73, 152 55, 170 44
    C 170 66, 163 86, 151 101
    C 165 99, 179 102, 191 109
    C 177 121, 159 125, 142 120
    C 134 118, 129 112, 127 105
    Z"/>
  <path fill="url(#${p}-grad)" d="
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
}
