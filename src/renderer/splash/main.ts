const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const detail = document.querySelector<HTMLPreElement>('#detail')
const actions = document.querySelector<HTMLDivElement>('#actions')

window.launcher.onSplashState(payload => {
  if (statusEl !== null) statusEl.textContent = payload.message
  const failed = payload.phase === 'failed'
  if (detail !== null) {
    detail.hidden = !failed || payload.detail === undefined
    detail.textContent = payload.detail ?? ''
  }
  if (actions !== null) actions.hidden = !failed
})

document.querySelector('#retry')?.addEventListener('click', () => { void window.launcher.retry() })
document.querySelector('#open-log')?.addEventListener('click', () => { void window.launcher.openLogFile() })
