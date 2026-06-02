# Swap Phase 2 Verification Report

Date: 2026-06-01

## Scope

- Implemented Universal Router calldata construction for Uniswap V3 exact-input swaps.
- Implemented Permit2 `AllowanceTransfer` typed-data signing through MiniKit `signTypedData`.
- Implemented MiniKit `sendTransaction` submission with `{ to, data, value }` transaction objects and `result.data.userOpHash` handling.
- Kept mainnet execution behind `NEXT_PUBLIC_SWAP_ENABLED=false` and `NEXT_PUBLIC_SWAP_MAX_USD=5`.

## Contract Addresses

- World Chain chainId: `480`
- Universal Router 2.0: `0x8ac7bee993bb44dab564ea4bc9ea67bf9eb5e743`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- V3 QuoterV2: `0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c`
- V3 Factory: `0x7a5028BDa40e7B173C278C5342087826455ea25a`

## Local Verification

| Check | Result |
| --- | --- |
| `npm install @uniswap/universal-router-sdk @uniswap/v3-sdk @uniswap/sdk-core` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed, no warnings/errors |
| `npm run build` | Passed |

## Safety Gates

| Gate | Status |
| --- | --- |
| Swap execution default off | Implemented: `NEXT_PUBLIC_SWAP_ENABLED=false` examples and code fallback |
| Single swap limit | Implemented: `NEXT_PUBLIC_SWAP_MAX_USD=5` examples and code fallback |
| Slippage cannot be 0 | Implemented |
| Quote older than 30s | Implemented, forces refresh |
| Balance insufficient | Implemented in UI before submit |
| Price impact > 5% | Implemented, requires explicit high-impact acknowledgement |
| Price impact > 15% | Implemented, blocks execution |
| Fresh quote before signing | Implemented in `executeSwap` |
| Deadline 20-30 minutes | Implemented: 30 minutes |
| Recipient fixed to user address | Implemented |
| UserOp receipt polling | Implemented via existing `useWaitForUserOperationReceipt` status component |

## Tenderly Virtual TestNet

Status: not completed in this run.

Reason: the request references “6 个用例 (见下面)”, but no concrete six Tenderly cases were included after the prompt. Code-level verification is complete and the production switch remains off. Before enabling `NEXT_PUBLIC_SWAP_ENABLED=true`, run the six Tenderly cases against the intended token pairs and paste their transaction hashes/results into this section.

Suggested six cases:

1. USDC -> WLD within the $5 limit.
2. WLD -> USDC within the $5 limit.
3. Insufficient balance blocks before MiniKit signing.
4. Slippage set to 0 blocks before MiniKit signing.
5. Quote older than 30 seconds forces refresh.
6. Price impact > 15% blocks execution.

## Mainnet Launch Gate

Do not enable `NEXT_PUBLIC_SWAP_ENABLED=true` until Tenderly cases are completed and reviewed.
