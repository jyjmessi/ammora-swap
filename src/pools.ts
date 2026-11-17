import { discoverAmmoraPools, type AmmoraDiscoveredPool } from '@ammora-protocol/sdk'
import type { Address } from 'viem'
import { dataApi, deployment, publicClient, readLiveState, readTokenMeta } from './ammora'
import { bundledPools, registerToken } from './tokens'
import type { Model, PoolDef, PoolLive } from './types'

/** Runs `task` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function toPoolId(model: Model, address: string): string {
  return `${model}:${address.toLowerCase()}`
}

export function poolKey(pool: { model: Model; address: string }): string {
  return toPoolId(pool.model, pool.address)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The RPC did not answer in time')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Reads live state for every pool, dropping nothing so failures stay visible in the UI. */
export async function loadPoolStates(pools: PoolDef[], concurrency = 4): Promise<PoolLive[]> {
  return mapLimit(pools, concurrency, async (pool) => {
    try {
      const live = await withTimeout(readLiveState(pool.model, pool.address), 15000)
      return { ...pool, live }
    } catch (error) {
      return { ...pool, live: null, error: error instanceof Error ? error.message : 'Pool state unavailable' }
    }
  })
}

export function initialPools(): PoolDef[] {
  return bundledPools()
}

function fromDiscovered(found: AmmoraDiscoveredPool): PoolDef {
  const model = found.model as Model
  return {
    id: toPoolId(model, found.pool),
    model,
    address: found.pool,
    base: found.baseToken,
    quote: found.quoteToken,
    feeBps: null,
    createdBlock: Number(found.creationBlock),
    source: 'scan',
  }
}

/**
 * Live factory-log scan through `discoverAmmoraPools` for pools created in a recent
 * block window. The GIWA public RPC caps `eth_getLogs` at 10 000 blocks per query, so
 * the window is deliberately small; the full history is the bundled index.
 */
export async function scanRecentPools(blocks = 40_000): Promise<PoolDef[]> {
  const head = await publicClient.getBlockNumber()
  const from = head > BigInt(blocks) ? head - BigInt(blocks) : 0n
  const found = await discoverAmmoraPools({
    clients: [publicClient],
    deployment,
    fromBlock: from,
    toBlock: head,
    initialWindow: 10_000n,
    minimumWindow: 10_000n,
    maximumWindow: 10_000n,
    retriesPerClient: 2,
  })
  return found.filter((pool) => pool.model !== 'dbc').map(fromDiscovered)
}

/**
 * The Ammora Data API is the protocol's own index. It is tried first when the user
 * refreshes markets; the app keeps working from the bundled index and on-chain reads
 * when the API is unreachable.
 */
export async function fetchDataApiPools(timeoutMs = 7000): Promise<{ pools: PoolDef[]; error?: string }> {
  try {
    const discovery = await dataApi.getMarketDiscovery({
      chainId: 91342n,
      limit: 60,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const pools: PoolDef[] = []
    for (const entry of discovery.items) {
      if (entry.model === 'ALMM') {
        const item = entry.item.pool
        pools.push({
          id: toPoolId('almm', item.address),
          model: 'almm',
          address: item.address,
          base: item.baseToken,
          quote: item.quoteToken,
          feeBps: null,
          createdBlock: Number(item.createdBlock),
          source: 'data-api',
        })
        continue
      }
      const poolType = entry.item.metrics.poolType
      const model: Model = poolType === 'ARL_COMPOUNDING' || poolType === 'ARLORA_COMPOUNDING_V3' ? 'compounding' : 'concentrated'
      const item = entry.item.pool
      pools.push({
        id: toPoolId(model, item.address),
        model,
        address: item.address,
        base: item.baseToken,
        quote: item.quoteToken,
        feeBps: entry.item.pool.currentFeeBps ?? null,
        createdBlock: Number(item.createdBlock),
        source: 'data-api',
      })
    }
    return { pools }
  } catch (error) {
    return { pools: [], error: error instanceof Error ? error.message : 'Data API unavailable' }
  }
}

/**
 * Resolves a pasted pool address by asking each reviewed model client for its state.
 * Factory provenance is re-checked by the SDK before any allowance is signed.
 */
export async function importPool(address: Address): Promise<PoolDef> {
  const models: Model[] = ['concentrated', 'compounding', 'almm']
  const failures: string[] = []
  for (const model of models) {
    try {
      const live = await readLiveState(model, address)
      if (!live.base || !live.quote || live.base === live.quote) {
        failures.push(`${model}: unexpected tokens`)
        continue
      }
      await Promise.all([readTokenMeta(live.base), readTokenMeta(live.quote)]).then(([base, quote]) => {
        registerToken(base)
        registerToken(quote)
      })
      return {
        id: toPoolId(model, address),
        model,
        address,
        base: live.base,
        quote: live.quote,
        feeBps: live.feeBps,
        createdBlock: null,
        source: 'manual',
      }
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message.split('\n')[0] : 'read failed'}`)
    }
  }
  throw new Error(`No reviewed Ammora pool answered at ${address}. (${failures.join(' · ')})`)
}
