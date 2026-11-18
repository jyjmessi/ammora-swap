import { useState } from 'react'
import type { Address } from 'viem'
import { addressUrl, txUrl } from '../chain'
import type { QuoteResult } from '../quote'
import { formatAmount, symbolWithSuffix, tokenKey } from '../tokens'
import type { TxState } from '../tx'
import type { Token } from '../types'
import { MODEL_SHORT } from '../types'
import {
  AlertIcon,
  ArrowSwapIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  ExternalIcon,
  SettingsIcon,
  Spinner,
  WalletIcon,
} from './Icons'

const SLIPPAGE_PRESETS = [10, 50, 100]

type Props = {
  tokens: Token[]
  balances: Record<string, bigint | null>
  fromToken: Token | null
  toToken: Token | null
  amount: string
  amountIn: bigint | null
  slippageBps: number
  quote: QuoteResult | null
  quoting: boolean
  quoteError: string | null
  account: Address | null
  chainId: number | null
  hasProvider: boolean
  busy: boolean
  tx: TxState
  onAmountChange: (value: string) => void
  onPickToken: (side: 'in' | 'out') => void
  onFlip: () => void
  onSlippage: (bps: number) => void
  onMax: () => void
  onSubmit: () => void
  onConnect: () => void
  onSwitchNetwork: () => void
  onDismissTx: () => void
}

function TokenButton({ token, tokens, onClick }: { token: Token | null; tokens: Token[]; onClick: () => void }) {
  return (
    <button type="button" className="token-button" onClick={onClick}>
      {token ? (
        <>
          <span className="token-avatar small" aria-hidden="true">
            {token.symbol.slice(0, 2).toUpperCase()}
          </span>
          <span className="token-button-symbol">{symbolWithSuffix(token, tokens)}</span>
        </>
      ) : (
        <span className="token-button-symbol muted">Select token</span>
      )}
      <ChevronIcon />
    </button>
  )
}

export function SwapCard(props: Props) {
  const {
    tokens,
    balances,
    fromToken,
    toToken,
    amount,
    amountIn,
    slippageBps,
    quote,
    quoting,
    quoteError,
    account,
    chainId,
    hasProvider,
    busy,
    tx,
  } = props

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [customSlippage, setCustomSlippage] = useState('')
  const [copied, setCopied] = useState(false)

  const best = quote?.best ?? null
  const fromBalance = fromToken ? balances[tokenKey(fromToken)] : undefined
  const toBalance = toToken ? balances[tokenKey(toToken)] : undefined
  const insufficient = amountIn !== null && fromBalance !== null && fromBalance !== undefined && amountIn > fromBalance

  const impact = best?.quote.priceImpactBps !== null && best ? Number(best.quote.priceImpactBps) : null
  const impactPct = impact === null ? null : impact / 100
  const impactTone = impactPct === null ? 'neutral' : impactPct > 5 ? 'danger' : impactPct > 1 ? 'warn' : 'neutral'

  const needsApproval = (best?.prepared.approvalRequirements.length ?? 0) > 0

  let actionLabel = 'Swap'
  let actionDisabled = false
  let action = props.onSubmit

  if (!hasProvider) {
    actionLabel = 'Install a wallet'
    action = () => window.open('https://metamask.io/download/', '_blank', 'noopener')
  } else if (!account) {
    actionLabel = 'Connect Wallet'
    action = props.onConnect
  } else if (chainId !== null && chainId !== 91342) {
    actionLabel = 'Switch to GIWA Sepolia'
    action = props.onSwitchNetwork
  } else if (!fromToken || !toToken) {
    actionLabel = 'Select tokens'
    actionDisabled = true
  } else if (!amountIn) {
    actionLabel = 'Enter an amount'
    actionDisabled = true
  } else if (insufficient) {
    actionLabel = `Insufficient ${fromToken.symbol}`
    actionDisabled = true
  } else if (quoting) {
    actionLabel = 'Finding the best route…'
    actionDisabled = true
  } else if (!best) {
    actionLabel = 'No route for this pair'
    actionDisabled = true
  } else if (tx.phase === 'working') {
    actionLabel = 'Confirm in your wallet…'
    actionDisabled = true
  } else if (needsApproval) {
    actionLabel = 'Approve & Swap'
  }

  const outAmount = best ? best.quote.expectedAmountOut : null
  const feeAmount = best?.quote.feeAmount ?? null
  const feeTokenAddress = best?.quote.feeToken ?? null
  const feeDecimals =
    feeTokenAddress && feeAmount !== null
      ? (tokens.find((token) => token.address.toLowerCase() === feeTokenAddress.toLowerCase())?.decimals ?? 18)
      : 18

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="swap-card" aria-label="Swap">
      <header className="swap-head">
        <div>
          <h2>Swap</h2>
          <p className="swap-sub">Exact input · best reviewed pool wins the quote</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Slippage settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SettingsIcon />
        </button>
      </header>

      {settingsOpen && (
        <div className="settings-panel">
          <div className="settings-title">
            <span>Slippage tolerance</span>
            <span className="muted small">max {(slippageBps / 100).toFixed(2)}%</span>
          </div>
          <div className="chip-row">
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`chip${slippageBps === preset ? ' is-active' : ''}`}
                onClick={() => {
                  props.onSlippage(preset)
                  setCustomSlippage('')
                }}
              >
                {(preset / 100).toFixed(preset % 100 === 0 ? 0 : 1)}%
              </button>
            ))}
            <div className="custom-slippage">
              <input
                inputMode="decimal"
                placeholder="Custom"
                value={customSlippage}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^\d.]/g, '')
                  setCustomSlippage(next)
                  const parsed = Number(next)
                  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 50) {
                    props.onSlippage(Math.round(parsed * 100))
                  }
                }}
              />
              <span>%</span>
            </div>
          </div>
        </div>
      )}

      <div className="amount-box">
        <div className="amount-box-head">
          <span>You pay</span>
          {fromToken && (
            <button type="button" className="balance-btn" onClick={props.onMax} title="Use full balance">
              Balance:{' '}
              {fromBalance === undefined || fromBalance === null ? '—' : formatAmount(fromBalance, fromToken.decimals, 5)}
              <span className="max-tag">MAX</span>
            </button>
          )}
        </div>
        <div className="amount-row">
          <input
            className="amount-input"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(event) => props.onAmountChange(event.target.value)}
            spellCheck={false}
          />
          <TokenButton token={fromToken} tokens={tokens} onClick={() => props.onPickToken('in')} />
        </div>
      </div>

      <div className="flip-wrap">
        <button type="button" className="flip-btn" onClick={props.onFlip} aria-label="Switch tokens">
          <ArrowSwapIcon />
        </button>
      </div>

      <div className="amount-box">
        <div className="amount-box-head">
          <span>You receive</span>
          {toToken && (
            <span className="muted small">
              Balance:{' '}
              {toBalance === undefined || toBalance === null ? '—' : formatAmount(toBalance, toToken.decimals, 5)}
            </span>
          )}
        </div>
        <div className="amount-row">
          <span className={`amount-output${outAmount === null ? ' is-empty' : ''}`}>
            {quoting ? <Spinner size={18} /> : outAmount === null || !toToken ? '0.0' : formatAmount(outAmount, toToken.decimals, 6)}
          </span>
          <TokenButton token={toToken} tokens={tokens} onClick={() => props.onPickToken('out')} />
        </div>
      </div>

      {quoteError && (
        <p className="inline-error">
          <AlertIcon /> {quoteError}
        </p>
      )}

      {best && best.partial && (
        <p className="inline-warning">
          <AlertIcon /> Partial fill: this pool can only fill {fromToken ? formatAmount(best.quote.fillableAmountIn, fromToken.decimals, 6) : '—'}{' '}
          of the amount. The rest is not swapped.
        </p>
      )}

      {best && (
        <div className="details">
          <div className="detail-row">
            <span>Rate</span>
            <span>
              {best.quote.fillableAmountIn > 0n && fromToken && toToken
                ? `1 ${fromToken.symbol} ≈ ${formatAmount(
                    (best.quote.expectedAmountOut * 10n ** BigInt(fromToken.decimals)) / best.quote.fillableAmountIn,
                    toToken.decimals,
                    6,
                  )} ${toToken.symbol}`
                : '—'}
            </span>
          </div>
          <div className="detail-row">
            <span>Minimum received</span>
            <span>
              {toToken ? formatAmount(best.quote.minimumAmountOut, toToken.decimals, 6) : '—'} {toToken?.symbol ?? ''}
            </span>
          </div>
          <div className="detail-row">
            <span>Price impact</span>
            <span className={`impact ${impactTone}`}>
              {impactPct === null ? 'n/a' : impactPct > 100 ? '>100%' : `${impactPct.toFixed(2)}%`}
            </span>
          </div>
          {feeAmount !== null && (
            <div className="detail-row">
              <span>Pool fee</span>
              <span>
                {formatAmount(feeAmount, feeDecimals, 6)}{' '}
                {tokens.find((token) => token.address.toLowerCase() === feeTokenAddress?.toLowerCase())?.symbol ?? 'ETH'}
              </span>
            </div>
          )}
          <div className="detail-row">
            <span>Route</span>
            <span className="route-cell">
              <span className="tag">{MODEL_SHORT[best.pool.model]}</span>
              <span>{best.pool.feeBps ?? '—'} bps</span>
              <a href={addressUrl(best.pool.address)} target="_blank" rel="noreferrer" className="link-ico" title="Pool on GIWA Explorer">
                {best.pool.address.slice(0, 6)}…{best.pool.address.slice(-4)}
                <ExternalIcon />
              </a>
            </span>
          </div>
          {quote && quote.attempts.length > 1 && (
            <div className="detail-row">
              <span>Pools compared</span>
              <span>
                {quote.attempts.filter((attempt) => attempt.route).length} of {quote.attempts.length} priced
              </span>
            </div>
          )}
        </div>
      )}

      {tx.phase === 'working' && (
        <div className="tx-panel working">
          <Spinner size={16} />
          <div>
            <strong>{tx.step}</strong>
            {tx.hash && (
              <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
                {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)} <ExternalIcon />
              </a>
            )}
          </div>
        </div>
      )}

      {tx.phase === 'success' && (
        <div className="tx-panel success">
          <CheckIcon size={18} />
          <div>
            <strong>Swap confirmed</strong>
            <span>
              {toToken && tx.amountReceived !== null
                ? `Received ${formatAmount(tx.amountReceived, toToken.decimals, 6)} ${toToken.symbol}`
                : 'Settled on GIWA Sepolia'}
            </span>
            <div className="tx-links">
              <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
                View transaction <ExternalIcon />
              </a>
              <button type="button" className="link-btn" onClick={() => copyHash(tx.hash)}>
                <CopyIcon /> {copied ? 'Copied' : 'Copy hash'}
              </button>
            </div>
          </div>
          <button type="button" className="icon-btn tiny" onClick={props.onDismissTx} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {tx.phase === 'error' && (
        <div className="tx-panel error">
          <AlertIcon size={18} />
          <div>
            <strong>Swap failed</strong>
            <span>{tx.error}</span>
          </div>
          <button type="button" className="icon-btn tiny" onClick={props.onDismissTx} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <button type="button" className="action-btn" onClick={action} disabled={actionDisabled || busy}>
        {!hasProvider ? <WalletIcon /> : null}
        {actionLabel}
      </button>

      <p className="card-note">
        {slippageBps / 100}% slippage · 30s quote validity · approvals are exact-amount and signed by you
      </p>
    </section>
  )
}
