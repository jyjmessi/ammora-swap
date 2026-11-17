import { ALMMClient, AmmoraDataApiClient, AmmoraSwapClient, DammV2Client, ammoraRouteDeployments } from '@ammora-protocol/sdk'
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem'
import { DATA_API_URL, RPC_URL, WETH, giwaSepolia } from './chain'
import type { LiveState, Model, Token } from './types'

/** The reviewed GIWA Sepolia route deployment bundled with the SDK. */
export const deployment = ammoraRouteDeployments['91342']

export const publicClient = createPublicClient({
  chain: giwaSepolia,
  transport: http(RPC_URL, { timeout: 20000, retryCount: 3, retryDelay: 600, batch: false }),
})

export const dataApi = new AmmoraDataApiClient(DATA_API_URL)

function factoryOf(kind: Model) {
  const factory = deployment.factories.find((f) => f.kind === kind)
  if (!factory) throw new Error(`The reviewed deployment has no ${kind} factory.`)
  return factory
}

function bindingOf(kind: Model, name: string): Address {
  const binding = factoryOf(kind).bindings.find((b) => b.name === name)
  if (!binding) throw new Error(`The ${kind} factory has no "${name}" binding.`)
  return binding.address
}

export const ALMM_POSITION_MANAGER = bindingOf('almm', 'positionManager')
export const ALMM_BIN_LENS = bindingOf('almm', 'binLens')
export const FACTORY_ADDRESS: Record<Model, Address> = {
  almm: factoryOf('almm').address,
  concentrated: factoryOf('concentrated').address,
  compounding: factoryOf('compounding').address,
}

export const NATIVE_ROUTER = deployment.nativeRouter
export const AGGREGATION_ROUTER = deployment.aggregationRouter

let swapClientPromise: Promise<AmmoraSwapClient> | null = null

/** One shared, reviewed-deployment swap client for the whole app session. */
export function getSwapClient(): Promise<AmmoraSwapClient> {
  if (!swapClientPromise) {
    swapClientPromise = AmmoraSwapClient.create(publicClient).catch((error) => {
      swapClientPromise = null
      throw error
    })
  }
  return swapClientPromise
}

export function isWeth(address: string): boolean {
  return address.toLowerCase() === WETH.toLowerCase()
}

/**
 * Live pool state through the SDK's connected clients: the ALMM bin-pool client
 * for `almm`, and the DAMM V2 client for `concentrated` / `compounding` pools.
 */
export async function readLiveState(model: Model, pool: Address): Promise<LiveState> {
  if (model === 'almm') {
    const client = new ALMMClient(publicClient, pool, ALMM_POSITION_MANAGER, ALMM_BIN_LENS)
    const state = await client.getPoolState()
    return {
      base: state.baseToken,
      quote: state.quoteToken,
      feeBps: state.currentFeeBps,
      status: state.status,
      reserveBase: null,
      reserveQuote: null,
      activeId: state.activeId,
      binStepBps: state.binStepBps,
    }
  }

  const client = new DammV2Client(publicClient, pool, model, FACTORY_ADDRESS[model])
  const state = await client.getPoolState()
  return {
    base: state.baseToken,
    quote: state.quoteToken,
    feeBps: state.currentFeeBps,
    status: null,
    reserveBase: state.reserveBase,
    reserveQuote: state.reserveQuote,
    activeId: null,
    binStepBps: null,
  }
}

const tokenMetaCache = new Map<string, Token>()

/** Reads ERC-20 metadata on chain and caches it for the session. */
export async function readTokenMeta(address: Address): Promise<Token> {
  const key = address.toLowerCase()
  const cached = tokenMetaCache.get(key)
  if (cached) return cached

  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
    publicClient.readContract({ address, abi: erc20Abi, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ address, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ])

  const token: Token = {
    address,
    symbol: (symbol as string | null) ?? `${address.slice(0, 6)}…`,
    name: (name as string | null) ?? 'Unknown token',
    decimals: Number(decimals ?? 18),
    native: isWeth(address) || undefined,
  }
  tokenMetaCache.set(key, token)
  return token
}

export function nativeToken(): Token {
  return { address: WETH, symbol: 'ETH', name: 'Ether (wrapped native)', decimals: 18, native: true }
}

/** Native balance, or the ERC-20 balance of `token` (wrapped native counts as ETH). */
export async function readBalance(token: Token, owner: Address): Promise<bigint> {
  if (token.native) return publicClient.getBalance({ address: owner })
  return publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

export function formatUnitsSafe(value: bigint, decimals: number): string {
  return formatUnits(value, decimals)
}

/** Latest block, used as a lightweight liveness indicator in the header. */
export async function readBlockNumber(): Promise<bigint> {
  return publicClient.getBlockNumber()
}
