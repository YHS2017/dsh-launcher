
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
  })
  await win.loadFile("E:\\NodeProjects\\deepseek_harness_desktop\\resources\\.icon-tmp\\icon.html")
  await new Promise(r => setTimeout(r, 900))
  const img = await win.webContents.capturePage()
  writeFileSync("E:\\NodeProjects\\deepseek_harness_desktop\\resources\\icon.png", img.toPNG())
  console.log('written')
  app.quit()
})
