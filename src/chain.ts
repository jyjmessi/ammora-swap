import { defineChain } from 'viem'

/** GIWA Sepolia — the only chain this app talks to. */
export const CHAIN_ID = 91342
export const RPC_URL = 'https://sepolia-rpc.giwa.io'
export const EXPLORER_URL = 'https://sepolia-explorer.giwa.io'
export const DATA_API_URL = 'https://ammora-giwa-sepolia-data.fly.dev'

/**
 * Wrapped-native address the Ammora pools custody on GIWA Sepolia.
 * The UI shows this token as plain "ETH" and, where the reviewed routers
 * support it, swaps it as native value.
 */
export const WETH = '0x4200000000000000000000000000000000000006' as const

export const giwaSepolia = defineChain({
  id: CHAIN_ID,
  name: 'GIWA Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'GIWA Explorer', url: EXPLORER_URL } },
  testnet: true,
})

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`
export const addressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`
