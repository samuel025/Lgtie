# LGtie bridge (optional, self-hosted)

LGtie itself runs no server. This is a small script **you** can run if you want your support team to stop checking an inbox and stop touching a wallet. It is not part of the protocol and nothing depends on it: without it, everything still works through the `#inbox` page.

## What it does

1. **Listens** on public Nostr relays for the signed passkey actions customers address to your wallet (the same messages `#inbox` shows).
2. **Notifies** your webhook (Slack, Discord, Zapier, Make, or any URL that takes JSON) when one arrives.
3. **Submits for you** (optional). If you give it a relayer key, it simulates each action and submits it, so nobody opens `#inbox` or pays gas by hand. It pays only the small network fee from that key.
4. **Pings reviewers** (optional). It reads the chain and, when a case is waiting for a neutral reviewer you listed, sends that reviewer a webhook message with a link that opens the decision form.

## Run it

```
cd bridge
npm install
cp .env.example .env      # fill in LISTEN_ADDRESS and, optionally, the rest
set -a; . ./.env; set +a
node lgtie-bridge.mjs
```

Needs Node 22 or newer. It keeps a small `bridge-state.json` so a restart does not repeat notices or submissions. Set `HEALTH_PORT` to expose a local status check.

## What it will and will not do

- It only sends to the three LGtie passkey contracts on the configured chain, and simulates every action first, so an invalid, expired or already used action costs nothing.
- It submits at most `DAILY_CAP` actions per UTC day (default 25), so a flood of valid actions cannot drain the key quickly.
- Signed actions from one customer must go in order; the bridge holds a later one until the earlier one is on-chain, and drops anything older than 26 hours (its signature deadline is 24 hours).
- **The relayer key can only spend gas.** It holds no user funds and cannot change what a customer signed. Use a fresh key with a few cents of OKB, keep it out of git, and treat a leaked key as lost gas money, not lost customer funds.
- It does **not** answer questions for your business. Your own answers still need your wallet (or a helper wallet you named). It does not store customer data beyond hashes of the messages it has seen.
- Public relays are run by other people and can drop messages. The `#inbox` page and the copy-link fallback remain the safety net.
- **Tested** end to end on a fork of X Layer with a local relay and a local webhook receiver (`tests/browser/bridge.mjs`): notify-only mode, auto-submit, actions kept in order across a restart, reviewer pings, garbage ignored, daily cap. **Not tested** against a real Slack, Discord or Zapier endpoint, or with a key funded on mainnet.
- It is a Node script. A Cloudflare Worker version is possible (the free plan allows 100,000 requests a day and a one-minute cron), but its 10 ms CPU limit may be too tight for signing, and it has not been built or tested.

## Settings

See `.env.example`. `WEBHOOK_FORMAT` is `json` (default; fields `event`, `text`, `at`, and extras such as `url` and `tx`), `slack` (`{"text": …}`) or `discord` (`{"content": …}`).
