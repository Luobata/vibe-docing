import type { DocumentShareView } from '@vibe/shared'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Icon } from './Icon'

type Phase = 'loading' | 'unshared' | 'creating' | 'shared' | 'copy-error' | 'create-error' | 'closing' | 'close-error' | 'closed'

export function SharePanel({ disabled, nodeId, portal }: { disabled: boolean; nodeId: string | null; portal: HTMLElement | null }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('loading')
  const [share, setShare] = useState<DocumentShareView | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const nodeIdRef = useRef(nodeId)
  nodeIdRef.current = nodeId
  const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

  const closeConfirm = () => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  const closePanel = () => { setOpen(false); triggerRef.current?.focus() }
  const place = () => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    if (!trigger || !panel) return
    const left = trigger.right - panel.width >= 8 ? Math.min(trigger.left, window.innerWidth - panel.width - 8) : Math.max(8, trigger.right - panel.width)
    const top = trigger.bottom + panel.height + 8 <= window.innerHeight ? trigger.bottom + 8 : Math.max(8, trigger.top - panel.height - 8)
    setPosition({ left: Math.max(8, left), top })
  }

  useEffect(() => {
    if (!open || !nodeId) return
    let active = true
    setPhase('loading')
    setShare(null)
    api.getShare(nodeId).then(({ share: next }) => {
      if (!active || nodeIdRef.current !== nodeId) return
      setShare(next); setPhase(next ? 'shared' : 'unshared')
    }).catch(() => { if (active && nodeIdRef.current === nodeId) setPhase('create-error') })
    return () => { active = false }
  }, [api, nodeId, open])

  useLayoutEffect(() => { if (open) place() }, [open, phase])
  useEffect(() => {
    if (!open) return
    const reposition = () => place()
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) closePanel()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !dialogRef.current?.open) closePanel() }
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true)
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  async function create(): Promise<void> {
    if (!nodeId) return
    const targetNodeId = nodeId
    setPhase('creating')
    try {
      const result = await api.createShare(targetNodeId)
      if (nodeIdRef.current !== targetNodeId) return
      setShare(result.share); setPhase('shared')
    } catch { if (nodeIdRef.current === targetNodeId) setPhase('create-error') }
  }
  async function copy(): Promise<void> {
    if (!share) return
    const url = `${window.location.origin}${share.url}`
    try {
      await navigator.clipboard.writeText(url)
      setPhase('shared')
      useWorkbench.getState().setToast({ message: localOnly ? '本机访问链接已复制' : '分享链接已复制', variant: 'success', live: 'polite' })
    } catch {
      setPhase('copy-error'); inputRef.current?.focus(); inputRef.current?.select()
    }
  }
  async function revoke(): Promise<void> {
    if (!nodeId) return
    const targetNodeId = nodeId
    closeConfirm(); setPhase('closing')
    try {
      await api.revokeShare(targetNodeId)
      if (nodeIdRef.current !== targetNodeId) return
      setShare(null); setPhase('closed')
      useWorkbench.getState().setToast({ message: '分享已关闭，旧链接已失效', variant: 'success', live: 'polite' })
    } catch { if (nodeIdRef.current === targetNodeId) setPhase('close-error') }
  }
  function confirmClose(): void {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    setTimeout(() => cancelRef.current?.focus(), 0)
  }

  return <>
    <button aria-expanded={open} className="quiet-button" disabled={disabled} onClick={() => setOpen((value) => !value)} ref={triggerRef} title={disabled ? '请先打开主文档后再分享' : '分享当前文档'} type="button"><Icon name="share" />分享</button>
    {open && portal && createPortal(<div aria-label="分享当前笔记" className="share-panel" ref={panelRef} role="region" style={position}>
      <div className="share-panel-heading"><strong>分享当前笔记</strong><button aria-label="关闭分享面板" onClick={closePanel} type="button"><Icon name="close" /></button></div>
      {localOnly && <p className="share-local-notice"><strong>仅限本机访问</strong><span>只有这台电脑在应用运行时能打开链接，并未发布到互联网。</span></p>}
      {share && ['shared','copy-error','closing','close-error'].includes(phase) && <details className="share-machine-links"><summary>给 AI 或其他工具读取（高级）</summary><p className="share-ai-links"><a href={share.markdownUrl}>Markdown</a> · <a href={share.jsonUrl}>JSON</a></p></details>}
      {phase === 'loading' && <p role="status">正在读取分享状态…</p>}
      {(phase === 'unshared' || phase === 'create-error') && <><p>创建当前笔记及其关联内容的只读链接；源笔记更新后，链接内容也会更新。</p>{phase === 'create-error' && <p className="share-error" role="alert">读取或创建失败，请重试。</p>}<button className="primary-button" onClick={create} type="button">{phase === 'create-error' ? '重试' : localOnly ? '创建本机访问链接' : '创建分享链接'}</button></>}
      {phase === 'creating' && <button className="primary-button" disabled type="button">正在创建…</button>}
      {share && ['shared','copy-error','closing','close-error'].includes(phase) && <><label htmlFor="share-url">{localOnly ? '本机访问链接' : '分享链接'}</label><input id="share-url" onFocus={(event) => event.currentTarget.select()} readOnly ref={inputRef} value={`${window.location.origin}${share.url}`} />{phase === 'copy-error' && <p className="share-error" role="alert">无法访问剪贴板，链接已全选，请手动复制。</p>}{phase === 'close-error' && <p className="share-error" role="alert">关闭失败，原链接仍然有效。请重试。</p>}<div className="share-actions"><button disabled={phase === 'closing'} onClick={copy} type="button">复制链接</button><button disabled={phase === 'closing'} onClick={confirmClose} type="button">{phase === 'close-error' ? '重试关闭' : '关闭分享'}</button></div></>}
      {phase === 'closed' && <><p role="status">分享已关闭，旧链接已失效。</p><button onClick={create} type="button">重新创建链接</button></>}
      <dialog className="share-confirm" onCancel={(event) => { event.preventDefault(); closeConfirm(); triggerRef.current?.focus() }} ref={dialogRef}><h3>关闭分享？</h3><p>关闭后旧链接将立即失效。</p><div><button onClick={closeConfirm} ref={cancelRef} type="button">取消</button><button onClick={revoke} type="button">确认关闭</button></div></dialog>
    </div>, portal)}
  </>
}
