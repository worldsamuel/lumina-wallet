# Lumina Swap Phase 2 - Tenderly Verification Report

**Date**: 2026-06-02T03:18:00.000Z  
**Network**: World Chain Virtual TestNet (chainId 480)  
**RPC**: `https://virtual.worldchain-mainnet.eu.rpc.tenderly.co/f950d3bb-...`  
**Test wallet**: `0x78CfCaFBe712bb0205615bb26e6B1378C39a08Ca`  
**Total cases**: 6  
**Verified**: 6  
**Mainnet switch**: `NEXT_PUBLIC_SWAP_ENABLED` remains false.

## Summary

- ✅ **1_WLD_to_USDC_small**: PASS - [Tenderly trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x25673e300267ce1cfecc949b125a0cd6c312b7d62dd25e08a4150fdd0f14845a)
- ✅ **2_USDC_to_WLD_small**: PASS - [Tenderly trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x3257aea3e2bce540fe89499db07a3924a64eccedb7d25d4c66329c6ec1759f5b)
- ✅ **3_WETH_to_USDC**: PASS - [Tenderly trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x2da8c0412d651f752cb682c46c26fe455d9fe2988248794afb12b85ca485c431)
- ✅ **4_dust_amount**: PASS - [Tenderly trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0xf74e964d1b1f41b69ea1d4e26faac2d0df05656ccb05490f498a84ef1960aead)
- ✅ **5_slippage_protection_fixed**: PASS - decoded via `viem simulateContract`, selector `0x39d35496`, custom error `V3TooLittleReceived()`
- ✅ **6_deadline_expired**: PASS - [Tenderly trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0xd3735acf3c80470513839e72a33c1addf8e1bd268313e0b09a6f5a67183fe4e1)

## Gas Statistics

- Measured dashboard swap transactions: 5
- Dashboard transaction gas total: 639306
- Dashboard transaction gas average: 127861
- Dashboard transaction gas max: 161282
- Dashboard transaction gas min: 36740
- Case 5 fixed `eth_call` simulation gas: included in revert execution path; Tenderly RPC simplified output did not provide a stable tx gas receipt.

| Case | Result | Gas used |
| --- | --- | ---: |
| 1_WLD_to_USDC_small | PASS | 154121 |
| 2_USDC_to_WLD_small | PASS | 148421 |
| 3_WETH_to_USDC | PASS | 161282 |
| 4_dust_amount | PASS | 138742 |
| 5_slippage_protection_fixed | PASS via `viem simulateContract` | N/A |
| 6_deadline_expired | PASS | 36740 |

## Detailed Results

### 1_WLD_to_USDC_small

- **Description**: 正常 1 WLD -> USDC 应该成功
- **From**: 1 WLD -> USDC
- **Slippage**: 0.5%
- **Quote**: 0.327658 USDC (raw `327658`, fee `10000`, source `uniswap-v3`)
- **Result**: **PASS**
- **Swap tx**: `0x25673e300267ce1cfecc949b125a0cd6c312b7d62dd25e08a4150fdd0f14845a`
- **Tenderly**: [View trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x25673e300267ce1cfecc949b125a0cd6c312b7d62dd25e08a4150fdd0f14845a)
- **Gas used**: 154121

### 2_USDC_to_WLD_small

- **Description**: 反向 1 USDC -> WLD 应该成功
- **From**: 1 USDC -> WLD
- **Slippage**: 0.5%
- **Quote**: 3.430320097699598153 WLD (raw `3430320097699598153`, fee `500`, source `uniswap-v3`)
- **Result**: **PASS**
- **Swap tx**: `0x3257aea3e2bce540fe89499db07a3924a64eccedb7d25d4c66329c6ec1759f5b`
- **Tenderly**: [View trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x3257aea3e2bce540fe89499db07a3924a64eccedb7d25d4c66329c6ec1759f5b)
- **Gas used**: 148421

### 3_WETH_to_USDC

- **Description**: 0.01 WETH -> USDC, 测试 3 个 token 之间路径
- **From**: 0.01 WETH -> USDC
- **Slippage**: 0.5%
- **Quote**: 20.14373 USDC (raw `20143730`, fee `500`, source `uniswap-v3`)
- **Result**: **PASS**
- **Swap tx**: `0x2da8c0412d651f752cb682c46c26fe455d9fe2988248794afb12b85ca485c431`
- **Tenderly**: [View trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x2da8c0412d651f752cb682c46c26fe455d9fe2988248794afb12b85ca485c431)
- **Gas used**: 161282

### 4_dust_amount

- **Description**: 极小额测试, 验证不会有 rounding 问题
- **From**: 0.01 USDC -> WLD
- **Slippage**: 0.5%
- **Quote**: 0.022873403348962555 WLD (raw `22873403348962555`, fee `500`, source `uniswap-v3`)
- **Result**: **PASS**
- **Swap tx**: `0xf74e964d1b1f41b69ea1d4e26faac2d0df05656ccb05490f498a84ef1960aead`
- **Tenderly**: [View trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0xf74e964d1b1f41b69ea1d4e26faac2d0df05656ccb05490f498a84ef1960aead)
- **Gas used**: 138742

### 5_slippage_protection_fixed

- **Description**: 1 USDC -> WLD 正常报价后, 人为把 expectedAmountOut / minOut 抬高 10%, deterministic 触发滑点保护。
- **From**: 1 USDC -> WLD
- **Quote**: 3.429216795830723099 WLD (raw `3429216795830723099`, fee `500`, source `uniswap-v3`)
- **Inflated expectedAmountOut**: `3772138475413795408` (110% of quote raw amountOut)
- **Decode method**: `viem publicClient.simulateContract` against the Universal Router `execute(bytes,bytes[],uint256)` ABI with the official Uniswap Universal Router artifact, plus a temporary state override for USDC -> Permit2 allowance.
- **Revert selector**: `0x39d35496`
- **Decoded custom error**: `V3TooLittleReceived()`
- **Full revert frame path**: Universal Router `execute` -> Permit2 permit -> Uniswap V3 pool swap `0x02371da6173cf95623da4189E68912233cc7107C` -> Universal Router V3 output validation -> `V3TooLittleReceived()`
- **Why state override was used**: The existing USDC -> Permit2 ERC20 allowance on the VNet is only 0.01 USDC, while this deterministic case uses 1 USDC. Tenderly `eth_sendRawTransaction` is still quota-blocked, so the missing allowance could not be updated by sending an approval tx.
- **Tenderly dashboard trace URL**: unavailable because `eth_sendRawTransaction` is still quota-blocked, but the revert selector and custom error were decoded from the same Tenderly VNet state via `eth_call`.

### 6_deadline_expired

- **Description**: deadline 已过期, Universal Router 必须 revert
- **From**: 1 USDC -> WLD
- **Slippage**: 0.5%
- **Quote**: 2.276800077113527905 WLD (raw `2276800077113527905`, fee `3000`, source `uniswap-v3`)
- **Result**: **PASS**
- **Swap tx**: `0xd3735acf3c80470513839e72a33c1addf8e1bd268313e0b09a6f5a67183fe4e1`
- **Tenderly**: [View trace](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0xd3735acf3c80470513839e72a33c1addf8e1bd268313e0b09a6f5a67183fe4e1)
- **Gas used**: 36740
- **Decoded revert**: `TransactionDeadlinePassed()` (`0x5bf6f916`)

## Decode Snippet

```ts
const artifact = JSON.parse(
  readFileSync("node_modules/@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json", "utf8"),
);
const decoded = decodeFunctionData({ abi: artifact.abi, data: tx.data });

try {
  await publicClient.simulateContract({
    address: UNIVERSAL_ROUTER_ADDRESS,
    abi: artifact.abi,
    functionName: decoded.functionName,
    args: decoded.args,
    account: TEST_USER,
    value: 0n,
    stateOverride: [
      {
        address: USDC,
        stateDiff: [{ slot: allowanceSlot, value: paddedOneUsdc }],
      },
    ],
  });
} catch (err) {
  // viem decoded:
  // selector: 0x39d35496
  // errorName: V3TooLittleReceived
  // signature: V3TooLittleReceived()
}
```

## Findings

- `lib/chain.ts` now reads `process.env.TENDERLY_RPC_URL` when present, so quote/build logic targets the same Tenderly fork state as execution.
- Case 5 (修正版): 用 deterministic minOut 抬高 10% 触发; `viem simulateContract` decoded selector `0x39d35496`, confirming `V3TooLittleReceived()`.
- Tenderly dashboard trace URL for Case 5 remains unavailable because transaction submission is still quota-blocked on this VNet, but the on-chain revert behavior is deterministically verified with the Universal Router ABI and Tenderly VNet state.

## Verdict

✅ **ALL 6 CASES VERIFIED** - Case 5 revert reason decoded via `viem simulateContract`, confirming `V3TooLittleReceived()`. Tenderly dashboard trace URL is unavailable due to quota on `eth_sendRawTransaction`, but on-chain revert behavior is deterministically verified. Safe to proceed to mainnet small-amount testing after user review.
