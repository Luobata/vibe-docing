import { describe, expect, it, vi } from 'vitest'
import { VISUAL_SCENE_LIMITS, VISUAL_SCHEMA_VERSION, validateVisualScene, type VisualEdge, type VisualGroup, type VisualNode, type VisualStreamEvent } from '@vibe/shared'
import { openMemoryDb } from '../db/connection'
import { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { fixedClock } from '../util/clock'
import { CREATE_VISUAL_TOOL_SCHEMA, createVisualArtifactFromTool } from './create-visual'
import { createDeps } from '../deps'
import type { Provider } from '../provider/types'

const valid = {
  kind: 'architecture',
  title: 'Runtime',
  altText: 'Client, runtime, and store',
  renderer: 'canvas',
  nodes: [{ id: 'client', label: 'Client' }, { id: 'runtime', label: 'Runtime' }, { id: 'store', label: 'Store' }],
  edges: [{ id: 'e1', source: 'client', target: 'runtime' }, { id: 'e2', source: 'runtime', target: 'store' }],
  groups: [],
}
const repo = () => createVisualArtifactRepo(openMemoryDb(), fixedClock('2026-08-10T00:00:00.000Z'))

describe('create_visual', () => {
  it('declares every typed scene field and agrees with the validator on required fields', () => {
    const properties = CREATE_VISUAL_TOOL_SCHEMA.function.parameters.properties
    const node: Required<VisualNode> = {
      id: 'client', label: 'Client', description: '', kind: 'service', groupId: 'frontend',
      data: { name: 'client', count: 1, active: true, optional: null },
    }
    const edge: Required<VisualEdge> = { id: 'e1', source: 'client', target: 'runtime', label: '', kind: 'request', directed: true }
    const group: Required<VisualGroup> = { id: 'frontend', label: 'Frontend', nodeIds: ['client'], parentGroupId: 'system' }
    const examples = { nodes: node, edges: edge, groups: group }
    const scene = {
      ...valid, schemaVersion: VISUAL_SCHEMA_VERSION,
      nodes: [node, valid.nodes[1]], edges: [edge],
      groups: [group, { id: 'system', label: 'System', nodeIds: ['runtime'] }],
    }
    for (const name of ['nodes', 'edges', 'groups'] as const) {
      const item = properties[name].items
      const example = examples[name]
      expect(Object.keys(item.properties).sort()).toEqual(Object.keys(example).sort())
      // Build the first item using the tool's declared fields, then validate it with shared.
      const declared = Object.fromEntries(Object.keys(item.properties).map((key) => [key, example[key as keyof typeof example]]))
      for (const [key, field] of Object.entries(item.properties)) {
        expect(field.type, `${name}.${key}`).toBe(Array.isArray(declared[key]) ? 'array' : typeof declared[key])
      }
      expect(validateVisualScene({ ...scene, [name]: [declared, ...scene[name].slice(1)] }).success).toBe(true)
      for (const key of Object.keys(item.properties)) {
        const withoutField = { ...declared }
        delete withoutField[key]
        expect(validateVisualScene({ ...scene, [name]: [withoutField, ...scene[name].slice(1)] }).success, `${name}.${key}`)
          .toBe(!item.required.includes(key))
      }
    }
    expect(properties.nodes.maxItems).toBe(VISUAL_SCENE_LIMITS.nodes)
    expect(properties.edges.maxItems).toBe(VISUAL_SCENE_LIMITS.edges)
    expect(properties.nodes.items.properties.data.additionalProperties.type).toEqual(['string', 'number', 'boolean', 'null'])
    expect(properties.edges.items.properties.directed.type).toBe('boolean')
    expect(properties.groups.items.properties.nodeIds).toMatchObject({ type: 'array', items: { type: 'string' } })
    for (const title of ['Title', '', '   ', '\n', ' 标题 ']) {
      expect(validateVisualScene({ ...scene, title }).success).toBe(new RegExp(properties.title.pattern).test(title))
    }
  })

  it.each([
    { patch: { nodes: [{ id: 'client' }] }, keywords: ['nodes', 'array', 'id', 'label', 'description', 'groupId', 'data'] },
    { patch: { edges: [{ from: 'client', to: 'runtime' }] }, keywords: ['edges', 'array', 'id', 'source', 'target', 'label', 'directed', 'nodes[].id'] },
    { patch: { groups: [{ id: 'g', label: 'Group', members: ['client'] }] }, keywords: ['groups', 'array', 'id', 'label', 'nodeIds', 'parentGroupId', 'nodes[].id'] },
    { patch: { edges: [{ id: 'e', source: 'absent', target: 'runtime' }] }, keywords: ['source', 'target', 'nodes[].id'] },
    { patch: { groups: [{ id: 'g', label: 'Group', nodeIds: ['absent'] }] }, keywords: ['nodeIds', 'parentGroupId', 'nodes[].id', 'groups[].id'] },
  ])('returns actionable field shapes without persisting invalid input: $keywords', ({ patch, keywords }) => {
    const artifacts = repo()
    let message = ''
    try {
      createVisualArtifactFromTool({ argsJson: JSON.stringify({ ...valid, ...patch }), artifactId: 'invalid', revision: 1, artifacts })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('create_visual validation failed:')
    for (const keyword of keywords) expect(message).toContain(keyword)
    expect(artifacts.get('invalid', 1)).toBeUndefined()
  })

  it('returns validation feedback to the provider and accepts a corrected second visual call', async () => {
    const db = openMemoryDb()
    const deps = createDeps({ db })
    deps.settings.set('tags.autoGenerate', 'false')
    const { rootNode } = deps.trees.create('Visual retry')
    const events: VisualStreamEvent[] = []
    let round = 0
    const provider: Provider = {
      complete: vi.fn(async () => ''),
      async *stream() { throw new Error('unexpected fallback') },
      async *streamWithTools(messages, tools) {
        expect(tools).toContainEqual(CREATE_VISUAL_TOOL_SCHEMA)
        round += 1
        if (round === 1) {
          yield { type: 'tool_call', id: 'bad-visual', name: 'create_visual', arguments: JSON.stringify({ ...valid, edges: [{ from: 'client', to: 'runtime' }] }) }
        } else if (round === 2) {
          const feedback = messages.find((message) => message.role === 'tool' && message.tool_call_id === 'bad-visual')!
          for (const keyword of ['source', 'target', 'nodes[].id']) expect(feedback.content).toContain(keyword)
          yield { type: 'tool_call', id: 'fixed-visual', name: 'create_visual', arguments: JSON.stringify(valid) }
        } else {
          yield { type: 'text', text: '图示说明' }
        }
      },
    }
    try {
      const result = await deps.answer.generate({ nodeId: rootNode.id, provider, userInput: '画架构图' }, () => {}, (event) => events.push(event))
      expect(result.status).toBe('complete')
      expect(events.map((event) => event.type)).toEqual(['visual_placeholder', 'visual_error', 'visual_placeholder', 'visual_ready'])
      const ready = events[3]
      if (ready.type !== 'visual_ready') throw new Error('expected a ready visual')
      expect(deps.visualArtifacts.get(ready.artifactId, ready.revision)).toEqual(ready.artifact)
      expect(round).toBe(3)
    } finally {
      db.close()
    }
  })

  it('validates and persists renderer-neutral model input', () => {
    const artifacts = repo()
    const result = createVisualArtifactFromTool({
      argsJson: JSON.stringify(valid), artifactId: 'v1', revision: 1, artifacts,
    })
    expect(artifacts.get('v1', 1)).toEqual(result)
  })

  it.each([
    { ...valid, title: '<script>x</script>' },
    { ...valid, nodes: [{ id: 'x', label: 'x', onClick: 'run()' }] },
    { ...valid, nodes: [{ id: 'x', label: 'docs', data: { url: 'https://example.com' } }] },
  ])('rejects executable markup, handlers, and external URLs', (value) => {
    expect(() => createVisualArtifactFromTool({
      argsJson: JSON.stringify(value), artifactId: 'unsafe', revision: 1, artifacts: repo(),
    })).toThrow(/validation failed/)
  })
})
