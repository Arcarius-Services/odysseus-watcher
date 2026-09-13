# Odysseus Scout

Dedicated scheduled agent for Taavi Northern legion. Own build, derived — not a fork.

Every 30 min on GitHub Actions, no human needed, it checks every source:
- wallets — Base USDC + Solana USDC + native SOL receive-only (real earnings)
- Superteam agent listings if `SUPERTEAM_API_KEY` secret set (AGENT_ONLY first)
- GitHub bounty discovery — open issues labeled bounty (candidates only, payment evidence still verified by hand before any work)

Rewrites `status.md`, appends `history.jsonl`. Emails Taavi ONLY on payment landed or fresh AGENT_ONLY listing. Everything else is status lines.

Holds zero secrets. Reads only. Only wallet lines count as money.

Wallets:
- EVM `0x183b0526dc7fd5084b8ca05fec4f358859e7a4ff`
- SOL `VPj3sAvaqCFVPQmMdCYhV2t48DTm538wjqGkHmahw94`
