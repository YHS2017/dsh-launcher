import { MENU_SECTIONS, type MenuSectionId } from '../../main/ipc/channels.ts'
import { whaleSvg } from '../splash/whale.ts'

const mark = document.getElementById('mark')
// 16px 用简化字形——细节字形缩到这个尺寸只会糊成一团。
if (mark !== null) mark.innerHTML = whaleSvg({ idPrefix: 'titlebar', disc: false, simplified: true })

/**
 * 弹出某一区的原生菜单。
 *
 * 坐标按窗口客户区算：标题栏视图的原点就是窗口原点，所以元素矩形可以直接用。
 * 贴按钮左下角弹出，观感与系统菜单栏一致。
 */
async function openSection(button: HTMLButtonElement, id: MenuSectionId): Promise<void> {
  const rect = button.getBoundingClientRect()
  button.setAttribute('aria-expanded', 'true')
  try {
    await window.launcher.popupMenu(id, Math.round(rect.left), Math.round(rect.bottom))
  } finally {
    // popupMenu 在菜单关闭后才 resolve，所以这里正好复位按下态。
    button.removeAttribute('aria-expanded')
  }
}

const host = document.getElementById('menus')
if (host !== null) {
  for (const section of MENU_SECTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-btn'
    button.textContent = section.label
    button.addEventListener('click', () => { void openSection(button, section.id) })
    host.append(button)
  }
}
