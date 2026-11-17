import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { formatCompact, symbolForPoolToken, toNumber } from '../tokens'
import type { Model, PoolLive, Token } from '../types'
import { MODEL_SHORT } from '../types'
import { AlertIcon, ExternalIcon, SearchIcon, Spinner } from './Icons'

type Props = {
  pools: PoolLive[]
  tokens: Token[]
  busy: boolean
  sourceLabel: string
  note: string | null
  scanning: boolean
  onSelectPool: (pool: PoolLive) => void
  onRefresh: () => void
  onScan: () => void
  onImportPool: (address: Address) => Promise<void>
}

const FILTERS: Array<{ id: 'all' | Model; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'compounding', label: 'Compounding' },
  { id: 'concentrated', label: 'Concentrated' },
  { id: 'almm', label: 'ALMM' },
]

function liquidityText(pool: PoolLive, tokens: Token[]): string {
  if (!pool.live && pool.reserveQuoteHint) {
    const quoteToken = tokens.find((token) => token.address.toLowerCase() === pool.quote.toLowerCase() && !token.native)
    const value = toNumber(pool.reserveQuoteHint, quoteToken?.decimals ?? 18)
    return `~${formatCompact(value)} ${symbolForPoolToken(pool.quote, tokens)}`
  }
  if (!pool.live) return pool.activeIdHint !== null && pool.activeIdHint !== undefined ? `active bin ${pool.activeIdHint}` : '—'
  if (pool.live.reserveQuote !== null) {
    const quoteToken = tokens.find(
      (token) => token.address.toLowerCase() === pool.live?.quote.toLowerCase() && !token.native,
    )
    const decimals = quoteToken?.decimals ?? 18
    const value = toNumber(pool.live.reserveQuote, decimals)
    const symbol = symbolForPoolToken(pool.live.quote, tokens)
    return `${formatCompact(value)} ${symbol}`
  }
  if (pool.live.activeId !== null) return `active bin ${pool.live.activeId}`
  return '—'
}

export function MarketsPanel(props: Props) {
  const { pools, tokens, busy, sourceLabel, note, scanning } = props
  const [filter, setFilter] = useState<'all' | Model>('all')
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase()
    return pools
      .filter((pool) => (filter === 'all' ? true : pool.model === filter))
      .filter((pool) => {
        if (!text) return true
        const base = symbolForPoolToken(pool.base, tokens).toLowerCase()
        const quote = symbolForPoolToken(pool.quote, tokens).toLowerCase()
        return base.includes(text) || quote.includes(text) || pool.address.toLowerCase().includes(text)
      })
      .sort((a, b) => {
        const left = a.live?.reserveQuote !== null && a.live?.reserveQuote !== undefined ? Number(a.live.reserveQuote) : -1
        const right = b.live?.reserveQuote !== null && b.live?.reserveQuote !== undefined ? Number(b.live.reserveQuote) : -1
        return right - left
      })
  }, [pools, filter, query, tokens])

  async function submitImport() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(importValue.trim())) {
      setImportError('Enter a 0x-prefixed pool address.')
      return
    }
    setImporting(true)
    setImportError(null)
    try {
      await props.onImportPool(importValue.trim() as Address)
      setImportValue('')
      setImportOpen(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not resolve that pool.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="markets" aria-label="Markets">
      <header className="markets-head">
        <div>
          <h2>Markets</h2>
          <p className="markets-sub">
            {pools.length} pools on GIWA Sepolia · {sourceLabel}
          </p>
        </div>
        <div className="markets-actions">
          <button type="button" className="ghost-btn" onClick={props.onScan} disabled={scanning}>
            {scanning ? <Spinner size={14} /> : null}
            {scanning ? 'Scanning…' : 'Scan new pools'}
          </button>
          <button type="button" className="ghost-btn" onClick={props.onRefresh} disabled={busy}>
            {busy ? <Spinner size={14} /> : null}
            {busy ? 'Refreshing…' : 'Refresh state'}
          </button>
        </div>
      </header>

      {note && (
        <p className="inline-warning small">
          <AlertIcon /> {note}
        </p>
      )}

      <div className="markets-tools">
        <div className="search-field compact">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by token or pool" spellCheck={false} />
        </div>
        <div className="chip-row tight">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className={`chip${importOpen ? ' is-active' : ''}`} onClick={() => setImportOpen((open) => !open)}>
            + Pool
          </button>
        </div>
      </div>

      {importOpen && (
        <div className="import-pool">
          <input
            value={importValue}
            onChange={(event) => setImportValue(event.target.value)}
            placeholder="Paste any Ammora pool address"
            spellCheck={false}
          />
          <button type="button" className="ghost-btn" onClick={submitImport} disabled={importing}>
            {importing ? <Spinner size={14} /> : null}
            {importing ? 'Resolving…' : 'Add pool'}
          </button>
        </div>
      )}
      {importError && <p className="inline-error small">{importError}</p>}

      <div className="market-table">
        <div className="market-row market-head-row">
          <span>Pair</span>
          <span>Model</span>
          <span>Fee</span>
          <span>Liquidity</span>
          <span />
        </div>
        {pools.length === 0 && <div className="market-skeleton">Reading pool state from GIWA Sepolia…</div>}
        {visible.map((pool) => {
          const base = symbolForPoolToken(pool.base, tokens)
          const quote = symbolForPoolToken(pool.quote, tokens)
          const dead = !pool.live
          return (
            <button
              key={pool.id}
              type="button"
              className={`market-row market-body-row${dead ? ' is-dead' : ''}`}
              onClick={() => props.onSelectPool(pool)}
              title={dead ? pool.error ?? 'Pool state unavailable' : 'Trade this pair'}
            >
              <span className="pair-cell">
                <span className="pair-avatars">
                  <span className="token-avatar tiny">{base.slice(0, 2).toUpperCase()}</span>
                  <span className="token-avatar tiny offset">{quote.slice(0, 2).toUpperCase()}</span>
                </span>
                <span className="pair-name">
                  <strong>
                    {base}
                    <span className="slash">/</span>
                    {quote}
                  </strong>
                  <span className="pair-address">{pool.address.slice(0, 8)}…{pool.address.slice(-6)}</span>
                </span>
              </span>
              <span className="model-cell">
                <span className={`tag model-${pool.model}`}>{MODEL_SHORT[pool.model]}</span>
              </span>
              <span className="fee-cell">{pool.live?.feeBps ?? pool.feeBps ?? '—'} bps</span>
              <span className="liq-cell">{liquidityText(pool, tokens)}</span>
              <span className="go-cell">
                <ExternalIcon />
              </span>
            </button>
          )
        })}
        {!busy && visible.length === 0 && <div className="market-skeleton">No pool matches this filter.</div>}
      </div>
    </section>
  )
}
