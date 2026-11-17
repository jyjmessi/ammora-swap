#!/usr/bin/env node
/**
 * Rebuilds src/data/pools.json — the pool and token index the UI ships with.
 *
 * 1. Reads every reviewed factory from the SDK's GIWA Sepolia route catalog.
 * 2. Collects `PoolCreated` events per factory (GIWA Blockscout API, paginated).
 * 3. Asks each pool for live state through ALMMClient / DammV2Client.
 * 4. Reads ERC-20 symbol, name and decimals for every token involved.
 *
 * Usage: node scripts/sync-pools.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, decodeEventLog, defineChain, erc20Abi, http } from 'viem'
import {
  ALMMClient,
  DammV2Client,
  almmFactoryAbi,
  ammCompoundingFactoryV3Abi,
  ammConcentratedFactoryV3Abi,
  ammoraRouteDeployments,
} from '@ammora-protocol/sdk'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const EXPLORER_API = 'https://sepolia-explorer.giwa.io/api/v2/addresses'
const WETH = '0x4200000000000000000000000000000000000006'

const giwa = defineChain({
  id: 91342,
  name: 'GIWA Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia-rpc.giwa.io'] } },
  blockExplorers: { default: { name: 'GIWA Explorer', url: 'https://sepolia-explorer.giwa.io' } },
  testnet: true,
})

const client = createPublicClient({ chain: giwa, transport: http(undefined, { retryCount: 4, retryDelay: 800 }) })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deployment = ammoraRouteDeployments['91342']
const almmFactory = deployment.factories.find((factory) => factory.kind === 'almm')
const positionManager = almmFactory.bindings.find((binding) => binding.name === 'positionManager').address
const binLens = almmFactory.bindings.find((binding) => binding.name === 'binLens').address
const factoryByKind = Object.fromEntries(deployment.factories.map((factory) => [factory.kind, factory]))

async function fetchLogs(address) {
  const logs = []
  let url = `${EXPLORER_API}/${address}/logs`
  while (url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`explorer ${response.status} for ${address}`)
    const page = await response.json()
    logs.push(...page.items)
    const next = page.next_page_params
    url = next ? `${EXPLORER_API}/${address}/logs?${new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)]))}` : null
  }
  return logs
}

function eventAbiFor(model) {
  if (model === 'almm') return almmFactoryAbi
  if (model === 'compounding') return ammCompoundingFactoryV3Abi
  return ammConcentratedFactoryV3Abi
}

const tokenCache = new Map()

async function tokenMeta(address) {
  if (address.toLowerCase() === WETH.toLowerCase()) {
    const native = { address: WETH, symbol: 'ETH', name: 'Ether (Wrapped)', decimals: 18, native: true }
    tokenCache.set(address, native)
    return native
  }
  if (tokenCache.has(address)) return tokenCache.get(address)
  const read = (functionName) => client.readContract({ address, abi: erc20Abi, functionName }).catch(() => null)
  const symbol = await read('symbol')
  await sleep(120)
  const name = await read('name')
  await sleep(120)
  const decimals = await read('decimals')
  await sleep(120)
  const totalSupply = await read('totalSupply')
  await sleep(120)
  const meta = {
    address,
    symbol: symbol ?? `${address.slice(0, 6)}…`,
    name: name ?? 'Unknown token',
    decimals: Number(decimals ?? 18),
    totalSupply: totalSupply ? totalSupply.toString() : null,
  }
  tokenCache.set(address, meta)
  return meta
}

async function liveState(model, pool) {
  if (model === 'almm') {
    const state = await new ALMMClient(client, pool, positionManager, binLens).getPoolState()
    return { base: state.baseToken, quote: state.quoteToken, feeBps: state.currentFeeBps, activeId: state.activeId, binStepBps: state.binStepBps, status: state.status }
  }
  const state = await new DammV2Client(client, pool, model, factoryByKind[model].address).getPoolState()
  return {
    base: state.baseToken,
    quote: state.quoteToken,
    feeBps: state.currentFeeBps,
    reserveBase: state.reserveBase.toString(),
    reserveQuote: state.reserveQuote.toString(),
    status: null,
  }
}

async function main() {
  const pools = []
  const models = ['almm', 'concentrated', 'compounding']

  for (const model of models) {
    const factory = factoryByKind[model]
    const abi = eventAbiFor(model)
    const logs = await fetchLogs(factory.address)
    let count = 0
    for (const log of logs) {
      let decoded
      try {
        decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: false })
      } catch {
        continue
      }
      if (decoded.eventName !== 'PoolCreated') continue
      const pool = decoded.args.pool
      await sleep(200)
      let state
      try {
        state = await liveState(model, pool)
      } catch (error) {
        console.warn(`skip ${model} ${pool}: ${error.shortMessage ?? error.message}`)
        continue
      }
      if (!state.base || !state.quote || state.base === state.quote) continue
      const base = await tokenMeta(state.base)
      const quote = await tokenMeta(state.quote)
      pools.push({
        model,
        factory: factory.address,
        pool,
        base: state.base,
        quote: state.quote,
        feeBps: state.feeBps ?? null,
        block: Number(log.block_number),
        tx: log.transaction_hash,
        activeId: state.activeId ?? null,
        binStepBps: state.binStepBps ?? null,
        status: state.status ?? null,
        reserveBase: state.reserveBase ?? null,
        reserveQuote: state.reserveQuote ?? null,
        baseSymbol: base.symbol,
        quoteSymbol: quote.symbol,
      })
      count += 1
    }
    console.log(`${model}: ${count} pool(s) from ${logs.length} factory logs`)
  }

  const tokens = [...tokenCache.values()]
  const output = {
    generatedAt: new Date().toISOString(),
    chainId: 91342,
    tokens,
    pools,
  }
  await fs.mkdir(path.join(ROOT, 'src/data'), { recursive: true })
  await fs.writeFile(path.join(ROOT, 'src/data/pools.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(`wrote src/data/pools.json — ${pools.length} pools, ${tokens.length} tokens`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
