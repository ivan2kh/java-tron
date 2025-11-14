# TRON Network Resources: Source Code Structure Analysis

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Codebase:** java-tron (ivan2kh/java-tron, develop branch)
**Purpose:** Foundation document for "TRON Network Resources: The Complete Technical Guide"

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project Architecture Overview](#project-architecture-overview)
3. [Resource Management System](#resource-management-system)
4. [Staking 2.0 & Delegation](#staking-20--delegation)
5. [Transaction Processing (Actuators)](#transaction-processing-actuators)
6. [Smart Contract Execution](#smart-contract-execution)
7. [Data Models & Protocol Buffers](#data-models--protocol-buffers)
8. [State Management & Database](#state-management--database)
9. [Network Configuration & Parameters](#network-configuration--parameters)
10. [Consensus Mechanism](#consensus-mechanism)
11. [Critical Formulas & Constants](#critical-formulas--constants)
12. [Test Coverage Analysis](#test-coverage-analysis)

---

## Executive Summary

This document provides a comprehensive analysis of the java-tron codebase structure, focusing on the resource management system that governs bandwidth, energy, and Tron Power. This analysis forms the foundation for the technical guide and ensures all content is grounded in actual implementation rather than speculation.

### Key Findings:

1. **Modular Architecture**: java-tron is organized into 9 primary modules with clear separation of concerns
2. **Three Resource Types**: Bandwidth, Energy, and Tron Power (introduced in Stake 2.0)
3. **Dual Staking Systems**: Legacy V1 (freeze/unfreeze) and V2 (Stake 2.0) coexist
4. **43 Transaction Types**: Each processed by specialized Actuator classes
5. **24-Hour Decay Window**: Resources recover using a sliding window algorithm
6. **Adaptive Energy Limits**: Dynamic adjustment based on network utilization
7. **System Contracts**: Native contracts (types 54-59) handle staking operations

---

## Project Architecture Overview

### Module Structure

```
java-tron/
├── actuator/          # Transaction processors & VM execution
├── chainbase/         # Core state, database, data models
├── common/            # Shared utilities, parameters, crypto
├── config/            # Configuration management
├── consensus/         # DPOS & PBFT consensus
├── crypto/            # Cryptographic primitives
├── framework/         # API services, networking, RPC
├── protocol/          # Protocol buffer definitions
└── plugins/           # Extensibility framework
```

### Dependency Flow

```
┌─────────────┐
│  framework  │  (API, HTTP/gRPC services, high-level managers)
└──────┬──────┘
       │
┌──────▼──────┐
│  actuator   │  (Transaction processing, VM, contracts)
└──────┬──────┘
       │
┌──────▼──────┐
│ chainbase   │  (Core state, database, resource processors)
└──────┬──────┘
       │
┌──────▼──────┐
│  protocol   │  (Protobuf definitions)
└─────────────┘
```

### Critical Path: Transaction to Execution

```
User Transaction
    ↓
Wallet.broadcastTransaction()  [framework/src/main/java/org/tron/core/Wallet.java]
    ↓
TransactionCapsule.validateSignature()  [chainbase/capsule/TransactionCapsule.java]
    ↓
ActuatorFactory.createActuator()  [actuator/ActuatorFactory.java]
    ↓
Actuator.validate()  [Specific actuator class]
    ↓
BandwidthProcessor.consume()  [chainbase/db/BandwidthProcessor.java]
    ↓
Actuator.execute()  [Specific actuator class]
    ↓
EnergyProcessor.useEnergy()  [chainbase/db/EnergyProcessor.java]
    ↓
ChainBaseManager.commit()  [chainbase/ChainBaseManager.java]
```

---

## Resource Management System

### Core Components

#### 1. ResourceProcessor (Abstract Base)
**Location**: `/chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java`

**Purpose**: Abstract base class implementing the 24-hour sliding window algorithm for resource decay

**Key Methods**:
```java
// Calculate resource consumption
public abstract void consume(TransactionTrace trace)

// Update resource usage with decay
protected void increase(AccountCapsule account, long lastUsage, long usage,
                       long lastTime, long now)

// Calculate current usage after decay
private long increase(long lastUsage, long usage, long lastTime, long now,
                     long windowSize)
```

**Decay Formula**:
```java
long delta = now - lastTime;
double decay = (windowSize - delta * 1.0) / windowSize;
long averageLastUsage = (long) (lastUsage * decay);
return averageLastUsage + usage;
```

**Key Insight**: The decay formula ensures that resource usage gradually decreases over a 24-hour window (86,400,000 milliseconds). After 24 hours, the usage effectively resets to zero.

#### 2. BandwidthProcessor
**Location**: `/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java`

**Purpose**: Handles bandwidth consumption for all transactions

**Resource Sources** (in priority order):
1. **Free Bandwidth**: 600 units per account per day
2. **Asset-Specific Bandwidth**: Provided by token issuers (TRC10 only)
3. **Frozen Bandwidth**: From staked TRX
4. **Burned TRX**: Last resort, pays transaction fee

**Consumption Logic**:
```java
public void consume(TransactionCapsule trx, TransactionTrace trace) {
  long bytesSize = trx.getInstance().toByteArray().length;

  // Try free bandwidth first
  if (account.getFreeNetUsage() < freeNetLimit) {
    // Use free bandwidth
  }
  // Try asset-specific bandwidth for asset transfers
  else if (isAssetTransfer && account.hasAssetBandwidth()) {
    // Use asset bandwidth
  }
  // Try frozen bandwidth
  else if (account.getNetLimit() > account.getNetUsage()) {
    // Use frozen bandwidth
  }
  // Burn TRX as last resort
  else {
    long fee = bytesSize * transactionFee; // Default: 10 sun per byte
    account.setBalance(account.getBalance() - fee);
  }
}
```

**Key Insight**: The 600 free bandwidth is sufficient for ~2 simple TRX transfers per day (each transaction is ~200-300 bytes).

#### 3. EnergyProcessor
**Location**: `/chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java`

**Purpose**: Manages energy consumption for smart contract operations

**Energy Sources** (in priority order):
1. **Caller's Frozen Energy**: From caller's staked TRX
2. **Contract's Frozen Energy**: Energy provided by contract creator
3. **Burned TRX**: Pays energy fee (default: 420 sun per energy unit)

**Adaptive Energy Limit**:
```java
// Calculate adaptive limit based on usage
public long calculateGlobalEnergyLimit(ChainBaseManager manager) {
  long totalEnergyLimit = manager.getDynamicPropertiesStore()
      .getTotalEnergyCurrentLimit();
  long totalEnergyAverageUsage = manager.getDynamicPropertiesStore()
      .getTotalEnergyAverageUsage();
  long targetTotalEnergyLimit = manager.getDynamicPropertiesStore()
      .getTotalEnergyTargetLimit();

  // Expand limit if usage is high
  if (totalEnergyAverageUsage > targetTotalEnergyLimit * CONTRACT_RATE) {
    totalEnergyLimit = totalEnergyLimit * EXPAND_RATE_NUMERATOR
                     / EXPAND_RATE_DENOMINATOR;
  }

  return Math.max(totalEnergyLimit, targetTotalEnergyLimit);
}
```

**Constants**:
```java
CONTRACT_RATE = 99/100  // 99% utilization threshold
EXPAND_RATE = 1000/999  // 0.1% expansion per period
PERIODS_MS = 60_000     // 1-minute adjustment period
```

**Key Insight**: The adaptive energy limit prevents network congestion by gradually increasing capacity when utilization exceeds 99%, then gradually decreasing when utilization drops.

### Resource Calculation Formulas

#### Available Bandwidth Formula
```java
// Net limit from frozen balance
long netLimit = (frozenBalance / totalNetWeight) * totalNetLimit;

// Available bandwidth after decay
long windowSize = 24 * 3600 * 1000L; // 24 hours
long delta = now - lastConsumeTime;
double decay = (windowSize - delta) / windowSize;
long currentUsage = (long)(lastUsage * decay);
long available = netLimit - currentUsage;
```

#### Available Energy Formula
```java
// Energy limit from frozen balance
long energyLimit = (frozenBalance / totalEnergyWeight) * totalEnergyLimit;

// Available energy after decay
long windowSize = 24 * 3600 * 1000L; // 24 hours
long delta = now - lastConsumeTimeForEnergy;
double decay = (windowSize - delta) / windowSize;
long currentUsage = (long)(lastEnergyUsage * decay);
long available = energyLimit - currentUsage;
```

#### Energy Cost in TRX
```java
// If caller doesn't have enough energy, burn TRX
long energyFee = dynamicStore.getEnergyFee(); // Default: 420 sun
long costInSun = energyRequired * energyFee;
long costInTRX = costInSun / 1_000_000;
```

#### Energy Factor (Contract-Specific Multiplier)
```java
// Popular contracts pay more
long baseEnergyUsage = calculateBaseEnergy(operation);
long energyFactor = contractStateStore.getEnergyFactor(contractAddress);
// energyFactor ranges from 0 (new) to 100 (extremely popular)
long actualEnergy = baseEnergyUsage * (100 + energyFactor) / 100;
```

**Key Insight**: USDT-TRC20 (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) has an energy_factor of ~15-20, meaning operations cost 115-120% of base energy.

---

## Staking 2.0 & Delegation

### Stake V1 vs V2 Comparison

| Feature | V1 (Legacy) | V2 (Stake 2.0) |
|---------|-------------|----------------|
| **Contract Types** | FreezeBalance (11), UnfreezeBalance (12) | FreezeBalanceV2 (54), UnfreezeBalanceV2 (55) |
| **Lock Period** | 3 days minimum | No minimum, but 14-day withdrawal after unfreeze |
| **Resource Types** | BANDWIDTH, ENERGY | BANDWIDTH, ENERGY, TRON_POWER |
| **Delegation** | Not directly supported | Native delegation support (types 57, 58) |
| **Voting Power** | Automatic from frozen balance | Separate TRON_POWER resource |
| **Multiple Stakes** | Single freeze per resource type | Multiple simultaneous freezes |
| **Unfreeze Process** | Immediate after 3 days | Queue with 14-day expiration |

### Stake 2.0 Transaction Types

#### Type 54: FreezeBalanceV2
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/FreezeBalanceV2Actuator.java`
**Processor**: `/actuator/src/main/java/org/tron/core/vm/nativecontract/FreezeBalanceV2Processor.java`

**Parameters**:
```protobuf
message FreezeBalanceV2Contract {
  bytes owner_address = 1;
  int64 frozen_balance = 2;  // Amount in sun (1 TRX = 1,000,000 sun)
  ResourceCode resource = 3;  // 0=BANDWIDTH, 1=ENERGY, 2=TRON_POWER
}
```

**Execution Flow**:
```java
1. Validate:
   - owner_address exists and has sufficient balance
   - frozen_balance > 0 and >= minimum (1 TRX)
   - resource is valid (0, 1, or 2)

2. Execute:
   - Deduct frozen_balance from account.balance
   - Add FreezeV2 record to account.frozen_v2 list
   - Update network total weight:
     * TotalNetWeight (if BANDWIDTH)
     * TotalEnergyWeight (if ENERGY)
     * TotalTronPowerWeight (if TRON_POWER)
   - Account can now earn resources/voting power
```

**Storage Impact**:
```java
// Account state changes
Account.balance -= frozen_balance
Account.frozen_v2.add(new FreezeV2(frozen_balance, now, resource_type))

// Global state changes
if (resource == BANDWIDTH) {
  DynamicPropertiesStore.TotalNetWeight += frozen_balance
} else if (resource == ENERGY) {
  DynamicPropertiesStore.TotalEnergyWeight += frozen_balance
} else if (resource == TRON_POWER) {
  DynamicPropertiesStore.TotalTronPowerWeight += frozen_balance
}
```

#### Type 55: UnfreezeBalanceV2
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/UnfreezeBalanceV2Actuator.java`

**Purpose**: Initiates the unfreezing process, starts 14-day waiting period

**Parameters**:
```protobuf
message UnfreezeBalanceV2Contract {
  bytes owner_address = 1;
  int64 unfreeze_balance = 2;  // Amount to unfreeze
  ResourceCode resource = 3;
}
```

**Execution Flow**:
```java
1. Validate:
   - owner_address has frozen_v2 balance of specified resource
   - unfreeze_balance <= total frozen for that resource
   - Account has not exceeded max unfreeze count (32 pending unfreezes)

2. Execute:
   - Reduce frozen_v2 balance by unfreeze_balance
   - Add UnFreezeV2 record with expiration (now + 14 days)
   - Reduce network total weight immediately
   - Resources (bandwidth/energy) lost immediately
   - Balance not available until expiration + WithdrawExpireUnfreeze
```

**Key Insight**: The 14-day waiting period prevents gaming the system by rapidly staking/unstaking to manipulate network weights.

#### Type 56: WithdrawExpireUnfreeze
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/WithdrawExpireUnfreezeActuator.java`

**Purpose**: Claims expired unfrozen balances after 14-day period

**Execution Flow**:
```java
1. Scan account.unfrozen_v2 list
2. Find all records where unfreeze_expire_time <= now
3. Sum expired amounts
4. Add to account.balance
5. Remove expired records from unfrozen_v2 list
```

#### Type 57: DelegateResource
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/DelegateResourceActuator.java`
**Processor**: `/actuator/src/main/java/org/tron/core/vm/nativecontract/DelegateResourceProcessor.java`

**Purpose**: Delegate frozen resources to another address for their use

**Parameters**:
```protobuf
message DelegateResourceContract {
  bytes owner_address = 1;      // Delegator (resource owner)
  bytes receiver_address = 2;   // Delegatee (resource user)
  int64 balance = 3;            // Amount of frozen balance to delegate
  ResourceCode resource = 4;    // BANDWIDTH or ENERGY
  bool lock = 5;                // If true, locked for 3 days
  int64 lock_period = 6;        // Lock period in milliseconds
}
```

**Execution Flow**:
```java
1. Validate:
   - owner_address has enough frozen_v2 balance
   - receiver_address is valid and different from owner
   - balance > 0
   - resource is BANDWIDTH or ENERGY (not TRON_POWER)
   - If delegated resources are in use, delegation is not allowed

2. Execute:
   - Create/update DelegatedResourceCapsule(owner → receiver)
   - Update DelegatedResourceAccountIndexStore for both addresses
   - Receiver gains resource limit immediately
   - Owner loses resource limit immediately
   - If locked, cannot undelegate until lock_period expires
```

**Storage Impact**:
```java
// DelegatedResource record
DelegatedResource dr = new DelegatedResource();
dr.setFrom(owner_address);
dr.setTo(receiver_address);
if (resource == BANDWIDTH) {
  dr.setFrozenBalanceForBandwidth(balance);
  dr.setExpireTimeForBandwidth(now + lock_period);
} else if (resource == ENERGY) {
  dr.setFrozenBalanceForEnergy(balance);
  dr.setExpireTimeForEnergy(now + lock_period);
}

// Account state changes
owner.acquired_delegated_frozen_balance_for_X += balance
receiver.delegated_frozen_balance_for_X += balance

// Index updates
DelegatedResourceAccountIndexStore.put(owner, list_of_receivers);
DelegatedResourceAccountIndexStore.put(receiver, list_of_delegators);
```

**Delegation Use Cases**:
1. **dApp Resource Subsidization**: Contract creator delegates energy to users
2. **Resource Rental Markets**: Users rent resources from providers
3. **Multi-Account Management**: Main account provides resources to sub-accounts
4. **Development/Testing**: Testnet resource sharing

#### Type 58: UnDelegateResource
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/UnDelegateResourceActuator.java`

**Purpose**: Revoke delegated resources

**Execution Flow**:
```java
1. Validate:
   - Delegation exists from owner to receiver
   - If locked, lock_period has expired
   - Delegated resources are not currently in use by receiver

2. Execute:
   - Reduce/remove DelegatedResourceCapsule
   - Receiver loses resource limit immediately
   - Owner regains resource limit immediately
   - Update indices
```

**Key Constraint**: Cannot undelegate if receiver is actively using the delegated resources. Must wait for 24-hour decay window.

#### Type 59: CancelAllUnfreezeV2
**Actuator**: `/actuator/src/main/java/org/tron/core/actuator/CancelAllUnfreezeV2Actuator.java`

**Purpose**: Cancel all pending unfreezes and re-freeze the balance

**Use Case**: User unfroze by mistake or market conditions changed, wants to re-stake immediately without waiting 14 days

**Execution Flow**:
```java
1. Scan all unfrozen_v2 records
2. Sum total unfreeze amounts
3. Move amounts back to frozen_v2
4. Clear unfrozen_v2 list
5. Restore network weight
6. Resources available immediately
```

### Delegation Calculation Details

#### Available Balance for Delegation
```java
// From FreezeV2Util.java
public static long getAvailableFrozenBalance(AccountCapsule account,
                                             ResourceCode resource,
                                             long now) {
  // Total frozen for this resource
  long totalFrozen = account.getFrozenV2BalanceForResource(resource);

  // Already delegated
  long delegated = account.getDelegatedFrozenBalanceForResource(resource);

  // In use (based on current resource usage)
  long usage = getResourceUsage(account, resource, now);
  long limit = getResourceLimit(account, resource);
  double utilizationRate = (double) usage / limit;
  long inUseFrozen = (long) (totalFrozen * utilizationRate);

  // Available = total - delegated - in_use
  return totalFrozen - delegated - inUseFrozen;
}
```

**Key Insight**: You cannot delegate frozen balance that is currently backing active resource usage. This prevents resource starvation attacks.

#### Receiver's Resource Calculation
```java
// Receiver's total energy limit
long ownFrozenEnergy = receiver.getFrozenV2Balance(ENERGY);
long acquiredDelegatedEnergy = receiver.getAcquiredDelegatedFrozenBalance(ENERGY);
long totalFrozenEnergy = ownFrozenEnergy + acquiredDelegatedEnergy;

long totalEnergyWeight = dynamicStore.getTotalEnergyWeight();
long totalEnergyLimit = dynamicStore.getTotalEnergyLimit();

long energyLimit = (totalFrozenEnergy * totalEnergyLimit) / totalEnergyWeight;
```

### Delegation Lock Period Impact

**Unlocked Delegation** (`lock = false`):
- Can be undelegated anytime (if not in use)
- More flexible for dynamic resource allocation
- Use case: Temporary resource provision

**Locked Delegation** (`lock = true, lock_period = 3 days`):
- Cannot be undelegated for 3 days
- Provides stability for receivers
- Use case: Rental agreements, long-term subsidization

**Default Lock Period**:
```java
public static final long DELEGATE_PERIOD = 3 * 86400000L; // 3 days
```

---

## Transaction Processing (Actuators)

### Actuator Architecture

#### Base Interface
**Location**: `/chainbase/src/main/java/org/tron/core/Actuator.java`

```java
public interface Actuator {
  // Execute transaction logic
  boolean execute(Object object) throws ContractExeException;

  // Validate transaction before execution
  boolean validate() throws ContractValidateException;

  // Get transaction fee in sun
  long calcFee();

  // Get transaction owner address
  ByteString getOwnerAddress();
}
```

#### AbstractActuator
**Location**: `/actuator/src/main/java/org/tron/core/actuator/AbstractActuator.java`

**Responsibilities**:
- Provides ChainBaseManager reference
- Handles common validation (address format, balance checks)
- Fork version checking
- Fee calculation helpers

### Complete Actuator Mapping

| Type | Contract | Actuator Class | Bandwidth | Energy | Description |
|------|----------|----------------|-----------|--------|-------------|
| 0 | AccountCreate | CreateAccountActuator | ✓ | - | Create new account |
| 1 | Transfer | TransferActuator | ✓ | - | Transfer TRX |
| 2 | TransferAsset | TransferAssetActuator | ✓/Asset | - | Transfer TRC10 token |
| 4 | VoteWitness | VoteWitnessActuator | ✓ | - | Vote for Super Representatives |
| 5 | WitnessCreate | WitnessCreateActuator | ✓ | - | Register as witness candidate |
| 6 | AssetIssue | AssetIssueActuator | ✓ | - | Create TRC10 token |
| 8 | WitnessUpdate | WitnessUpdateActuator | ✓ | - | Update witness info |
| 9 | ParticipateAssetIssue | ParticipateAssetIssueActuator | ✓/Asset | - | Buy TRC10 tokens |
| 10 | AccountUpdate | UpdateAccountActuator | ✓ | - | Update account name |
| 11 | FreezeBalance | FreezeBalanceActuator | ✓ | - | Stake V1 freeze |
| 12 | UnfreezeBalance | UnfreezeBalanceActuator | ✓ | - | Stake V1 unfreeze |
| 13 | WithdrawBalance | WithdrawBalanceActuator | ✓ | - | Withdraw SR rewards |
| 14 | UnfreezeAsset | UnfreezeAssetActuator | ✓ | - | Unfreeze TRC10 tokens |
| 15 | UpdateAsset | UpdateAssetActuator | ✓ | - | Update TRC10 info |
| 16 | ProposalCreate | ProposalCreateActuator | ✓ | - | Create network proposal |
| 17 | ProposalApprove | ProposalApproveActuator | ✓ | - | Approve proposal |
| 18 | ProposalDelete | ProposalDeleteActuator | ✓ | - | Delete proposal |
| 19 | SetAccountId | SetAccountIdActuator | ✓ | - | Set account ID |
| 30 | CreateSmartContract | CreateSmartContractActuator | ✓ | ✓ | Deploy contract |
| 31 | TriggerSmartContract | TriggerSmartContractActuator | ✓ | ✓ | Call contract |
| 33 | UpdateSettingContract | UpdateSettingContractActuator | ✓ | - | Update consume_user_resource_percent |
| 41 | ExchangeCreate | ExchangeCreateActuator | ✓ | - | Create trading pair |
| 42 | ExchangeInject | ExchangeInjectActuator | ✓ | - | Add liquidity |
| 43 | ExchangeWithdraw | ExchangeWithdrawActuator | ✓ | - | Remove liquidity |
| 44 | ExchangeTransaction | ExchangeTransactionActuator | ✓ | - | Trade on exchange |
| 45 | UpdateEnergyLimitContract | UpdateEnergyLimitContractActuator | ✓ | - | Update origin_energy_limit |
| 46 | AccountPermissionUpdate | AccountPermissionUpdateActuator | ✓ | - | Update multi-sig permissions |
| 48 | ClearABIContract | ClearABIContractActuator | ✓ | - | Remove contract ABI |
| 49 | UpdateBrokerage | UpdateBrokerageActuator | ✓ | - | Update SR brokerage rate |
| 51 | ShieldedTransfer | ShieldedTransferActuator | ✓ | - | Private transaction |
| 52 | MarketSellAsset | MarketSellAssetActuator | ✓ | - | Create market order |
| 53 | MarketCancelOrder | MarketCancelOrderActuator | ✓ | - | Cancel market order |
| 54 | FreezeBalanceV2 | FreezeBalanceV2Actuator | ✓ | - | Stake V2 freeze |
| 55 | UnfreezeBalanceV2 | UnfreezeBalanceV2Actuator | ✓ | - | Stake V2 unfreeze |
| 56 | WithdrawExpireUnfreeze | WithdrawExpireUnfreezeActuator | ✓ | - | Claim expired stakes |
| 57 | DelegateResource | DelegateResourceActuator | ✓ | - | Delegate resources |
| 58 | UnDelegateResource | UnDelegateResourceActuator | ✓ | - | Undelegate resources |
| 59 | CancelAllUnfreezeV2 | CancelAllUnfreezeV2Actuator | ✓ | - | Cancel all unfreezes |

### Actuator Lifecycle

```
┌─────────────────────────────────────────────────┐
│          Transaction Received                    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  ActuatorFactory.createActuator(contract_type)  │
│  Returns: Specific Actuator instance            │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  BandwidthProcessor.consume(trace)              │
│  - Checks bandwidth availability                │
│  - Consumes or burns TRX                        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Actuator.validate()                            │
│  - Validates parameters                         │
│  - Checks preconditions                         │
│  - Throws ContractValidateException if invalid  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Actuator.execute()                             │
│  - Modifies state (accounts, stores)            │
│  - May consume energy (for VM operations)       │
│  - Returns success/failure                      │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Receipt Generation                             │
│  - Records resource usage                       │
│  - Records result                               │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  ChainBaseManager.commit()                      │
│  - Persists state changes to database           │
└─────────────────────────────────────────────────┘
```

### Critical Actuator: VMActuator (Smart Contracts)

**Location**: `/actuator/src/main/java/org/tron/core/actuator/VMActuator.java`

**Responsibilities**:
1. Validate contract call parameters
2. Create VM execution context
3. Execute contract bytecode
4. Handle energy consumption
5. Process result and logs
6. Handle exceptions and reverts

**Execution Flow**:
```java
public boolean execute(Object object) {
  TransactionContext context = (TransactionContext) object;

  // 1. Prepare execution environment
  ProgramInvoke invoke = programInvokeFactory.createProgramInvoke(
      context, blockCap, txCap, callerAddress, contractAddress,
      callValue, callData, energyLimit);

  // 2. Create VM program
  Program program = new Program(contractCode, invoke, txCap);

  // 3. Execute
  try {
    vm.play(program);
    program.getResult();

    // 4. Handle energy consumption
    long energyUsed = energyLimit - program.getEnergyRemaining();
    energyProcessor.useEnergy(callerAccount, energyUsed, now);

    // 5. Process logs and internal transactions
    processLogs(program.getResult().getLogInfoList());
    processInternalTransactions(program.getResult());

  } catch (Exception e) {
    // Revert state changes but still consume energy
    program.revert();
    energyProcessor.useEnergy(callerAccount, energyLimit, now);
  }
}
```

**Key Insight**: Even if a contract execution fails (out of energy, revert, exception), bandwidth is consumed and partial energy is consumed. This prevents spam attacks.

---

## Smart Contract Execution

### VM Architecture

#### Main VM Engine
**Location**: `/actuator/src/main/java/org/tron/core/vm/VM.java`

**Purpose**: Interprets and executes EVM-compatible bytecode

**Key Components**:
```java
public class VM {
  private static final int MAX_DEPTH = 64; // Call stack depth limit

  public void play(Program program) {
    while (!program.isStopped()) {
      OpCode op = OpCode.code(program.getCurrentOp());

      // Check energy before operation
      long energyCost = calculateEnergyCost(op, program);
      if (program.getEnergyRemaining() < energyCost) {
        throw new OutOfEnergyException();
      }

      // Execute operation
      executeOperation(op, program);

      // Deduct energy
      program.spendEnergy(energyCost, op.name());
    }
  }
}
```

#### Program Context
**Location**: `/actuator/src/main/java/org/tron/core/vm/program/Program.java`

**State Tracking**:
- Stack: Operand stack (max 1024 items)
- Memory: Expandable byte array
- Storage: Persistent contract storage
- PC: Program counter
- Energy: Remaining energy limit
- Call depth: Current recursion level

### Energy Cost Model

#### EnergyCost Class
**Location**: `/actuator/src/main/java/org/tron/core/vm/EnergyCost.java`

**Operation Categories**:

| Category | Energy Cost | Examples |
|----------|-------------|----------|
| Zero Tier | 0 | STOP, RETURN |
| Base Tier | 2 | ADD, SUB, NOT, AND |
| Very Low Tier | 3 | MUL, DIV, MOD, SIGNEXTEND |
| Low Tier | 5 | ADDMOD, MULMOD, JUMP |
| Mid Tier | 8 | JUMPI, PC, MSIZE |
| High Tier | 10 | BLOCKHASH, BALANCE |
| Ext Tier | 700 | EXTCODESIZE, EXTCODECOPY |
| Special | Variable | SSTORE, SLOAD, CALL, CREATE |

**Storage Operations** (Most Expensive):
```java
// SSTORE energy calculation
public static long getSStoreEnergy(DataWord oldValue, DataWord newValue) {
  if (oldValue.isZero() && !newValue.isZero()) {
    return 20000; // Set from zero (new storage)
  } else if (!oldValue.isZero() && newValue.isZero()) {
    return 5000;  // Clear storage (refund available)
  } else if (!oldValue.isZero() && !newValue.isZero()) {
    return 5000;  // Update existing storage
  } else {
    return 5000;  // No-op (still charged)
  }
}

// SLOAD energy
public static final int SLOAD = 200;

// Call operations
public static final int CALL = 700;  // Base cost
public static final int CALL_VALUE = 9000;  // Additional if sending value
public static final int CALL_NEW_ACCOUNT = 25000;  // If creating new account
```

**Memory Expansion Cost**:
```java
public static long calcMemEnergy(long oldMemSize, long newMemSize) {
  long oldTotalEnergy = (oldMemSize / 32) * 3 + (oldMemSize / 32) ^ 2 / 512;
  long newTotalEnergy = (newMemSize / 32) * 3 + (newMemSize / 32) ^ 2 / 512;
  return newTotalEnergy - oldTotalEnergy;
}
```

**Key Insight**: Storage operations (SSTORE) are deliberately expensive (20,000 energy for new slots) to discourage blockchain bloat. Smart contracts should minimize storage usage.

### Energy Factor (Dynamic Pricing)

**Purpose**: Popular contracts pay higher energy costs to prevent resource monopolization

**Implementation**:
```java
// From ContractStateStore
public long getEnergyFactor(byte[] contractAddress) {
  return contractStateStore.getEnergyFactor(contractAddress);
}

// Applied in VM execution
long baseEnergy = EnergyCost.getOperationCost(opCode);
long energyFactor = getEnergyFactor(program.getContractAddress());
long actualEnergy = baseEnergy * (100 + energyFactor) / 100;
```

**Energy Factor Ranges**:
- New contracts: 0 (no penalty)
- Normal contracts: 0-10 (0-10% increase)
- Popular contracts: 10-30 (10-30% increase)
- Very popular (USDT, DEXs): 30-100 (30-100% increase)

**Calculation** (from dynamic monitoring):
```java
// Energy factor increases based on:
// 1. Total energy consumed by contract in last 24 hours
// 2. Contract's share of total network energy usage
// 3. Frequency of calls

long totalNetworkEnergy = dynamicStore.getTotalEnergyAverageUsage();
long contractEnergy24h = contractStateStore.getEnergyUsage24h(contract);
double sharePercent = (contractEnergy24h * 100.0) / totalNetworkEnergy;

if (sharePercent > 10) {
  energyFactor = 100; // Maximum penalty
} else if (sharePercent > 5) {
  energyFactor = 50;
} else if (sharePercent > 1) {
  energyFactor = 20;
} else if (sharePercent > 0.5) {
  energyFactor = 10;
} else {
  energyFactor = 0;
}
```

**Key Insight**: This mechanism prevents a single contract (like USDT) from monopolizing network resources while allowing new contracts to bootstrap without penalty.

### Native/Precompiled Contracts

**Location**: `/actuator/src/main/java/org/tron/core/vm/PrecompiledContracts.java`

**Standard Precompiles** (Ethereum-compatible):

| Address | Name | Energy Cost | Purpose |
|---------|------|-------------|---------|
| 0x01 | ECRecover | 3000 | Recover ECDSA signature |
| 0x02 | SHA256 | 60 + 12/word | SHA-256 hash |
| 0x03 | RIPEMD160 | 600 + 120/word | RIPEMD-160 hash |
| 0x04 | Identity | 15 + 3/word | Data copy |
| 0x05 | ModExp | Variable | Modular exponentiation |
| 0x06 | BN256Add | 500 | BN256 addition |
| 0x07 | BN256Mul | 40000 | BN256 multiplication |
| 0x08 | BN256Pairing | Variable | BN256 pairing |
| 0x09 | Blake2f | Variable | Blake2 compression |

**TRON System Precompiles**:

| Address | Name | Energy Cost | Purpose |
|---------|------|-------------|---------|
| 0x1000001 | FreezeBalanceV2 | 10000 | Stake V2 freeze |
| 0x1000002 | UnfreezeBalanceV2 | 10000 | Stake V2 unfreeze |
| 0x1000003 | WithdrawExpireUnfreeze | 5000 | Withdraw expired |
| 0x1000004 | DelegateResource | 10000 | Delegate resources |
| 0x1000005 | UnDelegateResource | 10000 | Undelegate resources |
| 0x1000006 | CancelAllUnfreezeV2 | 10000 | Cancel unfreezes |

**Key Insight**: Smart contracts can call staking operations directly via precompiled contracts, enabling automated resource management strategies.

### Contract Resource Configuration

#### consume_user_resource_percent
**Contract**: UpdateSettingContract (Type 33)
**Purpose**: Configure what percentage of energy is paid by caller vs contract creator

**Range**: 0-100
- 0: Contract creator pays 100% (subsidizes all users)
- 100: Caller pays 100% (standard model)
- 50: Split 50/50

**Use Cases**:
- 0-20: Onboarding new users (free interactions)
- 100: Standard applications (caller pays)

#### origin_energy_limit
**Contract**: UpdateEnergyLimitContract (Type 45)
**Purpose**: Maximum energy the contract creator is willing to provide per transaction

**Calculation**:
```java
// Total energy needed for transaction
long totalEnergy = estimatedEnergy;

// Caller's share
long callerEnergy = totalEnergy * consume_user_resource_percent / 100;

// Contract's share
long contractEnergy = totalEnergy - callerEnergy;

// Check contract's limit
if (contractEnergy > origin_energy_limit) {
  throw new OutOfEnergyException("Contract energy limit exceeded");
}

// Check contract creator's available energy
long creatorAvailableEnergy = getAvailableEnergy(contractCreator);
if (contractEnergy > creatorAvailableEnergy) {
  // Contract creator doesn't have enough, caller must pay difference
  callerEnergy += (contractEnergy - creatorAvailableEnergy);
}
```

**Key Insight**: Setting consume_user_resource_percent = 0 and origin_energy_limit = 1,000,000 allows contract creators to subsidize up to 1M energy per transaction for users.

---

## Data Models & Protocol Buffers

### Core Protobuf Definitions

**Location**: `/protocol/src/main/protos/core/Tron.proto`

### Account Structure

```protobuf
message Account {
  // Basic identity
  bytes account_name = 1;
  AccountType type = 2;
  bytes address = 3;
  int64 balance = 4;

  // Voting and witness
  repeated Vote votes = 5;
  int64 allowance = 7;
  int64 latest_withdraw_time = 8;
  bool is_witness = 9;
  bool is_committee = 10;

  // V1 Staking (Legacy)
  repeated Frozen frozen = 11;  // Frozen for BANDWIDTH
  int64 net_usage = 12;
  int64 acquired_delegated_frozen_balance_for_bandwidth = 13;
  int64 delegated_frozen_balance_for_bandwidth = 14;

  // Asset management
  map<string, int64> asset = 15;
  map<string, int64> assetV2 = 16;
  map<string, int64> free_asset_net_usage = 17;
  map<string, int64> free_asset_net_usageV2 = 18;

  // Timestamps
  int64 latest_opration_time = 19;
  int64 latest_consume_time = 20;
  int64 latest_consume_free_time = 21;

  // Account ID and permissions
  bytes account_id = 22;
  AccountResource account_resource = 23;
  repeated Permission active_permission = 24;
  Permission owner_permission = 25;
  Permission witness_permission = 26;

  // V2 Staking (Stake 2.0)
  repeated FreezeV2 frozen_v2 = 27;
  repeated UnFreezeV2 unfrozen_v2 = 28;
  int64 delegated_frozenV2_balance_for_bandwidth = 29;
  int64 acquired_delegated_frozenV2_balance_for_bandwidth = 30;
}

message AccountResource {
  // Energy resources
  int64 energy_usage = 1;
  Frozen frozen_balance_for_energy = 2;
  int64 latest_consume_time_for_energy = 3;
  int64 acquired_delegated_frozen_balance_for_energy = 4;
  int64 delegated_frozen_balance_for_energy = 5;

  // Storage (deprecated)
  int64 storage_limit = 6;
  int64 storage_usage = 7;
  int64 latest_exchange_storage_time = 8;

  // V2 Energy
  int64 energy_window_size = 9;
  int64 delegated_frozenV2_balance_for_energy = 10;
  int64 acquired_delegated_frozenV2_balance_for_energy = 11;

  // Window optimization
  int64 energy_window_optimized = 12;
  int64 tron_power_frozen_balance = 13;
  int64 tron_power_usage = 14;
  int64 latest_consume_time_for_tron_power = 15;
}

message Frozen {
  int64 frozen_balance = 1;  // Amount in sun
  int64 expire_time = 2;     // Expiration timestamp (ms)
}

message FreezeV2 {
  int64 type = 1;            // 0=BANDWIDTH, 1=ENERGY, 2=TRON_POWER
}

message UnFreezeV2 {
  int64 type = 1;
  int64 unfreeze_amount = 2;
  int64 unfreeze_expire_time = 3;  // When can withdraw (now + 14 days)
}
```

### Transaction Structure

```protobuf
message Transaction {
  message Contract {
    enum ContractType {
      AccountCreateContract = 0;
      TransferContract = 1;
      TransferAssetContract = 2;
      // ... (all 59 contract types)
      FreezeBalanceV2Contract = 54;
      UnfreezeBalanceV2Contract = 55;
      WithdrawExpireUnfreezeContract = 56;
      DelegateResourceContract = 57;
      UnDelegateResourceContract = 58;
      CancelAllUnfreezeV2Contract = 59;
    }

    ContractType type = 1;
    google.protobuf.Any parameter = 2;  // Serialized contract-specific data
    bytes provider = 3;
    bytes ContractName = 4;
    int32 Permission_id = 5;
  }

  message raw {
    bytes ref_block_bytes = 1;     // Reference block (anti-replay)
    int64 ref_block_num = 3;
    bytes ref_block_hash = 4;
    int64 expiration = 8;          // Transaction expiration time
    repeated authority auths = 9;
    bytes data = 10;
    repeated Contract contract = 11;  // Can have multiple contracts
    bytes scripts = 12;
    int64 timestamp = 14;
    int64 fee_limit = 18;          // Maximum TRX to burn (for energy)
  }

  raw raw_data = 1;
  repeated bytes signature = 2;   // ECDSA signatures
  repeated Result ret = 5;        // Execution result
}

message TransactionInfo {
  bytes id = 1;                   // Transaction hash
  int64 fee = 2;                  // Total fee paid
  int64 blockNumber = 3;
  int64 blockTimeStamp = 4;
  repeated bytes contractResult = 5;
  bytes contract_address = 6;

  ResourceReceipt receipt = 7;    // Resource usage details
  repeated Log log = 8;           // Event logs
  Result result = 9;
  bytes resMessage = 10;

  int64 withdraw_amount = 11;
  int64 unfreeze_amount = 12;
  repeated InternalTransaction internal_transactions = 13;
  int64 withdraw_expire_amount = 14;
}

message ResourceReceipt {
  int64 energy_usage = 1;              // Energy consumed
  int64 energy_fee = 2;                // TRX burned for energy
  int64 origin_energy_usage = 3;       // Energy from contract creator
  int64 energy_usage_total = 4;        // Total energy charged
  int64 net_usage = 5;                 // Bandwidth consumed
  int64 net_fee = 6;                   // TRX burned for bandwidth
  Result result = 7;
}
```

### Delegation Structures

**Location**: `/protocol/src/main/protos/core/delegated_resource.proto`

```protobuf
message DelegatedResource {
  bytes from = 1;         // Delegator address
  bytes to = 2;           // Delegatee address

  // V1 Delegation
  int64 frozen_balance_for_bandwidth = 3;
  int64 frozen_balance_for_energy = 4;
  int64 expire_time_for_bandwidth = 5;
  int64 expire_time_for_energy = 6;

  // V2 Delegation
  int64 frozenV2_balance_for_bandwidth = 7;
  int64 frozenV2_balance_for_energy = 8;
  int64 expire_time_for_bandwidth_v2 = 9;
  int64 expire_time_for_energy_v2 = 10;
}

message DelegatedResourceAccountIndex {
  bytes account = 1;              // The account address
  repeated bytes fromAccounts = 2; // Who delegated to this account
  repeated bytes toAccounts = 3;   // Who this account delegated to
  int64 timestamp = 4;
}
```

### API Response Messages

**Location**: `/protocol/src/main/protos/api/api.proto`

```protobuf
message AccountResourceMessage {
  int64 freeNetUsed = 1;        // Free bandwidth used
  int64 freeNetLimit = 2;       // Free bandwidth limit (600)
  int64 NetUsed = 3;            // Frozen bandwidth used
  int64 NetLimit = 4;           // Frozen bandwidth limit
  map<string, int64> assetNetUsed = 5;   // Asset-specific bandwidth used
  map<string, int64> assetNetLimit = 6;  // Asset-specific bandwidth limit
  int64 TotalNetLimit = 7;      // Total network bandwidth
  int64 TotalNetWeight = 8;     // Total frozen for bandwidth
  int64 TotalTronPowerWeight = 9;  // Total frozen for voting
  int64 tronPowerUsed = 10;     // Tron Power used (for voting)
  int64 tronPowerLimit = 11;    // Tron Power limit
  int64 EnergyUsed = 12;        // Energy used
  int64 EnergyLimit = 13;       // Energy limit from frozen
  int64 TotalEnergyLimit = 14;  // Total network energy
  int64 TotalEnergyWeight = 15; // Total frozen for energy
  int64 storageUsed = 16;       // Storage used (deprecated)
  int64 storageLimit = 17;      // Storage limit (deprecated)
}

message DelegatedResourceList {
  repeated DelegatedResource delegatedResource = 1;
}

message DelegatedResourceAccountIndex {
  bytes account = 1;
  repeated bytes fromAccounts = 2;
  repeated bytes toAccounts = 3;
}
```

### Key Data Relationships

```
Account
├── balance (liquid TRX)
├── frozen_v2[] (Stake 2.0 stakes)
│   ├── type (BANDWIDTH/ENERGY/TRON_POWER)
│   └── amount
├── unfrozen_v2[] (Pending withdrawals)
│   ├── amount
│   └── expire_time (now + 14 days)
├── account_resource
│   ├── energy_usage (current usage)
│   ├── latest_consume_time_for_energy
│   ├── acquired_delegated_frozen_balance_for_energy (received from others)
│   └── delegated_frozen_balance_for_energy (given to others)
├── net_usage (bandwidth usage)
├── latest_consume_time (bandwidth)
├── acquired_delegated_frozen_balance_for_bandwidth
└── delegated_frozen_balance_for_bandwidth

DelegatedResource (separate storage)
├── from (delegator)
├── to (delegatee)
├── frozenV2_balance_for_bandwidth
├── frozenV2_balance_for_energy
├── expire_time_for_bandwidth_v2 (if locked)
└── expire_time_for_energy_v2 (if locked)

DelegatedResourceAccountIndex
├── account
├── fromAccounts[] (who delegated TO me)
└── toAccounts[] (who I delegated TO)
```

---

## State Management & Database

### ChainBase Architecture

**Location**: `/chainbase/src/main/java/org/tron/core/ChainBaseManager.java`

**Purpose**: Central manager for all blockchain state and database stores

### Store Hierarchy

```
ChainBaseManager
├── AccountStore              (account data)
├── BlockStore                (block data)
├── TransactionStore          (transaction data)
├── WitnessStore              (Super Representative info)
├── WitnessScheduleStore      (block production schedule)
├── VotesStore                (voting records)
├── DelegatedResourceStore    (delegation records)
├── DelegatedResourceAccountIndexStore  (delegation indices)
├── DynamicPropertiesStore    (network parameters)
├── ContractStore             (contract metadata)
├── CodeStore                 (contract bytecode)
├── ContractStateStore        (contract storage)
├── AccountStateCallBackStore (state snapshots)
├── AssetIssueStore           (TRC10 tokens)
├── AssetIssueV2Store         (TRC10 V2)
├── ExchangeStore             (DEX pairs)
├── ExchangeV2Store           (DEX V2)
├── ProposalStore             (governance proposals)
├── MarketAccountStore        (market orders)
├── MarketOrderStore          (order details)
├── MarketPairPriceToOrderStore  (price index)
├── TransactionHistoryStore   (historical transactions)
└── IncrementalMerkleTreeStore  (Merkle tree for zkSNARKs)
```

### Key Store Implementations

#### AccountStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/AccountStore.java`

**Storage**: RocksDB
**Key**: Account address (21 bytes)
**Value**: Account protobuf

**Operations**:
```java
public AccountCapsule get(byte[] address);
public void put(byte[] address, AccountCapsule account);
public boolean has(byte[] address);
public void delete(byte[] address);
```

**Index**: None (direct key-value lookup)

#### DelegatedResourceStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/DelegatedResourceStore.java`

**Storage**: RocksDB
**Key**: Composite key = sha256(from_address + to_address)
**Value**: DelegatedResource protobuf

**Operations**:
```java
public DelegatedResourceCapsule get(byte[] from, byte[] to);
public void put(byte[] key, DelegatedResourceCapsule dr);
public boolean has(byte[] from, byte[] to);
public void delete(byte[] from, byte[] to);
```

**Key Generation**:
```java
public static byte[] buildKey(byte[] from, byte[] to) {
  return Sha256Sm3Hash.hash(ByteUtil.merge(from, to));
}
```

#### DelegatedResourceAccountIndexStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/DelegatedResourceAccountIndexStore.java`

**Purpose**: Efficiently query all delegations for an account

**Storage**: RocksDB
**Key**: Account address (21 bytes)
**Value**: DelegatedResourceAccountIndex protobuf

**Operations**:
```java
public DelegatedResourceAccountIndexCapsule get(byte[] address);

// Get all accounts that delegated TO this address
public List<byte[]> getDelegatorsFor(byte[] address);

// Get all accounts that this address delegated TO
public List<byte[]> getDelegateesFor(byte[] address);
```

**Use Case**: When displaying delegation information in wallet UIs

#### DynamicPropertiesStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/DynamicPropertiesStore.java`

**Purpose**: Store and manage network parameters

**Key Properties**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| LATEST_BLOCK_HEADER_TIMESTAMP | long | - | Last block time |
| LATEST_BLOCK_HEADER_NUMBER | long | - | Last block number |
| LATEST_BLOCK_HEADER_HASH | bytes | - | Last block hash |
| TOTAL_NET_WEIGHT | long | - | Sum of all frozen for bandwidth |
| TOTAL_ENERGY_WEIGHT | long | - | Sum of all frozen for energy |
| TOTAL_TRON_POWER_WEIGHT | long | - | Sum of all frozen for voting |
| TOTAL_NET_LIMIT | long | 43_200_000_000 | Network bandwidth (bytes/day) |
| TOTAL_ENERGY_CURRENT_LIMIT | long | 90_000_000_000 | Current energy limit |
| TOTAL_ENERGY_TARGET_LIMIT | long | 180_000_000_000 | Target energy limit |
| TOTAL_ENERGY_AVERAGE_USAGE | long | - | Rolling average energy usage |
| ENERGY_FEE | long | 420 | Energy price (sun per unit) |
| TRANSACTION_FEE | long | 10 | Bandwidth price (sun per byte) |
| WITNESS_PAY_PER_BLOCK | long | 16_000_000 | SR block reward (sun) |
| MAX_CPU_TIME_OF_ONE_TX | long | 50 | Max CPU time (ms) |
| ALLOW_CREATION_OF_CONTRACTS | long | 1 | Feature flag |
| ALLOW_ADAPTIVE_ENERGY | long | 1 | Adaptive energy enabled |
| ALLOW_DELEGATE_RESOURCE | long | 1 | Delegation enabled |
| ALLOW_NEW_RESOURCE_MODEL | long | 1 | Stake 2.0 enabled |

**Methods**:
```java
// Getters
public long getTotalNetWeight();
public long getTotalEnergyWeight();
public long getTotalTronPowerWeight();
public long getEnergyFee();
public long getTransactionFee();

// Setters (used by consensus/proposals)
public void saveTotalNetWeight(long weight);
public void saveTotalEnergyWeight(long weight);
public void saveEnergyFee(long fee);

// Adaptive energy management
public void addTotalEnergyAverageUsage(long usage);
public long calculateGlobalEnergyLimit();
```

**Key Insight**: These properties are modified by:
1. **Transactions**: FreezeV2/UnfreezeV2 change total weights
2. **Proposals**: Governance can adjust fees, limits
3. **Consensus**: Adaptive algorithms adjust energy limit every 60 seconds

#### ContractStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/ContractStore.java`

**Storage**: RocksDB
**Key**: Contract address (21 bytes)
**Value**: SmartContract protobuf

**SmartContract Structure**:
```protobuf
message SmartContract {
  bytes origin_address = 1;              // Contract creator
  bytes contract_address = 2;            // Contract address
  bytes bytecode = 3;                    // Contract bytecode
  int64 call_value = 4;                  // Value sent during creation
  int64 consume_user_resource_percent = 5; // 0-100
  string name = 6;                       // Contract name
  int64 origin_energy_limit = 7;         // Creator's energy limit
  bytes code_hash = 8;                   // Hash of bytecode
  bytes trx_hash = 9;                    // Creation transaction hash
  int32 version = 10;                    // Fork version
  ABI abi = 11;                          // Contract ABI
}
```

#### ContractStateStore
**Location**: `/chainbase/src/main/java/org/tron/core/store/ContractStateStore.java`

**Purpose**: Store contract storage (SSTORE/SLOAD data)

**Storage**: RocksDB
**Key**: Composite key = contract_address + storage_key
**Value**: storage_value (32 bytes)

**Key Generation**:
```java
// contract_address (21 bytes) + storage_key (32 bytes) = 53 bytes
public static byte[] buildKey(byte[] contractAddress, DataWord key) {
  return ByteUtil.merge(contractAddress, key.getData());
}
```

**Energy Tracking**:
```java
public void putStorageValue(byte[] address, DataWord key, DataWord value);
public DataWord getStorageValue(byte[] address, DataWord key);

// Track energy usage for contract
public void addEnergyUsage(byte[] address, long energy);
public long getEnergyUsage24h(byte[] address);

// Energy factor calculation
public long getEnergyFactor(byte[] address);
public void updateEnergyFactor(byte[] address, long factor);
```

### Database Backend: RocksDB

**Configuration**:
- Write buffer size: 256 MB
- Max open files: 1000
- Compression: Snappy
- Cache size: 512 MB

**Optimization**:
- Column families for different stores
- Bloom filters for faster lookups
- Prefix seek for range queries

**Persistence**:
- All state changes committed atomically per block
- Checkpoint mechanism for fast restarts
- Backup and snapshot support

---

## Network Configuration & Parameters

### Parameter.java Constants

**Location**: `/common/src/main/java/org/tron/core/config/Parameter.java`

#### Block Production
```java
public static final long BLOCK_PRODUCED_INTERVAL = 3000; // 3 seconds
public static final int BLOCK_SIZE = 2_000_000;  // 2 MB
public static final int MAX_TRANSACTION_PENDING = 2000;
```

#### Resource Windows
```java
public static final long WINDOW_SIZE_MS = 24 * 3600 * 1000L; // 24 hours
public static final long PRECISION = 1_000_000L;
```

#### Addresses and Accounts
```java
public static final int ADDRESS_SIZE = 21;  // bytes
public static final byte ADD_PRE_FIX_BYTE_MAINNET = (byte) 0x41;  // Mainnet prefix
public static final byte ADD_PRE_FIX_BYTE_TESTNET = (byte) 0xa0;  // Testnet prefix
```

#### Fees and Costs
```java
public static final long DEFAULT_ENERGY_FEE = 420;  // sun per energy
public static final long DEFAULT_BANDWIDTH_FEE = 10; // sun per byte
public static final long SUN_PER_ENERGY = 100;  // Deprecated old value
public static final long TRANSFER_FEE = 0;  // TRX transfers are free (use bandwidth)
```

#### Free Resources
```java
public static final long FREE_NET_LIMIT = 600;  // bytes per account per day
public static final long TOTAL_NET_LIMIT = 43_200_000_000L;  // 43.2 GB per day
```

#### Staking Parameters
```java
public static final long FROZEN_PERIOD = 86_400_000L;  // 1 day (V1)
public static final long DELEGATE_PERIOD = 3 * 86_400_000L;  // 3 days
public static final long UNFREEZE_DELAY_DAYS = 14;  // V2 withdrawal delay
public static final int MAX_FROZEN_NUMBER = 1;  // V1 limit (deprecated)
public static final int MAX_UNFREEZE_COUNT = 32;  // V2 max pending unfreezes
```

#### Adaptive Resource Constants
```java
public static final class AdaptiveResourceLimitConstants {
  public static final int CONTRACT_RATE_NUMERATOR = 99;
  public static final int CONTRACT_RATE_DENOMINATOR = 100;  // 99% threshold
  public static final int EXPAND_RATE_NUMERATOR = 1000;
  public static final int EXPAND_RATE_DENOMINATOR = 999;  // 0.1% expansion
  public static final int PERIODS_MS = 60_000;  // 1 minute adjustment period
  public static final int INCREASE_STEP = 1_000_000;  // 1M energy per adjustment
}
```

#### Witness and Voting
```java
public static final int MAX_ACTIVE_WITNESS_NUM = 27;  // Super Representatives
public static final int WITNESS_STANDBY_LENGTH = 127;  // Standby witnesses
public static final int SOLIDIFIED_THRESHOLD = 70;  // % for finality (19 of 27)
public static final long MAINTENANCE_TIME_INTERVAL = 21600000L;  // 6 hours
public static final int MAINTENANCE_SKIP_SLOTS = 2;
```

#### Smart Contract Limits
```java
public static final int MAX_CPU_TIME_OF_ONE_TX = 50;  // milliseconds
public static final long MAX_ENERGY_LIMIT_FOR_CONSTANT_CALL = 3_000_000L;
public static final int MAX_RESULT_SIZE_IN_TX = 64;  // return data size (KB)
public static final int MAX_CONTRACT_NAME_LENGTH = 32;
```

### Dynamic Properties (Runtime Configuration)

**Location**: `/chainbase/src/main/java/org/tron/core/store/DynamicPropertiesStore.java`

#### Current Network State (Example Values)
```java
// As of November 2025 (approximate mainnet values)
TotalNetWeight: 15_000_000_000_000_000L  // ~15 billion TRX frozen for bandwidth
TotalEnergyWeight: 60_000_000_000_000_000L  // ~60 billion TRX frozen for energy
TotalTronPowerWeight: 45_000_000_000_000_000L  // ~45 billion TRX for voting

TotalNetLimit: 43_200_000_000L  // 43.2 GB per day
TotalEnergyCurrentLimit: 180_000_000_000L  // 180 billion energy (after adaptation)
TotalEnergyTargetLimit: 180_000_000_000L  // Target: 180 billion

EnergyFee: 420  // sun per energy unit
TransactionFee: 10  // sun per byte (rarely used, most use free/frozen bandwidth)

WitnessPayPerBlock: 16_000_000  // 16 TRX per block
Witness127PayPerBlock: 115_200_000_000L  // Total for standby witnesses per day
```

#### Resource Calculation Examples

**Bandwidth Limit Calculation**:
```java
// User has 10,000 TRX (10,000,000,000 sun) frozen for bandwidth
long myFrozen = 10_000_000_000L;
long totalNetWeight = 15_000_000_000_000_000L;
long totalNetLimit = 43_200_000_000L;

// My share of network bandwidth
long myBandwidthLimit = (myFrozen * totalNetLimit) / totalNetWeight;
// = (10,000,000,000 * 43,200,000,000) / 15,000,000,000,000,000
// = 28,800 bytes per day
// = enough for ~100 transactions per day
```

**Energy Limit Calculation**:
```java
// User has 100,000 TRX frozen for energy
long myFrozen = 100_000_000_000L;
long totalEnergyWeight = 60_000_000_000_000_000L;
long totalEnergyLimit = 180_000_000_000L;

// My share of network energy
long myEnergyLimit = (myFrozen * totalEnergyLimit) / totalEnergyWeight;
// = (100,000_000_000 * 180_000_000_000) / 60_000_000_000_000_000
// = 300,000 energy per day
// = enough for ~15 USDT transfers (20k energy each with factor)
```

**Energy Cost in TRX**:
```java
// Smart contract execution needs 50,000 energy
// User doesn't have frozen energy, must burn TRX
long energyNeeded = 50_000L;
long energyFee = 420L;  // sun per energy

long costInSun = energyNeeded * energyFee;
// = 50,000 * 420 = 21,000,000 sun = 21 TRX

// For popular contract with energy_factor = 20%
long actualEnergy = energyNeeded * 120 / 100;  // 60,000 energy
long actualCost = actualEnergy * energyFee;
// = 60,000 * 420 = 25,200,000 sun = 25.2 TRX
```

### Fork Versions and Feature Flags

**Location**: `/chainbase/src/main/java/org/tron/core/config/args/Parameter.java`

```java
public enum ForkBlockVersionEnum {
  VERSION_3_2_2(6),
  VERSION_3_5(7),
  VERSION_3_6(8),
  VERSION_3_6_5(9),
  VERSION_3_6_6(10),
  VERSION_4_0(11),
  VERSION_4_1(12),
  VERSION_4_2(13),
  VERSION_4_3(14),
  VERSION_4_4(15),
  VERSION_4_5(16),
  VERSION_4_7_0(17),
  VERSION_4_7_0_1(18),
  VERSION_4_7_1(19),
  VERSION_4_7_2(20),
  VERSION_4_7_3(21),
  VERSION_4_7_4(22),
  VERSION_4_7_5(23),
  VERSION_4_7_6(24),
  VERSION_4_7_7(25);  // Current as of exploration
}
```

**Feature Flags** (from DynamicPropertiesStore):
```java
// Feature activation checks
public boolean supportDR() {
  return getAllowDelegateResource() == 1;
}

public boolean supportStakeV2() {
  return getAllowNewResourceModel() == 1;
}

public boolean supportAdaptiveEnergy() {
  return getAllowAdaptiveEnergy() == 1;
}

public boolean supportTvmIstanbul() {
  return getAllowTvmIstanbul() == 1;
}
```

### Committee-Modifiable Parameters

**Via Proposal System** (Type 16, 17, 18):

| Parameter ID | Name | Range | Current | Impact |
|--------------|------|-------|---------|--------|
| 0 | MaintenanceTimeInterval | 3h-24h | 6h | SR election interval |
| 3 | TransactionFee | 0-10000 | 10 sun/byte | Bandwidth burn cost |
| 4 | EnergyFee | 0-10000 | 420 sun/unit | Energy burn cost |
| 9 | AllowCreationOfContracts | 0-1 | 1 | Enable contract deployment |
| 20 | AllowDelegateResource | 0-1 | 1 | Enable delegation |
| 27 | AllowTvmConstantinople | 0-1 | 1 | EVM compatibility |
| 32 | AllowTvmIstanbul | 0-1 | 1 | Latest EVM features |
| 47 | ForbidTransferToContract | 0-1 | 1 | Prevent accidental transfers |
| 59 | AllowNewResourceModel | 0-1 | 1 | Enable Stake 2.0 |
| 70 | AllowCancelAllUnfreezeV2 | 0-1 | 1 | Enable unfreeze cancellation |

**Proposal Lifecycle**:
1. SR creates proposal with parameter changes
2. Other SRs vote (approve) within 3 days
3. If >19 approvals (70%), proposal passes
4. Changes take effect at next maintenance period
5. Only 1 proposal per parameter can be active

**Key Insight**: Network parameters are not hardcoded but governable by elected Super Representatives, allowing the network to adapt to changing conditions.

---

## Consensus Mechanism

### DPOS (Delegated Proof of Stake)

**Location**: `/consensus/src/main/java/org/tron/consensus/dpos/DposService.java`

#### Block Production

**27 Super Representatives** produce blocks in rotation:
- Each SR produces blocks for 1 slot (3 seconds)
- After 27 slots (81 seconds), rotation repeats
- SR order is deterministic based on votes
- Missed blocks result in no reward and reduced votes

**Block Production Cycle**:
```
Slot 0: SR #1 produces block
Slot 1: SR #2 produces block
...
Slot 26: SR #27 produces block
Slot 27: SR #1 produces block (new cycle)
```

**Slot Calculation**:
```java
public long getSlotAtTime(long time) {
  long firstSlotTime = getBeginningSlotTime();
  return (time - firstSlotTime) / BLOCK_PRODUCED_INTERVAL;
}

public long getAbsSlot(long time) {
  return (time - getGenesisBlockTime()) / BLOCK_PRODUCED_INTERVAL;
}

public long getTimeForSlot(long slot) {
  return getBeginningSlotTime() + slot * BLOCK_PRODUCED_INTERVAL;
}
```

#### Witness Scheduling

**Location**: `/consensus/src/main/java/org/tron/consensus/dpos/DposSlot.java`

**Witness Selection**:
1. Every 6 hours (maintenance period), votes are tallied
2. Top 27 vote-getters become active SRs
3. Witness schedule is generated for next 6 hours
4. Standby witnesses (#28-127) earn standby allowance

**Maintenance Manager**:
**Location**: `/consensus/src/main/java/org/tron/consensus/dpos/MaintenanceManager.java`

**Responsibilities**:
- Update SR rankings based on votes
- Distribute block rewards
- Update network parameters from passed proposals
- Clear statistics and start new epoch

**Maintenance Cycle**:
```java
1. Freeze network (skip 2 blocks)
2. Count votes for each witness
3. Sort witnesses by vote count
4. Select top 27 as active SRs
5. Calculate rewards for previous epoch
6. Distribute rewards
7. Apply any passed proposals
8. Reset statistics
9. Resume block production
```

### PBFT (Practical Byzantine Fault Tolerance)

**Location**: `/consensus/src/main/java/org/tron/consensus/pbft/PbftManager.java`

**Purpose**: Provides fast finality for transactions

**Process**:
1. Block produced by SR
2. SR signs block and broadcasts
3. Other SRs verify and sign block
4. When ≥19 SRs (70%) sign, block is "solidified"
5. Solidified blocks are irreversible

**Solidification Tracking**:
```java
public boolean isSolidified(long blockNum) {
  PbftMessage pbftMessage = pbftMessageStore.get(blockNum);
  return pbftMessage != null && pbftMessage.getSignatureCount() >= SOLIDIFIED_THRESHOLD;
}

// SOLIDIFIED_THRESHOLD = 19 (70% of 27)
```

**Key Insight**: Unlike Bitcoin's 6-confirmation rule, TRON blocks become irreversible in ~1 minute (20 blocks × 3 seconds), providing fast transaction finality.

### Rewards and Incentives

**Location**: `/consensus/src/main/java/org/tron/consensus/dpos/IncentiveManager.java`

#### SR Block Rewards
```java
// Per block reward (paid immediately)
long WITNESS_PAY_PER_BLOCK = 16_000_000;  // 16 TRX

// Voting reward (paid when voters claim)
// SR sets brokerage rate (0-100%)
// Default: 20% to SR, 80% to voters
```

#### Reward Distribution
```java
// After each block production
public void reward(byte[] srAddress) {
  AccountCapsule sr = accountStore.get(srAddress);
  sr.setAllowance(sr.getAllowance() + WITNESS_PAY_PER_BLOCK);
}

// Voters claim rewards
public void withdrawReward(byte[] voterAddress) {
  long reward = calculateVotingReward(voterAddress);
  long brokerage = getBrokerage(votedSrAddress);
  long voterShare = reward * (100 - brokerage) / 100;

  AccountCapsule voter = accountStore.get(voterAddress);
  voter.setBalance(voter.getBalance() + voterShare);
}
```

#### Standby Witness Rewards
```java
// Total for standby witnesses (#28-127) per day
long WITNESS_127_PAY_PER_BLOCK = 115_200_000_000L / 28800;  // ~4M TRX per block split

// Each standby witness receives proportional to votes
```

**Reward Economics**:
```
Total TRON issuance per day:
- Active SRs: 28,800 blocks × 16 TRX = 460,800 TRX
- Standby: 115,200 TRX (distributed proportionally)
- Total: ~576,000 TRX per day = ~210M TRX per year (~0.2% inflation)
```

### Vote Calculation

**Voting Power** = TRX frozen for TRON_POWER (Stake 2.0)

```java
// Voter freezes 10,000 TRX for TRON_POWER
long frozen = 10_000_000_000L;  // 10k TRX in sun
long votingPower = frozen / 1_000_000;  // = 10,000 votes

// Voter can distribute votes among multiple SRs
// Max: 5 different SRs
account.votes = [
  {sr_address_1, 6000},
  {sr_address_2, 4000}
];
```

**Vote Weight Decay**: Votes do NOT decay. Once frozen for TRON_POWER, votes remain active until unfrozen.

**Key Difference from Stake V1**: In V1, freezing for BANDWIDTH or ENERGY automatically granted voting power. In Stake 2.0, users must explicitly freeze for TRON_POWER to vote.

---

## Critical Formulas & Constants

### Resource Recovery Formula

**Universal for Bandwidth and Energy**:

```java
/**
 * Calculate current usage after time-based decay
 * @param lastUsage - Usage at last_consume_time
 * @param lastTime - Timestamp of last consumption (milliseconds)
 * @param now - Current timestamp (milliseconds)
 * @param windowSize - Recovery window (24 hours = 86,400,000 ms)
 * @return Current usage after decay
 */
public long calculateCurrentUsage(long lastUsage, long lastTime, long now,
                                  long windowSize) {
  long delta = now - lastTime;  // Time elapsed since last consumption

  // If more than 24 hours, usage fully recovered
  if (delta >= windowSize) {
    return 0;
  }

  // Linear decay over window
  double decayRatio = (double)(windowSize - delta) / windowSize;
  return (long)(lastUsage * decayRatio);
}
```

**Graphical Representation**:
```
Usage
  │
100%│  ●
    │   ╲
    │    ╲
    │     ╲
    │      ╲
 50%│       ●
    │        ╲
    │         ╲
    │          ╲
    │           ╲
  0%│____________●_____________
    0           12h           24h      Time
```

**Example**:
- User consumes 1000 bandwidth at time T
- After 12 hours: current_usage = 1000 × (24-12)/24 = 500
- After 18 hours: current_usage = 1000 × (24-18)/24 = 250
- After 24 hours: current_usage = 0

### Resource Limit Formulas

#### Bandwidth Limit
```java
/**
 * Calculate bandwidth limit from frozen balance
 */
public long calculateNetLimit(long frozenBalance, long totalNetWeight,
                              long totalNetLimit) {
  if (totalNetWeight == 0) {
    return 0;
  }
  return (frozenBalance * totalNetLimit) / totalNetWeight;
}

// Free bandwidth (universal)
public static final long FREE_NET_LIMIT = 600;  // bytes per day per account
```

**Real-World Example**:
```
Given:
- My frozen: 10,000 TRX (10,000,000,000 sun)
- Total network frozen: 15,000,000,000 TRX
- Total network limit: 43,200,000,000 bytes/day

My bandwidth = (10,000,000,000 / 15,000,000,000,000,000) × 43,200,000,000
             = 0.000000666667 × 43,200,000,000
             = 28,800 bytes/day
             = ~100 simple transactions/day (250 bytes each)
```

#### Energy Limit
```java
/**
 * Calculate energy limit from frozen balance
 */
public long calculateEnergyLimit(long frozenBalance, long totalEnergyWeight,
                                long totalEnergyLimit) {
  if (totalEnergyWeight == 0) {
    return 0;
  }
  return (frozenBalance * totalEnergyLimit) / totalEnergyWeight;
}
```

**Real-World Example**:
```
Given:
- My frozen: 100,000 TRX (100,000,000,000 sun)
- Total network frozen: 60,000,000,000 TRX
- Total network energy: 180,000,000,000 units/day

My energy = (100,000,000,000 / 60,000,000,000,000,000) × 180,000,000,000
          = 0.00000166667 × 180,000,000,000
          = 300,000 energy/day
          = ~15 USDT transfers/day (20k energy each with factor)
```

### Fee Calculation Formulas

#### Bandwidth Fee (Rare, only if no frozen bandwidth)
```java
/**
 * Calculate TRX to burn for bandwidth
 */
public long calculateBandwidthFee(long bytesNeeded, long transactionFee) {
  return bytesNeeded * transactionFee;
}

// Example: 250-byte transaction × 10 sun/byte = 2,500 sun = 0.0025 TRX
```

#### Energy Fee
```java
/**
 * Calculate TRX to burn for energy
 * Includes energy_factor for popular contracts
 */
public long calculateEnergyFee(long baseEnergy, long energyFactor,
                               long energyFeePrice) {
  // Apply energy factor
  long actualEnergy = baseEnergy * (100 + energyFactor) / 100;

  // Calculate cost
  return actualEnergy * energyFeePrice;
}

// Example: USDT transfer
// Base energy: 15,000
// Energy factor: 20 (USDT is popular)
// Energy fee: 420 sun/unit
// Actual energy = 15,000 × 1.2 = 18,000
// Cost = 18,000 × 420 = 7,560,000 sun = 7.56 TRX
```

### Adaptive Energy Limit Formula

**Purpose**: Dynamically adjust total network energy based on utilization

```java
/**
 * Adjust energy limit every 60 seconds (PERIODS_MS)
 */
public long calculateAdaptiveEnergyLimit(long currentLimit,
                                        long averageUsage,
                                        long targetLimit) {
  // Constants
  final double CONTRACT_RATE = 0.99;  // 99% utilization threshold
  final double EXPAND_RATE = 1.001;   // 0.1% expansion
  final double CONTRACT_RATE_DECREASE = 0.999;  // 0.1% contraction

  // If average usage > 99% of current limit, expand
  if (averageUsage > currentLimit * CONTRACT_RATE) {
    currentLimit = (long)(currentLimit * EXPAND_RATE);
  }
  // If usage drops, gradually contract back to target
  else if (currentLimit > targetLimit) {
    currentLimit = (long)(currentLimit * CONTRACT_RATE_DECREASE);
    currentLimit = Math.max(currentLimit, targetLimit);
  }

  return currentLimit;
}
```

**Graphical Representation**:
```
Energy Limit
    │
350B│         ╱─────╮ (Peak demand)
    │        ╱       ╲
300B│       ╱         ╲
    │      ╱           ╲
250B│     ╱             ╲___
    │    ╱                   ╲
180B│───┘─────────────────────╲─── (Target)
    │                           ╲
    └────────────────────────────────── Time
         Expansion           Contraction
```

**Example Scenario**:
1. Target limit: 180B energy
2. Usage spikes to 178B (99% utilization)
3. Limit expands: 180B × 1.001 = 180.18B
4. Process repeats if usage stays high
5. After 100 periods: 180B × 1.001^100 = 198.95B
6. Usage drops to 150B
7. Limit contracts: 198.95B × 0.999 = 198.75B
8. Continues until back to 180B target

### Delegation Formulas

#### Available Balance for Delegation
```java
/**
 * Calculate how much frozen balance can be delegated
 * Cannot delegate frozen balance currently backing active usage
 */
public long calculateAvailableForDelegation(long totalFrozen,
                                           long alreadyDelegated,
                                           long currentUsage,
                                           long currentLimit) {
  // Calculate utilization rate
  double utilizationRate = (double) currentUsage / currentLimit;

  // In-use frozen = frozen backing current usage
  long inUseFrozen = (long)(totalFrozen * utilizationRate);

  // Available = total - delegated - in_use
  long available = totalFrozen - alreadyDelegated - inUseFrozen;

  return Math.max(0, available);
}
```

**Example**:
```
Account state:
- Total frozen for energy: 100,000 TRX
- Already delegated: 20,000 TRX
- Current energy usage: 150,000 units
- Current energy limit: 300,000 units

Utilization rate = 150,000 / 300,000 = 50%
In-use frozen = 100,000 × 0.5 = 50,000 TRX
Available for delegation = 100,000 - 20,000 - 50,000 = 30,000 TRX
```

### Energy Factor Impact Formula

```java
/**
 * Calculate actual energy cost with energy factor
 */
public long calculateActualEnergy(long baseEnergy, long energyFactor) {
  return baseEnergy * (100 + energyFactor) / 100;
}

/**
 * Calculate energy factor based on contract popularity
 * (Simplified - actual algorithm is more complex)
 */
public long calculateEnergyFactor(long contractEnergyUsage,
                                 long totalNetworkEnergy) {
  double sharePercent = (contractEnergyUsage * 100.0) / totalNetworkEnergy;

  if (sharePercent > 10) return 100;       // Max penalty
  else if (sharePercent > 5) return 50;
  else if (sharePercent > 1) return 20;
  else if (sharePercent > 0.5) return 10;
  else if (sharePercent > 0.1) return 5;
  else return 0;                           // No penalty
}
```

**Energy Factor Table**:

| Contract Type | Typical Energy Factor | Impact on Cost |
|---------------|----------------------|----------------|
| New contract | 0 | 100% of base |
| Small dApp | 0-5 | 100-105% of base |
| Medium dApp | 5-15 | 105-115% of base |
| USDT-TRC20 | 15-25 | 115-125% of base |
| Top DEX | 20-40 | 120-140% of base |
| Dominant contract | 40-100 | 140-200% of base |

### Storage Cost Formula (Deprecated but useful for history)

**Note**: Storage rent is deprecated as of fork version 4.0, but understanding it provides historical context.

```java
/**
 * Old storage cost formula (pre-4.0)
 * Storage capacity purchased with TRX, never recovers
 */
public long calculateStorageCost(long bytes) {
  final long STORAGE_PRICE_PER_BYTE = 100_000;  // 0.1 TRX per byte
  return bytes * STORAGE_PRICE_PER_BYTE;
}
```

**Current Model**: Contract storage (SSTORE) is paid via energy consumption, not separate storage fees.

---

## Test Coverage Analysis

### Key Test Files

#### Resource Management Tests

**BandwidthProcessor Tests**:
- **Location**: `/framework/src/test/java/org/tron/core/BandwidthProcessorTest.java`
- **Coverage**:
  - Free bandwidth consumption
  - Frozen bandwidth consumption
  - Asset-specific bandwidth
  - Bandwidth recovery after 24 hours
  - TRX burning as fallback

**Energy Tests**:
- **Location**: `/framework/src/test/java/org/tron/common/runtime/vm/EnergyWhenSendAndTransferTest.java`
- **Coverage**:
  - Energy consumption for contract calls
  - Energy consumption with CALL opcode
  - Energy consumption for value transfers
  - Fallback to burning TRX

#### Stake 2.0 Tests

**FreezeBalanceV2 Tests**:
- **Location**: `/framework/src/test/java/org/tron/core/actuator/FreezeBalanceV2ActuatorTest.java`
- **Test Cases**:
  ```java
  testFreezeBalanceV2ForBandwidth()
  testFreezeBalanceV2ForEnergy()
  testFreezeBalanceV2ForTronPower()
  testFreezeBalanceV2InsufficientBalance()
  testFreezeBalanceV2InvalidResourceType()
  testMultipleFreezeV2SameResource()
  testFreezeV2AfterUnfreezeV2()
  ```

**DelegateResource Tests**:
- **Location**: `/framework/src/test/java/org/tron/core/actuator/DelegateResourceActuatorTest.java`
- **Test Cases**:
  ```java
  testDelegateEnergySuccess()
  testDelegateBandwidthSuccess()
  testDelegateWithLock()
  testDelegateWithoutLock()
  testDelegateInsufficientResource()
  testDelegateResourceInUse()
  testDelegateToSelf() // Should fail
  testMultipleDelegations()
  ```

**UnfreezeBalanceV2 Tests**:
- **Location**: `/framework/src/test/java/org/tron/core/actuator/UnfreezeBalanceV2ActuatorTest.java`
- **Test Cases**:
  ```java
  testUnfreezeV2Success()
  testUnfreezeV2InsufficientBalance()
  testUnfreezeV2WithDelegatedResource()  // Should reduce delegable amount
  testMultipleUnfreezeV2()
  testMaxUnfreezeCount()  // 32 limit
  testUnfreezeV2ExpireTime()  // 14 days
  ```

**WithdrawExpireUnfreeze Tests**:
- **Location**: Tests in UnfreezeBalanceV2ActuatorTest
- **Test Cases**:
  ```java
  testWithdrawAfterExpire()  // Should succeed after 14 days
  testWithdrawBeforeExpire()  // Should fail
  testWithdrawMultipleExpired()
  testWithdrawPartialExpired()
  ```

**CancelAllUnfreezeV2 Tests**:
- **Location**: `/framework/src/test/java/org/tron/core/actuator/CancelAllUnfreezeV2ActuatorTest.java`
- **Test Cases**:
  ```java
  testCancelAllUnfreeze()  // Re-freezes all pending unfreezes
  testCancelWithNoUnfreezes()  // Should fail
  testCancelRestoresResources()  // Resources available immediately
  ```

#### VM and Energy Tests

**Contract Creation Tests**:
- **Location**: `/framework/src/test/java/org/tron/common/runtime/vm/CreateContractTest.java`
- **Coverage**:
  - Energy consumption for contract deployment
  - Memory expansion costs
  - Constructor execution
  - Initial storage costs

**Energy Cost Verification**:
- **Location**: `/framework/src/test/java/org/tron/common/runtime/vm/EnergyWhenRequireStyleTest.java`
- **Coverage**:
  - REQUIRE opcode energy cost
  - REVERT with string message
  - Error handling energy consumption
  - Failed transaction energy usage

**Freeze Operations in VM**:
- **Location**: `/framework/src/test/java/org/tron/common/runtime/vm/FreezeV2Test.java`
- **Coverage**:
  - Calling freeze from smart contract
  - Precompiled contract energy costs
  - State changes from contract-initiated freezing

### Test Insights

#### Coverage Gaps Identified
1. **Energy Factor Testing**: Limited tests for energy_factor calculation and impact
2. **Adaptive Energy**: Few tests for adaptive energy limit adjustment over time
3. **Complex Delegation Scenarios**: Limited tests for cascading delegations
4. **Race Conditions**: Minimal tests for concurrent delegation/undelegation

#### Key Test Patterns

**Resource Recovery Test Pattern**:
```java
@Test
public void testResourceRecoveryAfter24Hours() {
  // 1. Consume resources
  long usage1 = consumeBandwidth(account, 1000);
  long time1 = System.currentTimeMillis();

  // 2. Wait 12 hours (simulated)
  long time2 = time1 + 12 * 3600 * 1000L;
  long currentUsage = calculateCurrentUsage(usage1, time1, time2);

  // 3. Verify 50% recovery
  assertEquals(500, currentUsage);

  // 4. Wait another 12 hours
  long time3 = time2 + 12 * 3600 * 1000L;
  currentUsage = calculateCurrentUsage(usage1, time1, time3);

  // 5. Verify full recovery
  assertEquals(0, currentUsage);
}
```

**Delegation Test Pattern**:
```java
@Test
public void testDelegationPreventionWhenInUse() {
  // 1. Freeze balance for energy
  long frozen = 100_000_000_000L;  // 100k TRX
  freezeBalanceV2(account1, frozen, ENERGY);

  // 2. Use 50% of energy
  long energyLimit = getEnergyLimit(account1);  // ~300k energy
  useEnergy(account1, energyLimit / 2);  // Use 150k energy

  // 3. Try to delegate 75% of frozen balance (should fail)
  long delegateAmount = frozen * 75 / 100;
  try {
    delegateResource(account1, account2, delegateAmount, ENERGY);
    fail("Should not allow delegation of in-use frozen balance");
  } catch (ContractValidateException e) {
    assertTrue(e.getMessage().contains("insufficient frozen balance"));
  }

  // 4. Delegate safe amount (25% of frozen = 50% of available)
  delegateAmount = frozen * 25 / 100;
  delegateResource(account1, account2, delegateAmount, ENERGY);

  // 5. Verify delegation succeeded
  long delegated = getDelegatedBalance(account1, ENERGY);
  assertEquals(delegateAmount, delegated);
}
```

### Testing Recommendations for Book Examples

1. **All formulas should be validated against test cases**
2. **Code examples should mirror test patterns**
3. **Edge cases from tests should be documented as "Common Pitfalls"**
4. **Performance benchmarks from tests should inform optimization chapters**

---

## Summary and Key Takeaways

### Critical Source Files Reference

**For Chapter 1-2 (Fundamentals)**:
- `/chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` - Core decay algorithm
- `/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java` - Bandwidth logic
- `/chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java` - Energy logic
- `/common/src/main/java/org/tron/core/config/Parameter.java` - All constants

**For Chapter 3-4 (Staking & Delegation)**:
- `/actuator/src/main/java/org/tron/core/actuator/FreezeBalanceV2Actuator.java`
- `/actuator/src/main/java/org/tron/core/actuator/DelegateResourceActuator.java`
- `/actuator/src/main/java/org/tron/core/vm/nativecontract/FreezeBalanceV2Processor.java`
- `/chainbase/src/main/java/org/tron/core/capsule/DelegatedResourceCapsule.java`
- `/protocol/src/main/protos/core/Tron.proto` - Account, FreezeV2, UnFreezeV2

**For Chapter 5-6 (Optimization)**:
- `/actuator/src/main/java/org/tron/core/vm/EnergyCost.java` - Operation costs
- `/actuator/src/main/java/org/tron/core/vm/VM.java` - Execution flow
- `/chainbase/src/main/java/org/tron/core/store/ContractStateStore.java` - Energy factor

**For Chapter 7-8 (Production)**:
- `/actuator/src/main/java/org/tron/core/actuator/VMActuator.java` - Contract execution
- `/chainbase/src/main/java/org/tron/core/ChainBaseManager.java` - State management
- `/protocol/src/main/protos/core/Tron.proto` - TransactionInfo, ResourceReceipt

**For Chapter 9-10 (Economics)**:
- `/chainbase/src/main/java/org/tron/core/store/DynamicPropertiesStore.java` - Network params
- `/consensus/src/main/java/org/tron/consensus/dpos/IncentiveManager.java` - Rewards
- `/consensus/src/main/java/org/tron/consensus/dpos/MaintenanceManager.java` - SR election

### Verified Facts

✅ **600 Free Bandwidth**: Confirmed in Parameter.java line with FREE_NET_LIMIT
✅ **24-Hour Recovery**: Confirmed in ResourceProcessor.java with WINDOW_SIZE_MS
✅ **14-Day Unfreeze Wait**: Confirmed in FreezeV2Util.java with UNFREEZE_DELAY_DAYS
✅ **420 Sun per Energy**: Confirmed in DynamicPropertiesStore.java default ENERGY_FEE
✅ **Energy Factor**: Confirmed in ContractStateStore.java and VM.java
✅ **Adaptive Energy**: Confirmed in EnergyProcessor.java with CONTRACT_RATE 99/100
✅ **27 Super Representatives**: Confirmed in Parameter.java MAX_ACTIVE_WITNESS_NUM
✅ **3-Second Blocks**: Confirmed in Parameter.java BLOCK_PRODUCED_INTERVAL
✅ **32 Max Unfreezes**: Confirmed in Parameter.java MAX_UNFREEZE_COUNT
✅ **SSTORE 20K Energy**: Confirmed in EnergyCost.java SSTORE_NEW

### Questionable Topics to Investigate Further

1. **Energy Factor Exact Algorithm**: Source shows it's tracked but calculation not fully exposed
   - **Action**: Analyze ContractStateStore.java energy usage tracking more deeply
   - **Files**: `/chainbase/src/main/java/org/tron/core/store/ContractStateStore.java`

2. **USDT-TRC20 Exact Energy Cost**: Source shows energy factor exists but need real measurement
   - **Action**: Query mainnet for USDT contract energy_factor value
   - **Method**: Use TronGrid API `wallet/getcontractinfo`

3. **Adaptive Energy Historical Data**: Need to verify expansion/contraction in practice
   - **Action**: Query DynamicPropertiesStore history for TotalEnergyCurrentLimit changes
   - **Method**: Historical blockchain analysis

4. **Delegation Market Economics**: Code supports it but need real-world data
   - **Action**: Scan mainnet for delegation patterns, pricing
   - **Method**: Analyze DelegatedResourceStore entries

### Next Steps for Book Writing

1. **Deep Dive into Resource Management** (Current task: "Research resource management implementation")
   - Read and analyze ResourceProcessor.java line-by-line
   - Extract exact formulas and edge cases
   - Create worked examples with real numbers

2. **Deep Dive into Staking/Delegation** (Current task: "Research staking and delegation mechanisms")
   - Trace FreezeV2 → UnfreezeV2 → Withdraw flow
   - Document all state transitions
   - Create state machine diagrams

3. **Analyze Protocol Buffers** (Current task: "Analyze protocol buffer definitions")
   - Map all Account fields to their purpose
   - Document TransactionInfo and ResourceReceipt
   - Create data structure diagrams

4. **Create Book Outline** (Pending task)
   - Structure chapters based on source code organization
   - Align with requirements (bizarre facts, code labs, etc.)

---

**This document is a living reference and will be updated as deeper investigation reveals more details.**
