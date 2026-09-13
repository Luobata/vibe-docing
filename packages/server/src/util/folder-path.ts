/** 笔记库归组与显式文件夹共用的路径清洗规则。 */
export function sanitizeTreeFolder(input: string): string {
  return input
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim())
    .filter((segment) => segment.length > 0)
    .slice(0, 6)
    .join('/')
}
