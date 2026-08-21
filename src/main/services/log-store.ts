import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type LogSource = 'shell' | 'dsh-out' | 'dsh-err'

const DEFAULT_MAX_LINES = 5000

/**
 * 外壳与 dsh 输出的统一归集。
 * 内存保留最近若干行供面板即时展示，同时落盘一份供用户直接打开或反馈问题时附带。
 */
export class LogStore {
  readonly #filePath: string
  readonly #maxLines: number
  #lines: string[] = []

  constructor(dir: string, maxLines: number = DEFAULT_MAX_LINES) {
    mkdirSync(dir, { recursive: true })
    this.#filePath = join(dir, 'launcher.log')
    this.#maxLines = maxLines
    try {
      const existing = readFileSync(this.#filePath, 'utf8').split('\n').filter(line => line !== '')
      this.#lines = existing.slice(-maxLines)
    } catch {
      this.#lines = []
    }
  }

  get filePath(): string {
    return this.#filePath
  }

  /** 追加一段输出；其中的换行会被拆成独立记录，空行忽略。 */
  append(source: LogSource, text: string): void {
    const stamp = new Date().toISOString()
    const incoming = text
      .split('\n')
      .map(line => line.trimEnd())
      .filter(line => line.trim() !== '')
      .map(line => `${stamp} [${source}] ${line}`)
    if (incoming.length === 0) return

    this.#lines.push(...incoming)
    const overflow = this.#lines.length - this.#maxLines
    if (overflow > 0) {
      this.#lines = this.#lines.slice(overflow)
      // 超限后整体重写，避免磁盘文件无限增长。
      writeFileSync(this.#filePath, `${this.#lines.join('\n')}\n`, 'utf8')
      return
    }
    appendFileSync(this.#filePath, `${incoming.join('\n')}\n`, 'utf8')
  }

  tail(count: number): string[] {
    return this.#lines.slice(-count)
  }
}
