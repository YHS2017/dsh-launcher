void window.launcher.aboutInfo().then(info => {
  const list = document.querySelector<HTMLDListElement>('#info')
  if (list === null) return
  const rows: [string, string][] = [
    ['启动器版本', info.launcherVersion],
    ['dsh 版本', `${info.dshVersion}（${info.dshSource === 'bundled' ? '内置副本' : '已更新副本'}）`],
    ['Electron', info.electronVersion],
    ['Node', info.nodeVersion],
    ['日志文件', info.logFile],
  ]
  for (const [term, value] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = term
    const dd = document.createElement('dd')
    dd.textContent = value
    list.append(dt, dd)
  }
})
