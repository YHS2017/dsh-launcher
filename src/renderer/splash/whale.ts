/**
 * 鲸鱼标记的类型化入口。
 *
 * 图形数据本身放在 whale-shapes.mjs——那是一份纯 JS 模块，
 * 图标生成脚本（Node）与渲染层（TypeScript）共用同一份定义，
 * 因此两处外观不可能漂移。
 */
export { whaleSvg, type WhaleOptions } from './whale-shapes.mjs'
