/**
 * Odysseus scout — dedicated scheduled agent, own build, derived, minimal.
 * Runs on GitHub Actions cron every 30 min. Dependency-free Node 20+ fetch only.
 * Each run checks every source, no human needed:
 *  1. wallets — Base USDC + Solana USDC + native SOL receive-only (real earnings)
 *  2. Superteam agent listings via API key (AGENT_ONLY first)
 *  3. GitHub bounty discovery — open issues labeled bounty, fresh $ hints (candidates only)
 * Writes status.md + history.jsonl + seen files. Fails loudly (email) ONLY on:
 * payment landed, or fresh AGENT_ONLY listing. Everything else is status.
 * No private keys ever. Reads only. No new accounts.
 */
import { writeFileSync, appendFileSync, readFileSync, unlinkSync } from 'node:fs'

const EVM_WALLET = '0x183b0526dc7fd5084b8ca05fec4f358859e7a4ff'
const SOL_WALLET = 'VPj3sAvaqCFVPQmMdCYhV2t48DTm538wjqGkHmahw94'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const now = new Date().toISOString()

async function baseUsdc() {
  try {
    const r = await fetch('https://mainnet.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: BASE_USDC, data: '0x70a08231000000000000000000000000' + EVM_WALLET.slice(2) }, 'latest'],
      }),
    })
    const j = await r.json()
    return Number(BigInt(j.result || '0x0')) / 1e6
  } catch (e) { return `err:${e.message}` }
}

async function solUsdc() {
  try {
    const r = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [SOL_WALLET, { mint: SOL_USDC_MINT }, { encoding: 'jsonParsed' }],
      }),
    })
    const j = await r.json()
    return (j?.result?.value ?? []).reduce((s, a) => s + (Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0), 0)
  } catch (e) { return `err:${e.message}` }
}

async function solNative() {
  try {
    const r = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [SOL_WALLET] }),
    })
    const j = await r.json()
    return (j?.result?.value ?? 0) / 1e9
  } catch (e) { return `err:${e.message}` }
}

async function superteamLive() {
  const key = process.env.SUPERTEAM_API_KEY
  if (!key) return { skipped: 'no SUPERTEAM_API_KEY secret' }
  try {
    const r = await fetch('https://superteam.fun/api/agents/listings/live?take=50', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    const items = Array.isArray(d) ? d : d.result || []
    const open = items.filter((l) => (l.deadline || '9999') > now)
      .map((l) => ({ slug: l.slug, type: l.type, reward: l.rewardAmount, token: l.token, access: l.agentAccess, deadline: (l.deadline || '').slice(0, 10) }))
      .sort((a, b) => (b.access === 'AGENT_ONLY' ? 1 : 0) - (a.access === 'AGENT_ONLY' ? 1 : 0) || (b.reward || 0) - (a.reward || 0))
    return { total: items.length, open }
  } catch (e) { return { error: e.message } }
}

// Wide discovery — $ bounties WITHOUT the label (21,985 hits; the labeled
// scan never sees them). Same public API, capped hard, candidates only.
async function githubBountiesWide() {
  try {
    const q = encodeURIComponent('bounty $ in:title state:open')
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'odysseus-scout' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const r = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=12`, { headers, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    const items = (d.items || []).map((p) => {
      const m = (p.title || '').match(/\$\s?[\d,]+(\.\d+)?/)
      return {
        id: `${(p.repository_url || '').split('/').slice(-2).join('/')}#${p.number}`,
        repo: (p.repository_url || '').split('/').slice(-2).join('/'),
        num: p.number,
        title: (p.title || '').slice(0, 80),
        hint: m ? m[0] : null,
        url: p.html_url,
        updated: (p.updated_at || '').slice(0, 10),
        src: 'wide',
      }
    })
    return { total: d.total_count ?? items.length, items }
  } catch (e) { return { error: e.message } }
}
// Candidates ONLY: payment evidence still checked by hand before any work (rule #1).
// Read-only, public search API. GITHUB_TOKEN (Actions default) raises the rate limit.
async function githubBounties() {
  try {
    const q = encodeURIComponent('label:bounty state:open')
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'odysseus-scout' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const r = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=20`, { headers, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    const items = (d.items || []).map((p) => {
      const m = (p.title || '').match(/\$\s?[\d,]+(\.\d+)?/)
      return {
        id: `${(p.repository_url || '').split('/').slice(-2).join('/')}#${p.number}`,
        repo: (p.repository_url || '').split('/').slice(-2).join('/'),
        num: p.number,
        title: (p.title || '').slice(0, 80),
        hint: m ? m[0] : null,
        url: p.html_url,
        updated: (p.updated_at || '').slice(0, 10),
      }
    })
    return { total: d.total_count ?? items.length, items }
  } catch (e) { return { error: e.message } }
}

const usdc = await baseUsdc()
const solUsdcBal = await solUsdc()
const solNativeBal = await solNative()
const superteam = await superteamLive()
const bounties = await githubBounties()
const bountiesWide = await githubBountiesWide()

let prevUsdc = null, prevSol = null, prevSolNative = null
try {
  const lines = readFileSync(new URL('./history.jsonl', import.meta.url), 'utf8').trim().split('\n')
  if (lines.length && lines[0]) {
    const p = JSON.parse(lines[lines.length - 1])
    if (typeof p.baseUsdc === 'number') prevUsdc = p.baseUsdc
    if (typeof p.solUsdc === 'number') prevSol = p.solUsdc
    if (typeof p.solNative === 'number') prevSolNative = p.solNative
  }
} catch {}
const delta = (typeof usdc === 'number' && typeof prevUsdc === 'number') ? usdc - prevUsdc : 0
const solDelta = (typeof solUsdcBal === 'number' && typeof prevSol === 'number') ? solUsdcBal - prevSol : 0
const solNativeDelta = (typeof solNativeBal === 'number' && typeof prevSolNative === 'number') ? solNativeBal - prevSolNative : 0
let seen = []
try { seen = JSON.parse(readFileSync(new URL('./seen-listings.json', import.meta.url), 'utf8')) } catch {}
const openSlugs = (superteam.open || []).map((o) => o.slug)
const fresh = openSlugs.filter((s) => !seen.includes(s))
const freshDetail = (superteam.open || []).filter((o) => fresh.includes(o.slug))
const freshAgentOnly = freshDetail.filter((o) => o.access === 'AGENT_ONLY')
writeFileSync(new URL('./seen-listings.json', import.meta.url), JSON.stringify([...new Set([...seen, ...openSlugs])], null, 0))

// Bounty candidates seen-tracking (separate file — issue IDs, not listing slugs)
// Label + wide queries merged, deduped, labeled items first.
let seenB = []
try { seenB = JSON.parse(readFileSync(new URL('./seen-bounties.json', import.meta.url), 'utf8')) } catch {}
const labelItems = (bounties.items || []).map((b) => ({ src: 'label', ...b }))
const wideItems = (bountiesWide.items || []).map((b) => ({ src: 'wide', ...b }))
const haveIds = new Set(labelItems.map((b) => b.id))
const bountyItems = [...labelItems, ...wideItems.filter((b) => !haveIds.has(b.id))]
const freshBounties = bountyItems.filter((b) => !seenB.includes(b.id))
writeFileSync(new URL('./seen-bounties.json', import.meta.url), JSON.stringify([...new Set([...seenB, ...bountyItems.map((b) => b.id)])].slice(-200), null, 0))

// Email ONLY on money or fresh AGENT_ONLY (lowest competition, highest odds).
// Fresh normal listings + bounty candidates are status lines — no email, no spam.
const notify = delta > 0 || solDelta > 0 || solNativeDelta > 0 || freshAgentOnly.length > 0

const snapshot = { ts: now, baseUsdc: usdc, solUsdc: solUsdcBal, solNative: solNativeBal, delta, solDelta, solNativeDelta, superteam, newListings: fresh, agentOnlyFresh: freshAgentOnly.map((o) => o.slug), bounties: { total: bounties.total ?? null, wideTotal: bountiesWide.total ?? null, shown: bountyItems.length, fresh: freshBounties.length, error: bounties.error ?? bountiesWide.error ?? null } }
appendFileSync(new URL('./history.jsonl', import.meta.url), JSON.stringify(snapshot) + '\n')

const md = `# Odysseus earning status

_Last run: ${now} (UTC), on GitHub Actions._

## Wallet — real earnings land here
- **Base USDC** \`${EVM_WALLET}\`: **${usdc}**${delta > 0 ? ` · +${delta.toFixed(6)} received!` : ''}
- **Solana USDC** \`${SOL_WALLET}\`: **${solUsdcBal}**${solDelta > 0 ? ` · +${solDelta.toFixed(6)} received!` : ''}
- **Solana native SOL**: **${solNativeBal}**${solNativeDelta > 0 ? ` · +${solNativeDelta.toFixed(9)} SOL received!` : ''}

## Open agent listings (Superteam) — AGENT_ONLY first
${superteam.skipped ? `_scan skipped: ${superteam.skipped}_`
  : superteam.error ? `_scan error: ${superteam.error}_`
  : (superteam.open?.length
      ? superteam.open.map((o) => `- ${o.access === 'AGENT_ONLY' ? 'AGENT_ONLY' : 'open'} · \`${o.slug}\` — ${o.type} · ${o.reward} ${o.token || ''} · deadline ${o.deadline}`).join('\n')
      : '_none open right now_')}

${fresh.length ? `## New since last run\n${freshDetail.map((o) => `- ${o.access === 'AGENT_ONLY' ? 'AGENT_ONLY' : 'open'} · \`${o.slug}\` — ${o.reward} ${o.token || ''} · deadline ${o.deadline}`).join('\n')}` : ''}

## Bounty candidates (GitHub label:bounty — verify payment evidence before any work)
${bounties.error ? `_discovery error: ${bounties.error}_`
  : bountyItems.length
    ? bountyItems.slice(0, 10).map((b) => `- ${freshBounties.some((f) => f.id === b.id) ? 'NEW ' : ''}\`${b.id}\` — ${b.title}${b.hint ? ` · ${b.hint}` : ''} · updated ${b.updated}`).join('\n') + `\n_candidates only — a $ hint in a title is not proof of payout. Merged + paid history required._`
    : '_none found this run_'}

---
_Rewritten by Odysseus scout every run. History in history.jsonl. Merged is not paid — only wallet lines count._
`
writeFileSync(new URL('./status.md', import.meta.url), md)

const NOTIFY = new URL('./NOTIFY.txt', import.meta.url)
if (notify) {
  const msg = (delta > 0 || solDelta > 0 || solNativeDelta > 0)
    ? `PAYMENT RECEIVED (${now}) — ${delta > 0 ? `+${delta.toFixed(6)} USDC Base (total ${usdc})` : ''}${solDelta > 0 ? ` +${solDelta.toFixed(6)} USDC Solana (total ${solUsdcBal})` : ''}${solNativeDelta > 0 ? ` +${solNativeDelta.toFixed(9)} SOL (total ${solNativeBal})` : ''}`
    : `AGENT_ONLY LISTING (${now}) — ${freshAgentOnly.map((o) => `${o.slug} (${o.reward} ${o.token || ''}, deadline ${o.deadline})`).join(' | ')} — low competition, check now`
  writeFileSync(NOTIFY, msg + '\n')
} else {
  try { unlinkSync(NOTIFY) } catch {}
}

console.log('status:', JSON.stringify(snapshot))
if (delta > 0) console.log(`::notice title=PAYMENT RECEIVED::+${delta.toFixed(6)} USDC Base — total ${usdc}`)
if (solDelta > 0) console.log(`::notice title=PAYMENT RECEIVED::+${solDelta.toFixed(6)} USDC Solana — total ${solUsdcBal}`)
if (solNativeDelta > 0) console.log(`::notice title=PAYMENT RECEIVED::+${solNativeDelta.toFixed(9)} SOL — total ${solNativeBal}`)
if (freshDetail.length) console.log('::notice title=NEW LISTINGS::' + freshDetail.map((o) => `${o.slug} (${o.access}, ${o.reward} ${o.token})`).join(' | '))
if (freshAgentOnly.length) console.log('::warning title=AGENT_ONLY FRESH::' + freshAgentOnly.map((o) => `${o.slug} (${o.reward} ${o.token})`).join(' | '))
if (freshBounties.length) console.log('::notice title=NEW BOUNTY CANDIDATES::' + freshBounties.slice(0, 5).map((b) => b.id).join(' | '))
