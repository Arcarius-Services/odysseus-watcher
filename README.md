# Odysseus Watcher

Own build for Taavi Northern legion. Minimal 24/7 monitor, derived — not a fork.

Every 30 min on GitHub Actions:
- reads Base USDC + Solana USDC + native SOL for receive-only wallets
- scans Superteam agent listings if `SUPERTEAM_API_KEY` secret set
- rewrites `status.md`, appends `history.jsonl`

Holds zero secrets. Reads only. Only wallet lines count as money.

Wallets:
- EVM `0x183b0526dc7fd5084b8ca05fec4f358859e7a4ff`
- SOL `VPj3sAvaqCFVPQmMdCYhV2t48DTm538wjqGkHmahw94`
