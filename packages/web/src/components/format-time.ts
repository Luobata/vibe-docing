/** 相对时间：刚刚/N 分钟/N 小时/N 天/日期；非法输入返回空串。SessionMap 与文档 meta 行共用。 */
export function formatRelativeTime(iso: string): string {
  const time = Date.parse(iso)
  if (!iso || Number.isNaN(time)) return ''
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return iso.slice(0, 10)
}
