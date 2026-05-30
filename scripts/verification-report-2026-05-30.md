# Morpho Re7 USDC Mainnet-Fork Verification

## Environment

- Chain ID: 480
- Fork block number: 30389140
- Fork block timestamp: 1780113917 (2026-05-30T04:05:17.000Z)
- Test wallet: `0x78CfCaFBe712bb0205615bb26e6B1378C39a08Ca`
- Vault: `0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B`
- USDC: `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`

## Funding Checks

- native balance before funding: 0 ETH (read at block 30389140, timestamp 1780113917 / 2026-05-30T04:05:17.000Z)
- USDC balance before funding: 0 USDC (read at block 30389141, timestamp 1780113963 / 2026-05-30T04:06:03.000Z)
- USDC balance before deposit: 10 USDC (read at block 30389142, timestamp 1780113966 / 2026-05-30T04:06:06.000Z)
- Funding actions: Native gas balance topped up to 10 ETH via tenderly_setBalance; USDC balance topped up to 10 USDC via tenderly_setErc20Balance

## Vault Snapshot Before Deposit

- vault totalAssets before deposit: 8526210.144583 USDC (read at block 30389142, timestamp 1780113966 / 2026-05-30T04:06:06.000Z)

## Transactions

| Step | Tx hash | Status | Gas used | On-chain timestamp | Tenderly link |
| --- | --- | --- | ---: | --- | --- |
| Approve | `0x95ca467ca24b5025506ea1271e25909d2ef70e83897156f6ed072587a2fe54ec` | success | 55437 | 1780113973 (2026-05-30T04:06:13.000Z) | [Open](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x95ca467ca24b5025506ea1271e25909d2ef70e83897156f6ed072587a2fe54ec) |
| Deposit | `0x16cf2bfaaaca600a400baa586302be1a544f7ae53f5dc9523c158d5e54f14133` | success | 296944 | 1780113977 (2026-05-30T04:06:17.000Z) | [Open](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0x16cf2bfaaaca600a400baa586302be1a544f7ae53f5dc9523c158d5e54f14133) |
| Redeem | `0xbd2d0cc3582d5fd63ab5ee1c6ca272a8967b2cc111ae060af407e07273652161` | success | 266113 | 1780114046 (2026-05-30T04:07:26.000Z) | [Open](https://dashboard.tenderly.co/samuelli/project/testnet/32cc8c84-7746-4522-9660-216f528abfa9/tx/0xbd2d0cc3582d5fd63ab5ee1c6ca272a8967b2cc111ae060af407e07273652161) |

## Position Snapshots

- USDC balance after deposit: 9 USDC (read at block 30389144, timestamp 1780113977 / 2026-05-30T04:06:17.000Z)
- vault shares after deposit: 974767857723017145 (read at block 30389144, timestamp 1780113977 / 2026-05-30T04:06:17.000Z)
- assets represented by shares after deposit: 0.999999 USDC (read at block 30389144, timestamp 1780113977 / 2026-05-30T04:06:17.000Z)
- assets represented by shares after 60s: 0.999999 USDC (read at block 30389144, timestamp 1780113977 / 2026-05-30T04:06:17.000Z) (no growth observed on fork after 60 seconds; allowed)

## Final Balance Reconciliation

- USDC balance after redeem: 10 USDC (read at block 30389145, timestamp 1780114046 / 2026-05-30T04:07:26.000Z)
- vault shares after redeem: 0 (read at block 30389145, timestamp 1780114046 / 2026-05-30T04:07:26.000Z)
- Expected final vault shares: 0
- Expected final USDC balance: close to 10 USDC with tolerance 0.00001 USDC

Verified on: Tenderly Virtual TestNet (fork from World Chain mainnet block 30389140).
