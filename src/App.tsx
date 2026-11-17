import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { CHAIN_ID, DATA_API_URL, WETH, addressUrl } from './chain'
import { getProvider, readAccounts, readChainId, requestAccounts, switchToGiwaSepolia, walletLabel } from './wallet'
import { createWalletClientFor, shortAddress, subscribeWallet } from './wallet'
import { nativeToken, readBalance, readBlockNumber, readTokenMeta } from './ammora'
import {
  DATASET_GENERATED_AT,
  formatAmount,
  knownTokens,
  parseAmountInput,
  sameToken,
  sanitizeAmountInput,
  tokenKey,
} from './tokens'
import { fetchDataApiPools, importPool, initialPools, loadPoolStates, scanRecentPools } from './pools'
import { quoteBestRoute, type QuoteResult } from './quote'
import { describeStatus, statusHash, type TxState } from './tx'
import type { PoolLive, Token } from './types'
import { SwapCard } from './components/SwapCard'
import { MarketsPanel } from './components/MarketsPanel'
import { TokenSelect } from './components/TokenSelect'
import { AlertIcon, ChevronIcon, ExternalIcon, LogoMark, Spinner, WalletIcon } from './components/Icons'

/**
 * The SDK refuses the zero address as a payer. Before a wallet is connected the
 * app still shows a real quote, planned for this placeholder that never signs.
 */
const PREVIEW_PAYER: Address = '0x000000000000000000000000000000000000dEaD'
const SLIPPAGE_KEY = 'ammora-swap.slippageBps'

function initialTokens(): Token[] {
  return knownTokens()
}

function pickToken(tokens: Token[], address: string, wantNative: boolean): Token | null {
  const lower = address.toLowerCase()
  if (lower === WETH.toLowerCase() && wantNative) {
    return tokens.find((token) => token.native) ?? nativeToken()
  }
  return tokens.find((token) => !token.native && token.address.toLowerCase() === lower) ?? null
}

export default function App() {
  const [tokens, setTokens] = useState<Token[]>(initialTokens)
  const [pools, setPools] = useState<PoolLive[]>(() => initialPools().map((pool) => ({ ...pool, live: null })))
  const [poolsBusy, setPoolsBusy] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [sourceLabel, setSourceLabel] = useState('on-chain index')
  const [sourceNote, setSourceNote] = useState<string | null>(null)

  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [walletBusy, setWalletBusy] = useState(false)
  const [hasProvider, setHasProvider] = useState(false)

  const [balances, setBalances] = useState<Record<string, bigint | null>>({})

  const [fromToken, setFromToken] = useState<Token | null>(() => {
    const list = knownTokens()
    return list.find((token) => token.native) ?? list[0] ?? null
  })
  const [toToken, setToToken] = useState<Token | null>(() =>
    pickToken(knownTokens(), '0x9976F3d67D3D73619EEd90E9e2eb2F6c765F47da', false),
  )
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(() => {
    const stored = Number(window.localStorage.getItem(SLIPPAGE_KEY))
    return Number.isFinite(stored) && stored > 0 && stored <= 5000 ? stored : 50
  })

  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [tx, setTx] = useState<TxState>({ phase: 'idle' })
  const [modal, setModal] = useState<'in' | 'out' | null>(null)
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null)

  const quoteSeq = useRef(0)
  const busy = tx.phase === 'working' || walletBusy

  /** Live state for a set of pools, merged into the current list. */
  const mergePools = useCallback(async (incoming: PoolLive[]) => {
    if (incoming.length === 0) return
    setPools((current) => {
      const map = new Map(current.map((pool) => [pool.id, pool]))
      for (const pool of incoming) map.set(pool.id, pool)
      return [...map.values()]
    })
  }, [])

  /* ---------------------------------------------------------------- bootstrap */

  useEffect(() => {
    setHasProvider(Boolean(getProvider()))
    let cancelled = false

    void (async () => {
      const [accounts, currentChainId, list, head] = await Promise.all([
        readAccounts(),
        readChainId(),
        (async () => loadPoolStates(initialPools()))(),
        readBlockNumber().catch(() => null),
      ])
      if (cancelled) return
      if (accounts[0]) setAccount(accounts[0])
      setChainId(currentChainId)
      setPools(list)
      setBlockNumber(head)
      setPoolsBusy(false)

    })().catch((error: unknown) => {
      if (cancelled) return
      setPoolsBusy(false)
      setSourceNote(
        `Could not read pool state from GIWA Sepolia: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeWallet({
      onAccounts: (accounts) => setAccount(accounts[0] ?? null),
      onChain: (nextChainId) => setChainId(nextChainId),
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.wallet = hasProvider ? 'ready' : 'missing'
  }, [hasProvider])

  /* ------------------------------------------------------------------ balances */

  const refreshBalances = useCallback(
    async (owner: Address, list: Token[]) => {
      // The public GIWA RPC rate-limits bursts, so balances are read in small batches.
      const entries: Array<readonly [string, bigint | null]> = []
      for (let index = 0; index < list.length; index += 4) {
        const batch = list.slice(index, index + 4)
        const results = await Promise.all(
          batch.map(async (token) => {
            try {
              const value = await readBalance(token, owner)
              return [tokenKey(token), value] as const
            } catch {
              return [tokenKey(token), null] as const
            }
          }),
        )
        entries.push(...results)
      }
      setBalances((current) => ({ ...current, ...Object.fromEntries(entries) }))
    },
    [],
  )

  useEffect(() => {
    if (!account) return
    void refreshBalances(account, tokens)
  }, [account, tokens, refreshBalances])

  useEffect(() => {
    window.localStorage.setItem(SLIPPAGE_KEY, String(slippageBps))
  }, [slippageBps])

  /* --------------------------------------------------------------------- quote */

  const amountIn = useMemo(() => (fromToken ? parseAmountInput(amount, fromToken.decimals) : null), [amount, fromToken])

  const tradablePools = useMemo(
    () => pools.map((pool) => ({ ...pool })) as PoolLive[],
    [pools],
  )

  useEffect(() => {
    if (!fromToken || !toToken || !amountIn) {
      setQuote(null)
      setQuoteError(null)
      setQuoting(false)
      return
    }

    const sequence = ++quoteSeq.current
    setQuoting(true)
    setQuoteError(null)

    const timer = window.setTimeout(async () => {
      try {
        const result = await quoteBestRoute({
          pools: tradablePools,
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn,
          payer: account ?? PREVIEW_PAYER,
          slippageBps,
        })
        if (sequence !== quoteSeq.current) return
        setQuote(result)
        const failures = result.attempts.filter((attempt) => attempt.error)
        const informative = failures.find((attempt) => !attempt.error?.includes('settle WETH')) ?? failures[0]
        setQuoteError(result.best ? null : informative?.error ?? 'No Ammora pool can price this swap.')
      } catch (error) {
        if (sequence !== quoteSeq.current) return
        setQuote(null)
        setQuoteError(error instanceof Error ? error.message.split('\n')[0] : 'Quote failed')
      } finally {
        if (sequence === quoteSeq.current) setQuoting(false)
      }
    }, 320)

    return () => window.clearTimeout(timer)
  }, [fromToken, toToken, amountIn, slippageBps, account, tradablePools])

  /* -------------------------------------------------------------------- wallet */

  const handleConnect = useCallback(async () => {
    setWalletBusy(true)
    try {
      const address = await requestAccounts()
      setAccount(address)
      setChainId(await readChainId())
      if ((await readChainId()) !== CHAIN_ID) {
        await switchToGiwaSepolia().catch(() => undefined)
        setChainId(await readChainId())
      }
    } catch (error) {
      setTx({ phase: 'error', error: error instanceof Error ? error.message : 'Could not connect the wallet.' })
    } finally {
      setWalletBusy(false)
    }
  }, [])

  const handleSwitchNetwork = useCallback(async () => {
    setWalletBusy(true)
    try {
      await switchToGiwaSepolia()
      setChainId(await readChainId())
    } catch (error) {
      setTx({ phase: 'error', error: error instanceof Error ? error.message : 'Could not switch networks.' })
    } finally {
      setWalletBusy(false)
    }
  }, [])

  /* ------------------------------------------------------------------ execution */

  const handleSubmit = useCallback(async () => {
    if (!account || !quote?.best) return
    const prepared = quote.best.prepared
    setTx({ phase: 'working', step: 'Simulating the swap at the latest block' })
    try {
      const wallet = createWalletClientFor(account)
      const result = await prepared.execute(wallet, {
        autoRefresh: true,
        onStatus: (status) =>
          setTx((current) =>
            current.phase === 'working'
              ? { phase: 'working', step: describeStatus(status), hash: statusHash(status) ?? current.hash }
              : current,
          ),
      })
      setTx({
        phase: 'success',
        hash: result.hash,
        amountReceived: result.amountReceived,
        approvals: [...result.approvalHashes],
      })
      setAmount('')
      void refreshBalances(account, tokens)
      const refreshed = await loadPoolStates(pools)
      setPools(refreshed)
    } catch (error) {
      setTx({
        phase: 'error',
        error: error instanceof Error ? error.message.split('\n')[0] : 'The swap could not be completed.',
      })
    }
  }, [account, quote, pools, refreshBalances, tokens])

  /* -------------------------------------------------------------------- markets */

  const handleRefresh = useCallback(async () => {
    setPoolsBusy(true)
    try {
      const api = await fetchDataApiPools()
      if (api.pools.length > 0) {
        const ids = new Set(pools.map((pool) => pool.id))
        const additions = api.pools.filter((pool) => !ids.has(pool.id))
        const states = await loadPoolStates(additions)
        await mergePools(states)
        setSourceLabel('Ammora Data API')
        setSourceNote(null)
      } else {
        setSourceLabel('on-chain reads')
        setSourceNote(
          api.error
            ? `The Ammora Data API did not answer (${api.error.slice(0, 90)}), so the app read the indexed pools straight from GIWA Sepolia.`
            : null,
        )
      }
      setPools(await loadPoolStates([...pools]))
      setBlockNumber(await readBlockNumber().catch(() => null))
    } catch (error) {
      setSourceNote(error instanceof Error ? error.message : 'Refresh failed')
    } finally {
      setPoolsBusy(false)
    }
  }, [mergePools, pools])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const found = await scanRecentPools(40_000)
      const states = await loadPoolStates(found)
      await mergePools(states)
      setSourceLabel(found.length > 0 ? 'on-chain index + live factory scan' : 'on-chain index')
    } catch (error) {
      setTx({ phase: 'error', error: error instanceof Error ? error.message : 'Factory scan failed.' })
    } finally {
      setScanning(false)
    }
  }, [mergePools])

  const handleSelectPool = useCallback(
    (pool: PoolLive) => {
      const base = pickToken(tokens, pool.base, pool.model !== 'almm')
      const quoteSide = pickToken(tokens, pool.quote, pool.model !== 'almm')
      if (!base || !quoteSide) return
      setFromToken(quoteSide)
      setToToken(base)
      setAmount('')
      setTx({ phase: 'idle' })
    },
    [tokens],
  )

  const handleImportPool = useCallback(
    async (address: Address) => {
      const pool = await importPool(address)
      const [state] = await loadPoolStates([pool])
      await mergePools([state])
      handleSelectPool(state)
      setSourceLabel('index + imported pools')
    },
    [handleSelectPool, mergePools],
  )

  /* --------------------------------------------------------------------- tokens */

  const handleImportToken = useCallback(async (address: Address) => {
    const token = await readTokenMeta(address)
    setTokens((current) => {
      const exists = current.some((item) => tokenKey(item) === tokenKey(token))
      return exists ? current : [...current, token]
    })
    return token
  }, [])

  const handleFlip = useCallback(() => {
    setFromToken(toToken)
    setToToken(fromToken)
    setAmount('')
  }, [fromToken, toToken])

  const handleMax = useCallback(() => {
    if (!fromToken || !account) return
    const balance = balances[tokenKey(fromToken)]
    if (balance === undefined || balance === null) return
    const reserve = fromToken.native ? 300000000000000n : 0n
    const spendable = balance > reserve ? balance - reserve : 0n
    setAmount(formatAmount(spendable, fromToken.decimals, fromToken.decimals).replace(/,/g, ''))
  }, [account, balances, fromToken])

  const tokenList = useMemo(
    () =>
      [...tokens].sort((a, b) => {
        if (a.native) return -1
        if (b.native) return 1
        const left = balances[tokenKey(a)] ?? 0n
        const right = balances[tokenKey(b)] ?? 0n
        if (left !== right) return left > right ? -1 : 1
        return a.symbol.localeCompare(b.symbol)
      }),
    [tokens, balances],
  )

  const wrongNetwork = account !== null && chainId !== null && chainId !== CHAIN_ID

  return (
    <div className="app">
      <div className="aurora" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <LogoMark size={34} />
            <div className="brand-text">
              <strong>Ammora Swap</strong>
              <span>Season 2 Builder · GIWA Sepolia</span>
            </div>
          </div>

          <div className="topbar-right">
            <a
              className="network-chip"
              href="https://sepolia-explorer.giwa.io"
              target="_blank"
              rel="noreferrer"
              title="GIWA Sepolia explorer"
            >
              <span className="dot" />
              GIWA Sepolia
              <span className="chain-id">91342</span>
            </a>

            {account ? (
              <button type="button" className={`wallet-btn${wrongNetwork ? ' warn' : ''}`} onClick={handleSwitchNetwork} title="Wallet">
                <WalletIcon />
                <span>{shortAddress(account)}</span>
                {wrongNetwork && <span className="wallet-warn">wrong network</span>}
                <ChevronIcon />
              </button>
            ) : (
              <button type="button" className="wallet-btn primary" onClick={handleConnect} disabled={walletBusy}>
                {walletBusy ? <Spinner size={14} /> : <WalletIcon />}
                <span>{walletBusy ? 'Connecting…' : `Connect ${walletLabel()}`}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="dot" /> live on testnet
            </span>
            <h1>
              Trade every Ammora pool
              <br />
              on <span className="grad">GIWA Sepolia</span>
            </h1>
            <p>
              One swap screen for ALMM bin pools and DAMM v2 concentrated & compounding pools. Quotes, approvals and
              receipts all come from the <code>@ammora-protocol/sdk</code> — no hand-rolled calldata.
            </p>
            <div className="hero-stats">
              <div className="stat">
                <span className="stat-value">{pools.filter((pool) => pool.live).length}</span>
                <span className="stat-label">pools indexed</span>
              </div>
              <div className="stat">
                <span className="stat-value">3</span>
                <span className="stat-label">pool models</span>
              </div>
              <div className="stat">
                <span className="stat-value">0.3.9</span>
                <span className="stat-label">SDK version</span>
              </div>
              <div className="stat">
                <span className="stat-value">{blockNumber ? blockNumber.toLocaleString('en-US') : '—'}</span>
                <span className="stat-label">latest block</span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid">
          <SwapCard
            tokens={tokenList}
            balances={balances}
            fromToken={fromToken}
            toToken={toToken}
            amount={amount}
            amountIn={amountIn}
            slippageBps={slippageBps}
            quote={quote}
            quoting={quoting}
            quoteError={quoteError}
            account={account}
            chainId={chainId}
            hasProvider={hasProvider}
            busy={busy}
            tx={tx}
            onAmountChange={(value) => setAmount(fromToken ? sanitizeAmountInput(value, fromToken.decimals) : value)}
            onPickToken={(side) => setModal(side)}
            onFlip={handleFlip}
            onSlippage={setSlippageBps}
            onMax={handleMax}
            onSubmit={handleSubmit}
            onConnect={handleConnect}
            onSwitchNetwork={handleSwitchNetwork}
            onDismissTx={() => setTx({ phase: 'idle' })}
          />

          <MarketsPanel
            pools={pools}
            tokens={tokens}
            busy={poolsBusy}
            sourceLabel={sourceLabel}
            note={sourceNote}
            scanning={scanning}
            onSelectPool={handleSelectPool}
            onRefresh={handleRefresh}
            onScan={handleScan}
            onImportPool={handleImportPool}
          />
        </div>

        <section className="integrations">
          <h2>
            What is wired to the SDK
          </h2>
          <div className="integration-grid">
            {[
              {
                title: 'AmmoraSwapClient',
                body: 'prepareExactIn() quotes the exact input at the latest block, binds slippage, plans ERC-20 approvals and executes with receipt-block balance verification.',
              },
              {
                title: 'ALMMClient / DammV2Client',
                body: 'Live active bin, sqrt price, reserves and current fee for every pooled pair — the markets table is read from chain, not from a mock.',
              },
              {
                title: 'discoverAmmoraPools',
                body: 'New pools are found by scanning reviewed factory logs, so the list grows without a redeploy.',
              },
              {
                title: 'AmmoraDataApiClient',
                body: 'When the protocol index answers, it seeds the market list; when it does not, the app falls back to the bundled on-chain index.',
              },
            ].map((item) => (
              <article key={item.title} className="integration">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <LogoMark size={26} />
            <div>
              <strong>Powered by @ammora-protocol/sdk 0.3.9 on GIWA Sepolia</strong>
              <span className="footer-fine">
                Beta testnet software. No real funds. Pool index generated {new Date(DATASET_GENERATED_AT).toISOString().slice(0, 10)} ·{' '}
                {tokens.length} tokens tracked.
              </span>
            </div>
          </div>
          <div className="footer-links">
            <a href="https://www.npmjs.com/package/@ammora-protocol/sdk" target="_blank" rel="noreferrer">
              SDK on npm <ExternalIcon />
            </a>
            <a href="https://github.com/ammora-labs/ammora-protocol" target="_blank" rel="noreferrer">
              Protocol repo <ExternalIcon />
            </a>
            <a href={addressUrl(WETH)} target="_blank" rel="noreferrer">
              WETH on explorer <ExternalIcon />
            </a>
            <a href={DATA_API_URL} target="_blank" rel="noreferrer">
              Data API <ExternalIcon />
            </a>
          </div>
        </div>
        <p className="footer-disclaimer">
          <AlertIcon size={13} /> Ammora has not announced a mainnet deployment. This app only ever touches chain{' '}
          {CHAIN_ID}. Token symbols come from the contracts themselves.
        </p>
      </footer>

      {modal && (
        <TokenSelect
          title={modal === 'in' ? 'You pay' : 'You receive'}
          tokens={tokenList}
          balances={balances}
          selected={modal === 'in' ? fromToken : toToken}
          onSelect={(token) => {
            if (modal === 'in') {
              if (toToken && sameToken(token, toToken)) setToToken(fromToken)
              setFromToken(token)
            } else {
              if (fromToken && sameToken(token, fromToken)) setFromToken(toToken)
              setToToken(token)
            }
            setModal(null)
          }}
          onClose={() => setModal(null)}
          onImport={handleImportToken}
        />
      )}
    </div>
  )
}
