const content = document.querySelector<HTMLPreElement>('#content')
const auto = document.querySelector<HTMLInputElement>('#auto')

async function refresh(): Promise<void> {
  const lines = await window.launcher.tailLogs(500)
  if (content === null) return
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 20
  content.textContent = lines.join('\n')
  // 只在用户本来就在底部时才跟随，避免打断向上翻阅。
  if (atBottom) content.scrollTop = content.scrollHeight
}

document.querySelector('#refresh')?.addEventListener('click', () => { void refresh() })
document.querySelector('#open-file')?.addEventListener('click', () => { void window.launcher.openLogFile() })

setInterval(() => {
  if (auto?.checked !== true) return
  void refresh()
}, 2000)

void refresh()
