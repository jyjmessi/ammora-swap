import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { formatAmount, symbolWithSuffix, tokenKey } from '../tokens'
import type { Token } from '../types'
import { CloseIcon, SearchIcon, Spinner } from './Icons'

type Props = {
  title: string
  tokens: Token[]
  balances: Record<string, bigint | null>
  selected: Token | null
  onSelect: (token: Token) => void
  onClose: () => void
  onImport: (address: Address) => Promise<Token>
}

export function TokenSelect({ title, tokens, balances, selected, onSelect, onClose, onImport }: Props) {
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return tokens
    return tokens.filter(
      (token) =>
        token.symbol.toLowerCase().includes(text) ||
        token.name.toLowerCase().includes(text) ||
        token.address.toLowerCase().includes(text),
    )
  }, [query, tokens])

  const looksLikeAddress = /^0x[a-fA-F0-9]{40}$/.test(query.trim())

  async function handleImport() {
    if (!looksLikeAddress) return
    setImporting(true)
    setImportError(null)
    try {
      const token = await onImport(query.trim() as Address)
      onSelect(token)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read that token contract.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="search-field">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or paste an address"
            spellCheck={false}
          />
        </div>

        {looksLikeAddress && (
          <div className="import-row">
            <span>ERC-20 on GIWA Sepolia</span>
            <button type="button" className="ghost-btn" onClick={handleImport} disabled={importing}>
              {importing ? <Spinner size={14} /> : null}
              {importing ? 'Reading…' : 'Import token'}
            </button>
          </div>
        )}
        {importError && <p className="inline-error">{importError}</p>}

        <ul className="token-list">
          {filtered.map((token) => {
            const balance = balances[tokenKey(token)]
            const isSelected = selected ? tokenKey(selected) === tokenKey(token) : false
            return (
              <li key={tokenKey(token)}>
                <button
                  type="button"
                  className={`token-row${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelect(token)}
                >
                  <span className="token-avatar" aria-hidden="true">
                    {token.symbol.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="token-main">
                    <span className="token-symbol">{symbolWithSuffix(token, tokens)}</span>
                    <span className="token-name">{token.name}</span>
                  </span>
                  <span className="token-balance">
                    {balance === undefined || balance === null ? '—' : formatAmount(balance, token.decimals, 5)}
                  </span>
                </button>
              </li>
            )
          })}
          {filtered.length === 0 && <li className="empty-row">No token matches that search.</li>}
        </ul>
      </div>
    </div>
  )
}
