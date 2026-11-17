import type { SafeSwapStatus } from '@ammora-protocol/sdk'

export type TxState =
  | { phase: 'idle' }
  | { phase: 'working'; step: string; hash?: string }
  | { phase: 'success'; hash: string; amountReceived: bigint | null; approvals: string[] }
  | { phase: 'error'; error: string }

/** Turns the SDK's execution status stream into one short line for the UI. */
export function describeStatus(status: SafeSwapStatus): string {
  switch (status.type) {
    case 'quote-refreshed':
      return 'Quote refreshed for the current block'
    case 'approval-requested':
      return 'Approve the token spend in your wallet'
    case 'approval-submitted':
      return 'Approval submitted'
    case 'approval-confirmed':
      return 'Approval confirmed'
    case 'swap-requested':
      return 'Confirm the swap in your wallet'
    case 'swap-submitted':
      return 'Swap submitted — waiting for the receipt'
    case 'swap-confirmed':
      return 'Swap confirmed'
    default:
      return 'Working…'
  }
}

export function statusHash(status: SafeSwapStatus): string | undefined {
  if ('hash' in status && typeof status.hash === 'string') return status.hash
  return undefined
}
