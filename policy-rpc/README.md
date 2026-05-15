# policy-rpc

Reference TypeScript server for policy-specific remote facts.

## Endpoints

- `GET /health`
- `GET /v1/methods`
- `POST /v1/rpc`
- `GET /debug/recent`

`oracle.usd_value` resolves a token USD price via a multi-source
`OracleAggregator` (Chainlink price feeds, Uniswap V3 30-min TWAP, and
CoinGecko) and computes a `UsdValuation` result with bigint-safe scaled
decimal math. The aggregator computes a median across surviving sources,
drops outliers more than 3% from the median, and flags single-source
results with `confidence: "low"`. Per-source detail is surfaced in the
additive `sourceBreakdown` field; the legacy `sources: string[]` listing
of included identifiers is preserved.

On-chain reads use viem's HTTP transport. Configure per-chain RPC URLs
with `RPC_URL_<chainId>` env vars (e.g. `RPC_URL_1=https://...`); the
defaults are `publicnode.com` public endpoints.

The reference server also exposes v1 mock methods for host-capability-shaped
facts while the backing services are still being designed:

- `clock.now`
- `approval.allowance`
- `approval.cover_inputs`
- `portfolio.balance`
- `portfolio.input_fraction_bps`
- `oracle.effective_rate_bps`
- `stat_window.snapshot`
- `stat_window.swap_stats`

`policy-schema/extensions/DEX/swap.policy-rpc.json` shows how the legacy swap
enrichment fields can be requested and projected through policy-rpc manifests.

## Development

```bash
../extension/node_modules/.bin/vitest run
```

The implementation uses Node built-ins, the global `fetch`, and `viem`
for on-chain calls.

## Docker

Build and run the RPC server from the repository root:

```bash
docker build -f policy-rpc/Dockerfile -t scopeball-policy-rpc .
docker run --rm -p 8787:8787 scopeball-policy-rpc
```

Or use the compose service:

```bash
docker compose --profile policy-rpc up policy-rpc --build
```

The image listens on `0.0.0.0:8787` by default. Override `PORT` if the server
should bind to a different container port.

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/v1/methods
curl -sS http://127.0.0.1:8787/v1/rpc \
  -H 'content-type: application/json' \
  -d '{
    "request_id": "manual-test-1",
    "calls": [
      {
        "id": "call-1",
        "method": "oracle.usd_value",
        "params": {
          "chain_id": 1,
          "asset": {
            "kind": "erc20",
            "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "symbol": "WETH",
            "decimals": 18
          },
          "amount": "1000000000000000000"
        }
      }
    ]
  }'
```

`oracle.usd_value` also accepts the older flat `{ chain_id, address, amount,
decimals }` shape. The asset-object shape is what default swap policy manifests
emit.
