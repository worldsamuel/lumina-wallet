# Lumina Swap Phase 2 - Tenderly Verification Report

**Date**: 2026-06-03T07:20:14.411Z
**Network**: World Chain Virtual TestNet (chainId 480)
**RPC**: https://virtual.worldchain-mainnet.eu.rpc.tenderly.co/f950d3bb-...
**Test wallet**: `0x78CfCaFBe712bb0205615bb26e6B1378C39a08Ca`
**Total cases**: 6
**Passed**: 0
**Warn**: 0
**Failed**: 6

## Summary

- ❌ **1_WLD_to_USDC_small**: ERROR
- ❌ **2_USDC_to_WLD_reverse**: ERROR
- ❌ **3_ORB_to_USDC_community**: ERROR
- ❌ **4_dust_amount**: ERROR
- ❌ **5_slippage_protection**: ERROR
- ❌ **6_deadline_expired**: ERROR

## Gas Statistics

- Successful/reverted swap transactions measured: 0
- Total gas used: 0
- Average gas used: 0
- Max gas used: 0
- Min gas used: 0

## Detailed Results

### 1_WLD_to_USDC_small

- **Description**: 正常 1 WLD -> USDC 应该成功
- **From**: 1 WLD -> USDC
- **Expected**: success
- **Slippage**: 0.5%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`



### 2_USDC_to_WLD_reverse

- **Description**: 反向 1 USDC -> WLD 应该成功
- **From**: 1 USDC -> WLD
- **Expected**: success
- **Slippage**: 0.5%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`



### 3_ORB_to_USDC_community

- **Description**: 1000 ORB -> USDC, 验证非核心 token 不再触发 invalid_contract 且 output fee 到金库
- **From**: 1000 ORB -> USDC
- **Expected**: success
- **Slippage**: 0.5%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`



### 4_dust_amount

- **Description**: 极小额测试, 验证不会有 rounding 问题
- **From**: 0.01 USDC -> WLD
- **Expected**: success
- **Slippage**: 0.5%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`



### 5_slippage_protection

- **Description**: 1 USDC -> WLD 正常报价后人为抬高 minOut 10%, 必须触发滑点保护
- **From**: 1 USDC -> WLD
- **Expected**: revert (V3TooLittleReceived | TooLittleReceived)
- **Slippage**: 0.1%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`



### 6_deadline_expired

- **Description**: deadline 已过期, Universal Router 必须 revert
- **From**: 1 USDC -> WLD
- **Expected**: revert (TransactionDeadlinePassed | DeadlineExpired)
- **Slippage**: 0.5%
- **Result**: **ERROR**








- **Error**: `Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.`




## Verdict

❌ **6 FAIL/ERROR, 0 WARN** - DO NOT enable mainnet. Fix or review issues first.

## Notes

- The configured `TEST_PRIVATE_KEY` derives to `0x78CfCaFBe712bb0205615bb26e6B1378C39a08Ca`; tests use Permit2 allowance transfers instead of typed-data signatures.
- The prompt-listed fixed wallet `0x0f3b31df2fa6781de2103588da675f02599b2b26` was not used because the local test private key does not control it.
- Case 5 intentionally raised `expectedAmountOut` by 10% before building calldata, creating a deterministic stale/over-optimistic minOut condition that validates the Universal Router slippage guard.
- `NEXT_PUBLIC_SWAP_ENABLED` remains false in the example/test environment.
