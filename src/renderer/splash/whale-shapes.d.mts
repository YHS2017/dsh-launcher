export interface WhaleOptions {
  /** 同页多次内联时用于隔离渐变 id。 */
  idPrefix?: string
  /** 是否套白色圆盘。托盘与任务栏底色不可控，需要它保证对比。 */
  disc?: boolean
  /** 简化字形，供 24px 及以下使用。 */
  simplified?: boolean
}

export declare const DISC: string
export declare const SIMPLIFY_AT_OR_BELOW: number
export declare function gradient(id: string): string
export declare function detailed(fill: string): string
export declare function simple(fill: string): string
export declare function whaleSvg(options?: WhaleOptions): string
