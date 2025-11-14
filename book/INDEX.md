# TRON Network Resources - Complete Index

## A
- **AccountCapsule** → Chapter 1 (Section 1.3.1), Chapter 3 (Source code)
- **AccountStore** → Chapter 3, Chapter 11
- **Adaptive Energy Scaling** → Chapter 2 (Section 2.5), Chapter 8
- **API Integration** → Chapter 12
- **averageWindowSize** → Chapter 2 (Section 2.2.1)

## B
- **Bandwidth** → Chapter 1 (Section 1.2.1), Chapter 5
  - Allocation Formula → Chapter 2 (Section 2.3.2)
  - BandwidthProcessor → Chapter 5 (Source code)
  - Free Bandwidth → Chapter 1 (5,000 bytes/day)
  - Priority Order → Chapter 5 (Section 5.1)
- **Block Interval** → Chapter 2 (3,000 ms)
- **BLOCK_PRODUCED_INTERVAL** → Chapter 2 (Section 2.2)

## C
- **CancelAllUnfreezeV2Contract** → Chapter 3 (Section 3.5)
- **ChainConstant** → Chapter 2 (Section 2.2)
- **Committee Parameters** → Chapter 7
- **Computational Complexity** → Chapter 2 (Section 2.9)
- **CONTRACT_RATE_DENOMINATOR** → Chapter 2 (100)
- **CONTRACT_RATE_NUMERATOR** → Chapter 2 (99)

## D
- **Database Schema** → Chapter 11
- **Decay Function** → Chapter 2 (Section 2.4.2)
- **DelegateResourceContract** → Chapter 4
  - Protobuf Structure → Chapter 4 (Section 4.1)
  - Lock Periods → Chapter 4 (Section 4.2)
  - Proportional Consumption → Chapter 4 (Section 4.3)
- **DelegatedResourceCapsule** → Chapter 4
- **DelegatedResourceStore** → Chapter 4, Chapter 11
- **divideCeil Function** → Chapter 2 (Section 2.4.3)
- **Dynamic Energy Factor** → Chapter 8 (Section 8.3)
- **DynamicPropertiesStore** → Chapter 1 (Section 1.6), Chapter 7

## E
- **Energy** → Chapter 1 (Section 1.2.2), Chapter 5
  - Allocation Formula → Chapter 2 (Section 2.3.3)
  - Consumption → Chapter 5 (Section 5.2)
  - EnergyCost.java → Chapter 1 (Source code)
  - EnergyProcessor → Chapter 2 (Source code)
- **ENERGY ResourceCode** → Chapter 1 (0x01)
- **EnergyCost Constants** → Chapter 1 (Section 1.2.2)
  - CALL_ENERGY → 40
  - CREATE → 32,000
  - DELEGATE_RESOURCE → 10,000
  - FREEZE_V2 → 10,000
  - SLOAD → 50
  - SSTORE_SET → 20,000
  - UN_DELEGATE_RESOURCE → 10,000
  - UNFREEZE_V2 → 10,000
  - VOTE_WITNESS → 30,000
- **Ethereum Comparison** → Chapter 1 (Section 1.4)
- **EXPAND_RATE_DENOMINATOR** → Chapter 2 (999)
- **EXPAND_RATE_NUMERATOR** → Chapter 2 (1,000)

## F
- **Fee Calculation** → Chapter 2 (Section 2.8), Chapter 5
- **FreezeBalanceV2Actuator** → Chapter 3 (Section 3.1)
- **FreezeBalanceV2Contract** → Chapter 3
  - Protobuf → Chapter 3 (balance_contract.proto)
  - Validation → Chapter 3 (Section 3.2)
- **FREE_NET_LIMIT** → Chapter 1 (5,000 bytes)
- **Formulas**
  - Bandwidth Limit → `(frozen_trx / 1,000,000) × (total_limit / total_weight)`
  - Energy Limit → `(frozen_trx / 1,000,000) × (total_energy_limit / total_weight)`
  - Linear Recovery → `usage × (1 - Δt / window_size)`
  - Proportional Delegation → `(receiver_usage × delegated) / total_resources`

## G
- **Governance** → Chapter 7
- **Global Network Limits** → Chapter 1 (Section 1.6.1)

## H
- **Historical Evolution** → Chapter 1 (Section 1.5)

## I
- **Implementation Strategies** → Chapter 9, Chapter 10
- **Index (Database)** → Chapter 11

## J
- **java-tron Source Code**
  - Location: github.com/tronprotocol/java-tron
  - Commit: 1e35f79a1

## K
- **Key Constants** → Chapter 2 (Section 2.2)

## L
- **Linear Recovery** → Chapter 2 (Section 2.4), Chapter 6
- **Lock Periods** → Chapter 4 (1-3 months default)

## M
- **Mathematical Models** → Chapter 2
- **MEM_LIMIT** → Chapter 1 (3 MB)
- **Monitoring Architecture** → Chapter 9
- **MortgageService** → Chapter 3

## N
- **Network Parameters** → Chapter 7
  - totalNetLimit → 43,200,000,000 bytes/day
  - totalEnergyLimit → 180,000,000,000 energy/day
  - freeNetLimit → 5,000 bytes/account/day
- **Network Weight** → Chapter 2 (Section 2.6)

## O
- **Optimization** → Chapter 10
  - RPC Call Reduction → 95%+ reduction
  - Local Calculations → Chapter 10 (Section 10.1)

## P
- **Precision Arithmetic** → Chapter 2 (Section 2.4.3)
- **PRECISION Constant** → Chapter 2 (1,000,000)
- **Production Best Practices** → Chapter 10
- **Program.java** → Chapter 1 (TVM execution context)
- **Proportional Consumption** → Chapter 4 (Section 4.3)
- **Proposals** → Chapter 7
- **Protobuf Messages** → Chapter 3
  - balance_contract.proto → Chapter 3
  - common.proto → Chapter 1
  - Tron.proto → Chapter 1

## Q
- **Quick Reference Tables** → Appendix (COMPLETE_BOOK_SUMMARY.md)

## R
- **Recovery Mechanisms** → Chapter 6
  - 24-Hour Window → Chapter 6 (Section 6.1)
  - Multiple Cycles → Chapter 6 (Section 6.2)
- **Resource Allocation** → Chapter 2 (Section 2.3)
- **Resource Independence** → Chapter 1 (Section 1.3.1)
- **Resource State Machine** → Chapter 1 (Section 1.7)
- **ResourceCode Enum** → Chapter 1
  - BANDWIDTH = 0x00
  - ENERGY = 0x01
  - TRON_POWER = 0x02
- **ResourceProcessor.java** → Chapter 2 (Base class)
- **RPC Optimization** → Chapter 10 (14,400 → 96 calls/day)

## S
- **Stake 1.0** → Chapter 1 (Section 1.5.1)
- **Stake 2.0** → Chapter 1 (Section 1.5.2)
  - TIP-467 → October 2022
  - Features → Flexible locks, partial unfreeze
- **State Machine** → Chapter 1 (Section 1.7)
- **Storage Layer** → Chapter 11

## T
- **Testing** → Chapter 2 (test files reference)
- **TIP-467** → Chapter 1 (Stake 2.0 proposal)
- **totalEnergyCurrentLimit** → Chapter 2 (Adaptive limit)
- **totalEnergyLimit** → Chapter 1 (180B default)
- **totalEnergyWeight** → Chapter 2 (Section 2.6)
- **totalNetLimit** → Chapter 1 (43.2B default)
- **totalNetWeight** → Chapter 2 (Section 2.6)
- **TRC-20 Transfer Costs** → Chapter 5
  - Existing Account → 14,000 energy
  - New Account → 64,000 energy
- **TRON_POWER** → Chapter 1 (Section 1.2.3)
  - ResourceCode → 0x02
  - Voting → 1 TRON_POWER = 1 vote
- **TronGrid API** → Chapter 12
- **TronWeb Integration** → Chapter 12
- **TRX_PRECISION** → Chapter 2 (1,000,000 sun = 1 TRX)
- **TVM (TRON Virtual Machine)** → Chapter 1 (Section 1.2.2)

## U
- **UnDelegateResourceContract** → Chapter 4 (Section 4.4)
- **UnfreezeBalanceV2Actuator** → Chapter 3 (Section 3.3)
- **UnfreezeBalanceV2Contract** → Chapter 3
- **Unfreeze Delay** → Chapter 3 (14 days default)
- **UNFREEZE_MAX_TIMES** → Chapter 3 (32 operations)
- **Usage Tracking** → Chapter 6

## V
- **Validation Rules** → Chapter 3 (Section 3.2)
- **Voting** → Chapter 1 (Section 1.2.3)
  - VOTE_WITNESS cost → 30,000 energy
  - Rewards → Chapter 1

## W
- **Weight-Based Allocation** → Chapter 2 (Section 2.6)
- **Window Size** → Chapter 2
  - WINDOW_SIZE_MS → 86,400,000 ms (24 hours)
  - windowSize (blocks) → 28,800 blocks
- **WINDOW_SIZE_PRECISION** → Chapter 2
- **WithdrawExpireUnfreezeActuator** → Chapter 3 (Section 3.4)
- **WithdrawExpireUnfreezeContract** → Chapter 3

## Source Code File Index

### Core Resource Processing
- **ResourceProcessor.java** → Lines 22-265
  - increase() → Lines 47-64
  - increaseV2() → Lines 107-139
  - unDelegateIncrease() → Lines 141-171
- **BandwidthProcessor.java** → Lines 31-100+
  - consume() → Lines 96-100
  - calculateGlobalNetLimit() → Lines 141-150
- **EnergyProcessor.java** → Lines 22-150+
  - updateAdaptiveTotalEnergyLimit() → Lines 64-89
  - calculateGlobalEnergyLimit() → Lines 141-150

### Contract Actuators
- **FreezeBalanceV2Actuator.java** → Lines 26-175
  - execute() → Lines 33-89
  - validate() → Lines 92-164
- **UnfreezeBalanceV2Actuator.java** → Lines 41-200+
  - execute() → Lines 51-101
  - validate() → Lines 104-185
- **DelegateResourceActuator.java** → Referenced in Chapter 4
- **UnDelegateResourceActuator.java** → Referenced in Chapter 4

### Protobuf Definitions
- **common.proto** → Lines 9-13 (ResourceCode enum)
- **balance_contract.proto** → Lines 84-118
  - FreezeBalanceV2Contract → Lines 84-88
  - UnfreezeBalanceV2Contract → Lines 90-94
  - DelegateResourceContract → Lines 100-107
  - UnDelegateResourceContract → Lines 109-114

### Energy Costs
- **EnergyCost.java** → Lines 11-547
  - Resource operation costs → Lines 38-49
  - TVM operation costs → Throughout file

### Storage Layer
- **DynamicPropertiesStore.java** → Referenced throughout
- **AccountStore.java** → Referenced in Chapter 3
- **DelegatedResourceStore.java** → Referenced in Chapter 4

## Formula Index

### Resource Allocation
```
bandwidth_limit = (frozen_balance / 1,000,000) × (total_net_limit / total_net_weight)
energy_limit = (frozen_balance / 1,000,000) × (total_energy_limit / total_energy_weight)
tron_power = frozen_balance (1:1)
```

### Recovery Formulas
```
decay = (window_size - elapsed_time) / window_size
new_usage = last_usage × decay + current_usage
available = limit - current_usage
recovery_time = (current_usage / limit) × 24 hours
```

### Adaptive Energy
```
if (avg_usage > target):
    new_limit = current × 99/100
else:
    new_limit = current × 1000/999

bounded: min(max(new_limit, base), base × multiplier)
```

### Delegation
```
owner_usage = (receiver_usage × delegated_amount) / total_receiver_resources
new_window = (owner_usage × owner_window + transfer_usage × receiver_window) / total_usage
```

### Fee Calculation
```
bandwidth_fee = bytes × 10 sun
energy_fee = energy × 420 sun (default, dynamic)
dynamic_energy = base_energy × (1 + factor / 10000)
```

## Diagram Index

1. **Resource Relationship Diagram** → Chapter 1 (Section 1.3)
2. **State Machine Diagram** → Chapter 1 (Section 1.7)
3. **Freeze/Unfreeze Flow** → Chapter 3
4. **Delegation Sequence** → Chapter 4
5. **Recovery Timeline** → Chapter 6
6. **Monitoring Architecture** → Chapter 9
7. **Database ERD** → Chapter 11

## Code Example Index

### JavaScript
- Resource Calculator → Chapter 9
- Transaction Cost Estimator → Chapter 10
- TronGrid Client → Chapter 12

### Java
- ResourceProcessor → Chapter 2 (source code)
- FreezeBalanceV2Actuator → Chapter 3 (source code)

### SQL
- Database Schema → Chapter 11
- Resource Calculation Functions → Chapter 11
- Triggers → Chapter 11

### Python
- Monitoring Service → Referenced in Chapter 9

## Quick Access by Use Case

### "I want to calculate resource limits"
→ Chapter 2 (Section 2.3) for formulas
→ Chapter 9 for implementation code

### "I want to freeze TRX"
→ Chapter 3 (Section 3.1) for FreezeBalanceV2
→ Chapter 1 (Section 1.2) for resource types

### "I want to delegate resources"
→ Chapter 4 for complete delegation guide
→ Chapter 4 (Section 4.3) for proportional consumption

### "I want to optimize costs"
→ Chapter 10 for best practices
→ Chapter 5 for fee structures

### "I want to build a monitoring system"
→ Chapter 9 for architecture
→ Chapter 11 for database design
→ Chapter 12 for API integration

### "I want to understand recovery"
→ Chapter 2 (Section 2.4) for mathematics
→ Chapter 6 for practical examples

## Glossary

- **Block**: 3-second interval on TRON network
- **Delegation**: Transfer of resources to another account
- **Freeze**: Lock TRX to obtain resources
- **Resource Weight**: Frozen balance / 1,000,000
- **Sun**: Smallest TRX unit (1 TRX = 10^6 sun)
- **TRX_PRECISION**: 1,000,000 (conversion factor)
- **Unfreeze**: Initiate return of frozen TRX (14-day delay)
- **Window Size**: 24-hour recovery period (28,800 blocks)

---

**Note**: All page references refer to the complete book chapters in the `chapters/` directory. See `COMPLETE_BOOK_SUMMARY.md` for consolidated content.
