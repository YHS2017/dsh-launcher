import { whaleSvg } from './whale.ts'

const whale = document.querySelector<SVGSVGElement>('#whale')
// 深色卡片上不套白色圆盘：渐变鲸鱼直接浮在背景上更轻盈，
// 圆盘留给托盘与任务栏图标——那些场合底色不可控，需要它来保证对比。
if (whale !== null) whale.innerHTML = whaleSvg({ idPrefix: 'splash', disc: false })

// 不能叫 status：DOM 全局已有 window.status，块级同名声明会与之冲突。
const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const detail = document.querySelector<HTMLPreElement>('#detail')
const failure = document.querySelector<HTMLElement>('#failure')
const progress = document.querySelector<HTMLDivElement>('#progress')

window.launcher.onSplashState(payload => {
  if (statusEl !== null) statusEl.textContent = payload.message
  const failed = payload.phase === 'failed'

  // 失败后进度条继续跑会显得还在推进，与「已经停下来了」的事实相悖。
  if (progress !== null) progress.hidden = failed
  if (failure !== null) failure.hidden = !failed
  if (detail !== null) detail.textContent = payload.detail ?? ''
})

document.querySelector('#retry')?.addEventListener('click', () => {
  // 重试即回到进行中的观感，否则点完按钮界面毫无反馈。
  if (progress !== null) progress.hidden = false
  if (failure !== null) failure.hidden = true
  if (statusEl !== null) statusEl.textContent = '正在重试…'
  void window.launcher.retry()
})
document.querySelector('#open-log')?.addEventListener('click', () => { void window.launcher.openLogFile() })
document.querySelector('#close')?.addEventListener('click', () => { void window.launcher.quitApp() })
