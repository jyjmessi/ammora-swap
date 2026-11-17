import type { PoolDef, Token } from './types'
import dataset from './data/pools.json'
import { WETH } from './chain'

const WETH_TOKEN: Token = {
  address: WETH,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
}

const tokensByKey = new Map<string, Token>()

export function tokenKey(token: Token): string {
  return `${token.address.toLowerCase()}:${token.native ? 'native' : 'erc20'}`
}

function index(token: Token): void {
  tokensByKey.set(tokenKey(token), token)
}

for (const token of dataset.tokens as Token[]) index(token)
index(WETH_TOKEN)

export function knownTokens(): Token[] {
  return [...tokensByKey.values()]
}

export function registerToken(token: Token): void {
  index(token)
}

/** Keeps the bundled ETH display token in sync with a pool's wrapped-native address. */
export function symbolForPoolToken(address: string, tokens: Token[]): string {
  if (address.toLowerCase() === WETH.toLowerCase()) return 'ETH'
  const match = tokens.find((t) => t.address.toLowerCase() === address.toLowerCase() && !t.native)
  return match?.symbol ?? `${address.slice(0, 6)}…`
}

export function tokenForPoolToken(address: string, tokens: Token[]): Token | null {
  const lower = address.toLowerCase()
  const eth = tokens.find((t) => t.address.toLowerCase() === lower && t.native)
  if (eth) return eth
  return tokens.find((t) => t.address.toLowerCase() === lower) ?? null
}

export function bundledPools(): PoolDef[] {
  return (dataset.pools as Array<{
    model: PoolDef['model']
    pool: string
    base: string
    quote: string
    feeBps: number | null
    block: number | null
  }>).map((pool) => ({
    id: `${pool.model}:${pool.pool.toLowerCase()}`,
    model: pool.model,
    address: pool.pool as PoolDef['address'],
    base: pool.base as PoolDef['address'],
    quote: pool.quote as PoolDef['address'],
    feeBps: pool.feeBps,
    createdBlock: pool.block,
    source: 'index' as const,
  }))
}

export const DATASET_GENERATED_AT = dataset.generatedAt as string

export const DEFAULT_TOKENS: { from: string; to: string } = { from: WETH, to: WETH }

/** Thousands separators, trimmed to a readable number of decimals. */
export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fraction = abs % base
  const fractionDigits =
    fraction === 0n ? '' : fraction.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, maxFractionDigits)
  const text = fractionDigits ? `${whole.toLocaleString('en-US')}.${fractionDigits}` : whole.toLocaleString('en-US')
  return negative ? `-${text}` : text
}

/** Compact human number for liquidity and balance columns. */
export function formatCompact(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: digits })
  if (value >= 0.0001) return value.toPrecision(3)
  return value.toExponential(2)
}

export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals
}

/** Keeps a user-typed decimal string valid: digits plus at most one dot. */
export function sanitizeAmountInput(raw: string, decimals: number): string {
  let text = raw.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const firstDot = text.indexOf('.')
  if (firstDot !== -1) {
    text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '')
  }
  const [whole, fraction] = text.split('.')
  const trimmedWhole = (whole ?? '').replace(/^0+(?=\d)/, '')
  if (fraction === undefined) return trimmedWhole
  return `${trimmedWhole || '0'}.${fraction.slice(0, decimals)}`
}

/** Parses a decimal string into base units, or null when it is not a positive number. */
export function parseAmountInput(text: string, decimals: number): bigint | null {
  if (!text || text === '.' || text === '0' || text === '0.') return null
  const [whole = '', fraction = ''] = text.split('.')
  const digitsOnly = `${whole || '0'}${fraction.padEnd(decimals, '0').slice(0, decimals)}`
  if (!/^\d+$/.test(digitsOnly)) return null
  try {
    const value = BigInt(digitsOnly)
    return value > 0n ? value : null
  } catch {
    return null
  }
}

export function sameToken(a: Token | null, b: Token | null): boolean {
  if (!a || !b) return false
  return a.address.toLowerCase() === b.address.toLowerCase() && Boolean(a.native) === Boolean(b.native)
}

/** Adds a short address suffix when two tokens share a symbol. */
export function symbolWithSuffix(token: Token, tokens: Token[]): string {
  const clash = tokens.filter((t) => t.symbol.toLowerCase() === token.symbol.toLowerCase())
  if (clash.length < 2) return token.symbol
  return `${token.symbol} ·${token.address.slice(2, 6)}`
}
