export type Address = `0x${string}`

/** Ammora pool models this app can quote and trade on GIWA Sepolia. */
export type Model = 'almm' | 'concentrated' | 'compounding'

export const MODEL_LABEL: Record<Model, string> = {
  almm: 'ALMM',
  concentrated: 'DAMM v2 · Concentrated',
  compounding: 'DAMM v2 · Compounding',
}

export const MODEL_SHORT: Record<Model, string> = {
  almm: 'ALMM',
  concentrated: 'Concentrated',
  compounding: 'Compounding',
}

export type Token = {
  address: Address
  symbol: string
  name: string
  decimals: number
  /** True for the wrapped-native entry that the UI presents as ETH. */
  native?: boolean
}

export type PoolDef = {
  id: string
  model: Model
  address: Address
  base: Address
  quote: Address
  feeBps: number | null
  createdBlock: number | null
  source: 'index' | 'scan' | 'data-api' | 'manual'
  /** Last known quote-token reserve from the bundled index, used until the live read lands. */
  reserveQuoteHint?: bigint | null
  /** Last known active bin for ALMM pools. */
  activeIdHint?: number | null
}

export type LiveState = {
  base: Address
  quote: Address
  feeBps: number | null
  status: number | null
  reserveBase: bigint | null
  reserveQuote: bigint | null
  activeId: number | null
  binStepBps: number | null
}

export type PoolLive = PoolDef & {
  live: LiveState | null
  error?: string
}
