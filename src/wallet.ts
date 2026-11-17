import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { CHAIN_ID, EXPLORER_URL, RPC_URL, giwaSepolia } from './chain'

/** Minimal EIP-1193 surface used by the app (MetaMask, Rabby, any injected wallet). */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, listener: (...args: never[]) => void) => void
  removeListener?: (event: string, listener: (...args: never[]) => void) => void
  isMetaMask?: boolean
  isRabby?: boolean
  isCoinbaseWallet?: boolean
}

type WalletWindow = Window & {
  ethereum?: Eip1193Provider
  rabby?: unknown
  coinbaseWalletExtension?: unknown
}

export function getProvider(): Eip1193Provider | null {
  const win = window as WalletWindow
  return win.ethereum ?? null
}

export function walletLabel(): string {
  const p = getProvider()
  if (!p) return 'wallet'
  if (p.isRabby) return 'Rabby'
  if (p.isMetaMask) return 'MetaMask'
  if (p.isCoinbaseWallet) return 'Coinbase Wallet'
  return 'Browser wallet'
}

/** Ask the injected wallet for accounts (EIP-1102). */
export async function requestAccounts(): Promise<Address> {
  const provider = getProvider()
  if (!provider) throw new Error('No browser wallet found. Install MetaMask or Rabby to continue.')
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const first = accounts?.[0]
  if (!first) throw new Error('The wallet returned no account.')
  return first as Address
}

/** Accounts the wallet already exposes, without prompting (empty when locked). */
export async function readAccounts(): Promise<Address[]> {
  const provider = getProvider()
  if (!provider) return []
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
    return (accounts ?? []).map((a) => a as Address)
  } catch {
    return []
  }
}

export async function readChainId(): Promise<number | null> {
  const provider = getProvider()
  if (!provider) return null
  try {
    const hex = (await provider.request({ method: 'eth_chainId' })) as string
    return Number.parseInt(hex, 16)
  } catch {
    return null
  }
}

type RpcError = { code?: number; message?: string; data?: unknown }

function errorCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as RpcError).code
    if (typeof code === 'number') return code
  }
  return undefined
}

/**
 * One-click network switch for GIWA Sepolia, adding the chain when the wallet
 * does not know it yet (EIP-3326 `wallet_switchEthereumChain` with a
 * `wallet_addEthereumChain` fallback, error code 4902).
 */
export async function switchToGiwaSepolia(): Promise<void> {
  const provider = getProvider()
  if (!provider) throw new Error('No browser wallet found.')
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] })
    return
  } catch (error) {
    const code = errorCode(error)
    if (code !== 4902 && code !== -32603) throw error
  }

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: `0x${CHAIN_ID.toString(16)}`,
        chainName: 'GIWA Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [RPC_URL],
        blockExplorerUrls: [EXPLORER_URL],
      },
    ],
  })
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] })
}

/** viem wallet client bound to the injected provider and GIWA Sepolia. */
export function createWalletClientFor(account: Address): WalletClient {
  const provider = getProvider()
  if (!provider) throw new Error('No browser wallet found.')
  return createWalletClient({
    account,
    chain: giwaSepolia,
    transport: custom(provider),
  }) as WalletClient
}

export function subscribeWallet(handlers: {
  onAccounts: (accounts: Address[]) => void
  onChain: (chainId: number) => void
}): () => void {
  const provider = getProvider()
  if (!provider?.on || !provider.removeListener) return () => {}

  const accounts = (...args: never[]) => handlers.onAccounts(((args[0] as string[]) ?? []) as Address[])
  const chain = (...args: never[]) => handlers.onChain(Number.parseInt(args[0] as string, 16))
  provider.on('accountsChanged', accounts)
  provider.on('chainChanged', chain)
  return () => {
    provider.removeListener?.('accountsChanged', accounts)
    provider.removeListener?.('chainChanged', chain)
  }
}

export function shortAddress(address: string, size = 4): string {
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`
}
