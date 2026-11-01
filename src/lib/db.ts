import Dexie, { type Table } from 'dexie'
import type { RpcName } from './database.types'

/** A change waiting to reach the server, replayed in order. */
export interface OutboxOp {
  seq?: number
  /** Row the change is about, so remote updates don't overwrite it while it waits. */
  rowId: string
  kind: 'insert' | 'update' | 'rpc'
  table?: 'events' | 'timer_segments' | 'children' | 'profiles' | 'families'
  row?: Record<string, unknown>
  patch?: Record<string, unknown>
  ifUpdatedAt?: string
  fn?: RpcName
  args?: Record<string, unknown>
  createdAt: number
}

export interface CacheRow {
  key: string
  value: unknown
}

class LeelaDB extends Dexie {
  outbox!: Table<OutboxOp, number>
  cache!: Table<CacheRow, string>

  constructor() {
    super('leela')
    this.version(1).stores({ outbox: '++seq, rowId', cache: 'key' })
  }
}

export const db = new LeelaDB()
