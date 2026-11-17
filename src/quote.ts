import type { ExactInputQuote, PreparedExactInputSwap } from '@ammora-protocol/sdk'
import type { Address } from 'viem'
import { getSwapClient } from './ammora'
import type { PoolDef, Token } from './types'

export type RouteQuote = {
  pool: PoolDef
  prepared: PreparedExactInputSwap
  quote: ExactInputQuote
  /** True when the pool could only fill part of the requested input. */
  partial: boolean
}

export type RouteAttempt = {
  pool: PoolDef
  route?: RouteQuote
  error?: string
}

export type QuoteResult = {
  best: RouteQuote | null
  attempts: RouteAttempt[]
}

export function poolsForPair(pools: PoolDef[], tokenIn: Token, tokenOut: Token): PoolDef[] {
  const a = tokenIn.address.toLowerCase()
  const b = tokenOut.address.toLowerCase()
  if (a === b) return []
  return pools.filter((pool) => {
    const base = pool.base.toLowerCase()
    const quote = pool.quote.toLowerCase()
    return (base === a && quote === b) || (base === b && quote === a)
  })
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0]
  return String(error)
}

type QuoteParams = {
  pools: PoolDef[]
  tokenIn: Token
  tokenOut: Token
  amountIn: bigint
  payer: Address
  slippageBps: number
}

/**
 * Quotes the exact-input amount on every pool that connects the pair through
 * `AmmoraSwapClient.prepareExactIn`, then keeps the highest expected output.
 * Native value is routed through the reviewed native router where the model
 * supports it; ALMM bin pools settle WETH, so ETH routes skip them.
 */
export async function quoteBestRoute(params: QuoteParams): Promise<QuoteResult> {
  const swap = await getSwapClient()
  const candidates = poolsForPair(params.pools, params.tokenIn, params.tokenOut)
  if (candidates.length === 0) return { best: null, attempts: [] }

  const inputAsset = params.tokenIn.native ? 'native' : 'erc20'
  const outputAsset = params.tokenOut.native ? 'native' : 'erc20'

  const quoteOne = async (pool: PoolDef): Promise<RouteAttempt> => {
    {
      if (pool.model === 'almm' && (params.tokenIn.native || params.tokenOut.native)) {
        return { pool, error: 'ALMM bin pools settle WETH (ERC-20). Choose WETH instead of ETH for this route.' }
      }

      const request = {
        model: pool.model,
        pool: pool.address,
        tokenIn: params.tokenIn.address,
        inputAsset,
        outputAsset,
        amountIn: params.amountIn,
        payer: params.payer,
        slippageBps: params.slippageBps,
      } as const

      try {
        const prepared = await swap.prepareExactIn(request)
        return { pool, route: { pool, prepared, quote: prepared.quote, partial: false } }
      } catch (strictError) {
        // A pool that cannot fill the whole amount fails closed; retry once with an
        // explicit partial fill so the UI can show a marked, honest partial route.
        try {
          const prepared = await swap.prepareExactIn({ ...request, allowPartialFill: true })
          if (prepared.quote.expectedAmountOut === 0n) {
            return { pool, error: 'This pool has no liquidity for the swap.' }
          }
          return { pool, route: { pool, prepared, quote: prepared.quote, partial: prepared.quote.remainderAmountIn > 0n } }
        } catch {
          return { pool, error: message(strictError) }
        }
      }
    }
  }

  // Two quotes at a time: the public GIWA RPC rate-limits bursts of eth_call.
  const settle: RouteAttempt[] = []
  for (let index = 0; index < candidates.length; index += 2) {
    const chunk = candidates.slice(index, index + 2)
    settle.push(...(await Promise.all(chunk.map(quoteOne))))
  }

  let best: RouteQuote | null = null
  for (const attempt of settle) {
    if (!attempt.route) continue
    if (!best || attempt.route.quote.expectedAmountOut > best.quote.expectedAmountOut) best = attempt.route
  }
  return { best, attempts: settle }
}

/** Price impact in basis points, or null when the pool cannot report one. */
export function priceImpactBps(quote: ExactInputQuote): number | null {
  if (quote.priceImpactBps === null) return null
  return Number(quote.priceImpactBps)
}

export function rateText(quote: ExactInputQuote, tokenIn: Token, tokenOut: Token): string {
  const amountIn = Number(quote.fillableAmountIn) / 10 ** tokenIn.decimals
  const amountOut = Number(quote.expectedAmountOut) / 10 ** tokenOut.decimals
  if (amountIn <= 0 || amountOut <= 0) return '—'
  const rate = amountOut / amountIn
  const formatted = rate >= 1 ? rate.toLocaleString('en-US', { maximumFractionDigits: 6 }) : rate.toPrecision(6)
  return `1 ${tokenIn.symbol} = ${formatted} ${tokenOut.symbol}`
}
