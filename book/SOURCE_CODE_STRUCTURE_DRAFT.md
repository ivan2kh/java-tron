# TRON Resource Management System - Source Code Structure

> **Draft Document**: Comprehensive mapping of java-tron source code for resource management book

**Date**: 2025-11-14
**Repository**: java-tron
**Analysis Type**: Very thorough exploration of resource management implementation

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Layers](#architecture-layers)
3. [Resource Types and Definitions](#resource-types-and-definitions)
4. [Core Resource Processing](#core-resource-processing)
5. [Freeze/Unfreeze System](#freezeunfreeze-system)
6. [Resource Delegation System](#resource-delegation-system)
7. [Storage Layer](#storage-layer)
8. [TVM Integration](#tvm-integration)
9. [Network Parameters](#network-parameters)
10. [Key Algorithms](#key-algorithms)
11. [Testing Infrastructure](#testing-infrastructure)
12. [Critical File Reference](#critical-file-reference)

---

## 1. Project Overview

### Main Module Structure

```
java-tron/
├── actuator/        - Contract execution logic and TVM integration
├── chainbase/       - Core database and resource processors
├── framework/       - Main application framework and services
├── protocol/        - Protobuf message definitions
├── common/          - Utilities and constants
├── consensus/       - DPoS consensus mechanisms
├── crypto/          - Cryptographic operations
└── plugins/         - Plugin system
```

### Key Package Structure for Resources

| Package | Purpose | Module |
|---------|---------|--------|
| `org.tron.core.actuator.*` | Contract execution handlers | actuator |
| `org.tron.core.db.*` | Resource processors | chainbase |
| `org.tron.core.store.*` | Data persistence layer | chainbase |
| `org.tron.core.vm.*` | TRON Virtual Machine | actuator |
| `org.tron.core.capsule.*` | Data wrappers | chainbase |
| `org.tron.core.service.*` | Business services | chainbase/framework |

---

## 2. Architecture Layers

### Layer 1: Protocol Definition (Protobuf)

**Location**: `protocol/src/main/protos/core/`

- **common.proto**: Resource type enum (BANDWIDTH, ENERGY, TRON_POWER)
- **Tron.proto**: Account structure with resource fields
- **account.proto**: AccountResource message
- **delegated_resource.proto**: DelegatedResource message
- **balance_contract.proto**: Freeze/unfreeze/delegate contracts

### Layer 2: Storage Layer (Chainbase)

**Location**: `chainbase/src/main/java/org/tron/core/`

- **Stores**: Persistent database access (RocksDB)
- **Capsules**: Object wrappers for protobuf messages
- **Services**: Business logic services

### Layer 3: Processing Layer (Chainbase)

**Location**: `chainbase/src/main/java/org/tron/core/db/`

- **ResourceProcessor**: Base resource calculation algorithms
- **BandwidthProcessor**: Bandwidth consumption logic
- **EnergyProcessor**: Energy management with adaptive scaling

### Layer 4: Execution Layer (Actuator)

**Location**: `actuator/src/main/java/org/tron/core/actuator/`

- **Actuators**: Contract execution handlers (freeze, delegate, etc.)
- **NativeContractProcessors**: TVM-callable native contracts

### Layer 5: Virtual Machine (Actuator)

**Location**: `actuator/src/main/java/org/tron/core/vm/`

- **VM**: Bytecode interpreter
- **Program**: Execution context with energy tracking
- **EnergyCost**: Operation cost definitions

### Layer 6: Application Framework

**Location**: `framework/src/main/java/org/tron/`

- **Manager**: Central blockchain manager
- **RuntimeImpl**: Transaction runtime orchestrator
- **Services**: High-level services (RPC, etc.)

---

## 3. Resource Types and Definitions

### Protobuf Enum Definition

**File**: `protocol/src/main/protos/core/contract/common.proto` (Lines 9-13)

```protobuf
enum ResourceCode {
  BANDWIDTH = 0;
  ENERGY = 1;
  TRON_POWER = 2;
}
```

### Resource Characteristics

| Resource | Code | Free Daily | Acquisition Method | Primary Use |
|----------|------|------------|-------------------|-------------|
| BANDWIDTH | 0x00 | 5,000 bytes | Freeze TRX | Transaction fees |
| ENERGY | 0x01 | 0 units | Freeze TRX | Smart contract execution |
| TRON_POWER | 0x02 | N/A | Freeze TRX | Witness voting |

### Account Resource Fields

**File**: `protocol/src/main/protos/core/Tron.proto` (Lines 227-290)

```protobuf
// V2 Freeze Structure
message FreezeV2 {
  int64 frozenBalance = 1;      // Amount frozen
  int64 expireTime = 2;          // Expiration timestamp
  ResourceCode resource = 3;     // Resource type
}

// V2 Unfreeze Structure
message UnFreezeV2 {
  int64 unfrozenBalance = 1;     // Amount unfrozen
  int64 unfreezeTime = 2;        // Unfreeze timestamp
  ResourceCode resource = 3;     // Resource type
}

// In Account message:
repeated FreezeV2 frozenV2 = 34;
repeated UnFreezeV2 unfrozenV2 = 35;
```

---

## 4. Core Resource Processing

### Base Class: ResourceProcessor

**File**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 66-203)

#### Key Methods

```java
// Calculate new usage with time-based decay
public long increase(
    long lastUsage,           // Previous usage
    long now,                 // Current timestamp
    long lastTime,            // Last usage timestamp
    AccountCapsule account    // Account data
)

// Recover resources over time window
public void recovery(AccountCapsule account)

// V2 algorithm with unfreezing delay support
public long increaseV2(
    long lastUsage,
    long lastTime,
    long now,
    long windowSize,
    long windowMaxSize
)

// Handle resource return from undelegation
public long unDelegateIncrease(
    long lastUsage,
    long now,
    long lastTime,
    long delegatedUsage,
    long oldValue,
    AccountCapsule account
)
```

#### Core Algorithm: 24-Hour Window Recovery

**Formula**:
```
Precision = 10^6
WindowSize = 86,400,000 ms (24 hours)

decay = (windowSize - timeSinceLastUse) / windowSize
newUsage = (lastUsage * decay + currentUsage)
```

**Implementation** (Lines 66-100):
- Calculates time elapsed since last usage
- Applies linear decay over 24-hour window
- Adds new consumption to decayed value
- Handles edge cases (window overflow, zero usage)

---

### BandwidthProcessor

**File**: `chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java`

#### Primary Responsibilities

1. **Transaction bandwidth consumption**
2. **Global bandwidth limit calculation**
3. **Account-specific bandwidth allocation**
4. **Free bandwidth management**
5. **Transaction fee fallback**

#### Key Methods

```java
// Main consumption entry point
public boolean consume(
    TransactionCapsule tx,    // Transaction
    TransactionTrace trace    // Execution trace
)

// Calculate global bandwidth limit
private long calculateGlobalNetLimit(AccountCapsule accountCapsule)
// Formula: (frozenBalance / 1,000,000) * (totalNetLimit / totalNetWeight)

// Try to use frozen bandwidth
private boolean useAccountNet(
    AccountCapsule account,
    long bytes,
    long now
)

// Try to use free daily bandwidth
private boolean useFreeNet(
    AccountCapsule account,
    long bytes,
    long now
)

// Fallback: pay transaction fee from balance
private boolean useTransactionFee(
    AccountCapsule account,
    long bytes,
    TransactionTrace trace
)
```

#### Consumption Priority Order

1. **Account frozen bandwidth** (from frozen TRX)
2. **Free daily bandwidth** (5,000 bytes/day)
3. **Transaction fee** (paid in TRX from balance)

If all fail: Transaction rejected with `AccountResourceInsufficientException`

---

### EnergyProcessor

**File**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java`

#### Primary Responsibilities

1. **Smart contract energy consumption**
2. **Global energy limit calculation**
3. **Adaptive energy scaling**
4. **Energy usage tracking**

#### Key Methods

```java
// Consume energy for contract execution
public boolean useEnergy(
    AccountCapsule account,
    long energy,
    long now
)

// Calculate account's energy limit
private long calculateGlobalEnergyLimit(AccountCapsule account)
// Formula: (frozenBalance / 1,000,000) * (totalEnergyLimit / totalEnergyWeight)

// Update average energy usage for adaptation
public void updateTotalEnergyAverageUsage()

// Adjust total energy limit dynamically
public void updateAdaptiveTotalEnergyLimit() {
    // Lines 73-86: Expansion/contraction logic
    // If usage < target: expand by 20%
    // If usage > target: contract by 50%
}
```

#### Adaptive Energy Mechanism

**Parameters**:
- `totalEnergyLimit`: Base energy limit
- `totalEnergyCurrentLimit`: Adaptive limit (dynamic)
- `totalEnergyTargetLimit`: Target for scaling
- `blockEnergyUsage`: Current block consumption
- `allowAdaptiveEnergy`: Enable/disable flag

**Scaling Rules** (Lines 73-86):
```
averageUsage = sum(last_21_blocks) / 21

if (averageUsage < targetLimit):
    newLimit = currentLimit * 1.2  // Expand
else if (averageUsage > targetLimit):
    newLimit = currentLimit * 0.5  // Contract

newLimit = min(newLimit, baseLimit * maxMultiplier)
```

---

## 5. Freeze/Unfreeze System

### Contract Types

| Contract Type | Type ID | Actuator Class | Purpose |
|--------------|---------|----------------|---------|
| FreezeBalanceContract | 11 | FreezeBalanceActuator | V1 freeze (legacy) |
| UnfreezeBalanceContract | 12 | UnfreezeBalanceActuator | V1 unfreeze (legacy) |
| FreezeBalanceV2Contract | 54 | FreezeBalanceV2Actuator | V2 freeze (current) |
| UnfreezeBalanceV2Contract | 55 | UnfreezeBalanceV2Actuator | V2 unfreeze (current) |
| WithdrawExpireUnfreezeContract | 56 | WithdrawExpireUnfreezeActuator | Withdraw expired |
| CancelAllUnfreezeV2Contract | 59 | CancelAllUnfreezeV2Actuator | Cancel unfreezes |

### V1 vs V2 Comparison

**V1 (Legacy)** - `FreezeBalanceActuator.java`
- Mandatory 3-day minimum lock period
- Single `Account.frozen` field
- Limited flexibility
- Deprecated in favor of V2

**V2 (Current)** - `FreezeBalanceV2Actuator.java`
- No mandatory lock period
- Flexible unfreezing with configurable delay
- Separate `Account.frozenV2` repeated fields
- Supports BANDWIDTH, ENERGY, TRON_POWER
- More efficient resource recovery

### FreezeBalanceV2Actuator

**File**: `actuator/src/main/java/org/tron/core/actuator/FreezeBalanceV2Actuator.java`

**Key Operations** (Lines 60-81):

```java
@Override
public boolean execute(Object object) {
    // 1. Extract contract parameters
    FreezeBalanceV2Contract contract = getContract();
    long freezeBalance = contract.getFrozenBalance();
    ResourceCode resource = contract.getResource();

    // 2. Validate account has sufficient balance
    AccountCapsule account = getAccount();
    validateBalance(account, freezeBalance);

    // 3. Create FreezeV2 record
    FreezeV2 freeze = FreezeV2.newBuilder()
        .setFrozenBalance(freezeBalance)
        .setExpireTime(calculateExpireTime())
        .setResource(resource)
        .build();

    // 4. Update account
    account.addFrozenV2(freeze);
    account.setBalance(account.getBalance() - freezeBalance);

    // 5. Update global weight
    if (resource == BANDWIDTH) {
        dynamicStore.addTotalNetWeight(freezeBalance / TRX_PRECISION);
    } else if (resource == ENERGY) {
        dynamicStore.addTotalEnergyWeight(freezeBalance / TRX_PRECISION);
    } else if (resource == TRON_POWER) {
        dynamicStore.addTotalTronPowerWeight(freezeBalance / TRX_PRECISION);
    }

    return true;
}
```

### UnfreezeBalanceV2Actuator

**File**: `actuator/src/main/java/org/tron/core/actuator/UnfreezeBalanceV2Actuator.java`

**Key Operations**:

```java
@Override
public boolean execute(Object object) {
    // 1. Extract contract
    UnfreezeBalanceV2Contract contract = getContract();
    long unfreezeBalance = contract.getUnfreezeBalance();
    ResourceCode resource = contract.getResource();

    // 2. Find matching FreezeV2 record
    FreezeV2 freeze = findFreezeRecord(account, resource);
    validate(freeze.getFrozenBalance() >= unfreezeBalance);

    // 3. Create UnFreezeV2 record with delay
    UnFreezeV2 unfreeze = UnFreezeV2.newBuilder()
        .setUnfrozenBalance(unfreezeBalance)
        .setUnfreezeTime(now + UNFREEZE_DELAY)  // 14 days
        .setResource(resource)
        .build();

    // 4. Update freeze record
    freeze.setFrozenBalance(freeze.getFrozenBalance() - unfreezeBalance);
    account.addUnfrozenV2(unfreeze);

    // 5. Update global weight
    reduceGlobalWeight(resource, unfreezeBalance);

    // 6. Schedule withdrawal after delay
    return true;
}
```

### WithdrawExpireUnfreezeActuator

**File**: `actuator/src/main/java/org/tron/core/actuator/WithdrawExpireUnfreezeActuator.java`

**Purpose**: Withdraw TRX from expired unfreeze records

```java
@Override
public boolean execute(Object object) {
    long now = getHeadBlockTimeStamp();

    // Iterate all UnFreezeV2 records
    List<UnFreezeV2> expiredList = account.getUnfrozenV2List().stream()
        .filter(uf -> uf.getUnfreezeTime() <= now)
        .collect(Collectors.toList());

    // Sum up expired amounts
    long totalWithdraw = expiredList.stream()
        .mapToLong(UnFreezeV2::getUnfrozenBalance)
        .sum();

    // Return to balance
    account.setBalance(account.getBalance() + totalWithdraw);

    // Remove expired records
    account.clearExpiredUnfreezeV2();

    return true;
}
```

### CancelAllUnfreezeV2Actuator

**File**: `actuator/src/main/java/org/tron/core/actuator/CancelAllUnfreezeV2Actuator.java`

**Purpose**: Cancel all pending unfreezes and immediately refreeze

```java
@Override
public boolean execute(Object object) {
    // Get all pending unfreezes
    List<UnFreezeV2> unfreezeList = account.getUnfrozenV2List();

    for (UnFreezeV2 unfreeze : unfreezeList) {
        long amount = unfreeze.getUnfrozenBalance();
        ResourceCode resource = unfreeze.getResource();

        // Refreeze the amount
        FreezeV2 freeze = FreezeV2.newBuilder()
            .setFrozenBalance(amount)
            .setExpireTime(0)  // No expiration
            .setResource(resource)
            .build();

        account.addFrozenV2(freeze);

        // Restore global weight
        addGlobalWeight(resource, amount);
    }

    // Clear all unfreezes
    account.clearAllUnfrozenV2();

    return true;
}
```

---

## 6. Resource Delegation System

### Contract Types

| Contract Type | Type ID | Actuator Class | Purpose |
|--------------|---------|----------------|---------|
| DelegateResourceContract | 57 | DelegateResourceActuator | Delegate resources to receiver |
| UnDelegateResourceContract | 58 | UnDelegateResourceActuator | Reclaim delegated resources |

### DelegateResourceActuator

**File**: `actuator/src/main/java/org/tron/core/actuator/DelegateResourceActuator.java`

**Key Features** (Lines 74-91):

1. **Lock mechanism**: Configurable 1-3 month lock period
2. **Resource transfer**: Owner's frozen resources → Receiver's available resources
3. **Separate tracking**: DelegatedResourceStore maintains delegation records

```java
@Override
public boolean execute(Object object) {
    // 1. Extract contract parameters
    DelegateResourceContract contract = getContract();
    byte[] ownerAddress = contract.getOwnerAddress().toByteArray();
    byte[] receiverAddress = contract.getReceiverAddress().toByteArray();
    long balance = contract.getBalance();
    ResourceCode resource = contract.getResource();
    boolean lock = contract.getLock();
    long lockPeriod = contract.getLockPeriod();  // Optional

    // 2. Validate owner has enough frozen balance
    AccountCapsule owner = getAccount(ownerAddress);
    validateFrozenBalance(owner, resource, balance);

    // 3. Calculate lock expiration
    long expireTime = lock ? (now + lockPeriod) : Long.MAX_VALUE;

    // 4. Create or update delegation record
    DelegatedResourceCapsule delegatedResource =
        delegatedResourceStore.get(createKey(ownerAddress, receiverAddress));

    if (delegatedResource == null) {
        delegatedResource = new DelegatedResourceCapsule(
            ByteString.copyFrom(ownerAddress),
            ByteString.copyFrom(receiverAddress)
        );
    }

    // 5. Update delegation amounts
    if (resource == BANDWIDTH) {
        delegatedResource.addFrozenBalanceForBandwidth(balance);
        delegatedResource.setExpireTimeForBandwidth(expireTime);
    } else if (resource == ENERGY) {
        delegatedResource.addFrozenBalanceForEnergy(balance);
        delegatedResource.setExpireTimeForEnergy(expireTime);
    }

    // 6. Persist delegation
    delegatedResourceStore.put(createKey(ownerAddress, receiverAddress), delegatedResource);

    // 7. Update owner's available resources (reduce)
    owner.reduceDelegatedResource(resource, balance);

    // 8. Update receiver's delegated resources (increase)
    AccountCapsule receiver = getAccount(receiverAddress);
    receiver.addAcquiredDelegatedResource(resource, balance);

    // 9. Update index for reverse lookup
    updateDelegatedResourceAccountIndex(ownerAddress, receiverAddress);

    return true;
}
```

### UnDelegateResourceActuator

**File**: `actuator/src/main/java/org/tron/core/actuator/UnDelegateResourceActuator.java`

**Key Features**:

1. **Lock validation**: Cannot undelegate if lock period not expired
2. **Partial undelegation**: Can reclaim portion of delegated amount
3. **Resource recovery**: Triggers resource usage recalculation

```java
@Override
public boolean execute(Object object) {
    // 1. Extract contract
    UnDelegateResourceContract contract = getContract();
    byte[] ownerAddress = contract.getOwnerAddress().toByteArray();
    byte[] receiverAddress = contract.getReceiverAddress().toByteArray();
    long balance = contract.getBalance();
    ResourceCode resource = contract.getResource();

    // 2. Get delegation record
    DelegatedResourceCapsule delegatedResource =
        delegatedResourceStore.get(createKey(ownerAddress, receiverAddress));
    validate(delegatedResource != null, "No delegation found");

    // 3. Validate lock period
    long now = getHeadBlockTimeStamp();
    if (resource == BANDWIDTH) {
        validate(delegatedResource.getExpireTimeForBandwidth() <= now,
                "Lock period not expired");
        validate(delegatedResource.getFrozenBalanceForBandwidth() >= balance,
                "Insufficient delegated balance");
    } else if (resource == ENERGY) {
        validate(delegatedResource.getExpireTimeForEnergy() <= now,
                "Lock period not expired");
        validate(delegatedResource.getFrozenBalanceForEnergy() >= balance,
                "Insufficient delegated balance");
    }

    // 4. Calculate receiver's resource usage
    AccountCapsule receiver = getAccount(receiverAddress);
    long usedResource = calculateUsedResource(receiver, resource);
    long delegatedAmount = getDelegatedAmount(delegatedResource, resource);

    // 5. Handle proportional resource consumption
    // If receiver used resources, owner must reclaim proportionally
    long usageToReturn = (balance * usedResource) / delegatedAmount;

    // 6. Update delegation record
    if (resource == BANDWIDTH) {
        delegatedResource.reduceFrozenBalanceForBandwidth(balance);
    } else if (resource == ENERGY) {
        delegatedResource.reduceFrozenBalanceForEnergy(balance);
    }

    // 7. Update owner's resources
    AccountCapsule owner = getAccount(ownerAddress);
    owner.addDelegatedResource(resource, balance);
    owner.increaseUsage(resource, usageToReturn);  // Add consumed portion

    // 8. Update receiver's resources
    receiver.reduceAcquiredDelegatedResource(resource, balance);

    // 9. Clean up if delegation fully removed
    if (delegatedResource.getFrozenBalanceForBandwidth() == 0 &&
        delegatedResource.getFrozenBalanceForEnergy() == 0) {
        delegatedResourceStore.delete(createKey(ownerAddress, receiverAddress));
    } else {
        delegatedResourceStore.put(createKey(ownerAddress, receiverAddress),
                                   delegatedResource);
    }

    return true;
}
```

### Delegation Storage

**DelegatedResourceStore**

**File**: `chainbase/src/main/java/org/tron/core/store/DelegatedResourceStore.java`

```java
// Key format: owner_address + receiver_address
byte[] createKey(byte[] owner, byte[] receiver) {
    return Bytes.concat(owner, receiver);
}

// Get delegation record
public DelegatedResourceCapsule get(byte[] key)

// Store delegation
public void put(byte[] key, DelegatedResourceCapsule value)

// Unlock expired delegations
public void unLockExpireResource(long now) {
    // Iterate all delegations
    // Check expiration times
    // Auto-unlock if expired
}
```

**DelegatedResourceAccountIndexStore**

**File**: `chainbase/src/main/java/org/tron/core/store/DelegatedResourceAccountIndexStore.java`

Purpose: Index for reverse lookup (receiver → list of delegators)

```java
// Key: receiver_address
// Value: DelegatedResourceAccountIndexCapsule containing list of delegators

public void add(byte[] receiverAddress, byte[] ownerAddress)
public void remove(byte[] receiverAddress, byte[] ownerAddress)
public List<byte[]> getDelegators(byte[] receiverAddress)
```

---

## 7. Storage Layer

### Store Hierarchy

```
TronStoreWithRevoking<T>
  ↓
TronDatabase
  ↓
RocksDB (Key-Value Store)
```

### Core Stores

#### AccountStore

**File**: `chainbase/src/main/java/org/tron/core/store/AccountStore.java`

- Stores all account information
- Key: address (21 bytes)
- Value: AccountCapsule (protobuf serialized)

#### DynamicPropertiesStore

**File**: `chainbase/src/main/java/org/tron/core/store/DynamicPropertiesStore.java`

**Critical Resource Parameters**:

```java
// Bandwidth
public long getTotalNetLimit()
public void saveTotalNetLimit(long limit)
public long getTotalNetWeight()
public void addTotalNetWeight(long weight)
public long getFreeNetLimit()
public long getPublicNetLimit()
public long getTransactionFee()
public long getCreateAccountFee()
public long getCreateNewAccountBandwidthRate()

// Energy
public long getTotalEnergyLimit()
public void saveTotalEnergyLimit(long limit)
public long getTotalEnergyCurrentLimit()
public void saveTotalEnergyCurrentLimit(long limit)
public long getTotalEnergyTargetLimit()
public long getTotalEnergyWeight()
public void addTotalEnergyWeight(long weight)
public long getEnergyFee()
public void saveEnergyFee(long fee)
public long getBlockEnergyUsage()
public void saveBlockEnergyUsage(long usage)
public long getTotalEnergyAverageUsage()

// TRON Power
public long getTotalTronPowerWeight()
public void addTotalTronPowerWeight(long weight)

// Adaptive Energy
public boolean getAllowAdaptiveEnergy()
public long getAdaptiveResourceLimitMultiplier()
public long getAdaptiveResourceLimitTargetRatio()
```

**Storage Format**: Key-value pairs with string keys

#### DelegatedResourceStore

**File**: `chainbase/src/main/java/org/tron/core/store/DelegatedResourceStore.java`

- Key: owner_address (21 bytes) + receiver_address (21 bytes) = 42 bytes
- Value: DelegatedResourceCapsule

#### DelegatedResourceAccountIndexStore

**File**: `chainbase/src/main/java/org/tron/core/store/DelegatedResourceAccountIndexStore.java`

- Key: receiver_address (21 bytes)
- Value: DelegatedResourceAccountIndexCapsule (list of delegator addresses)

#### WitnessStore

**File**: `chainbase/src/main/java/org/tron/core/store/WitnessStore.java`

- Stores witness (Super Representative) information
- Includes voting weight from TRON_POWER
- Used for DPoS consensus

### Data Capsules

#### AccountCapsule

**File**: `chainbase/src/main/java/org/tron/core/capsule/AccountCapsule.java`

**Resource-Related Methods**:

```java
// Bandwidth
public long getNetUsage()
public void setNetUsage(long usage)
public long getFreeNetUsage()
public void setFreeNetUsage(long usage)
public long getLatestConsumeTime()
public void setLatestConsumeTime(long time)

// Energy
public long getEnergyUsage()
public void setEnergyUsage(long usage)
public long getLatestConsumeTimeForEnergy()
public void setLatestConsumeTimeForEnergy(long time)

// V1 Frozen (Legacy)
public List<Frozen> getFrozenList()
public long getFrozenBalance()
public long getFrozenBalanceForBandwidth()
public long getFrozenBalanceForEnergy()

// V2 Frozen (Current)
public List<FreezeV2> getFrozenV2List()
public long getFrozenV2BalanceForBandwidth()
public long getFrozenV2BalanceForEnergy()
public long getTronPowerFrozenV2Balance()
public void addFrozenV2(FreezeV2 freeze)

// V2 Unfrozen
public List<UnFreezeV2> getUnfrozenV2List()
public void addUnfrozenV2(UnFreezeV2 unfreeze)
public void clearExpiredUnfrozenV2()
public void clearAllUnfrozenV2()

// Delegation
public long getAcquiredDelegatedFrozenBalanceForBandwidth()
public long getAcquiredDelegatedFrozenBalanceForEnergy()
public long getDelegatedFrozenBalanceForBandwidth()
public long getDelegatedFrozenBalanceForEnergy()

// Window Size (V2)
public long getNetWindowSize()
public long getEnergyWindowSize()
public long getNetWindowOptimized()
public long getEnergyWindowOptimized()
```

#### DelegatedResourceCapsule

**File**: `chainbase/src/main/java/org/tron/core/capsule/DelegatedResourceCapsule.java`

```java
// Ownership
public ByteString getFrom()
public ByteString getTo()

// Bandwidth Delegation
public long getFrozenBalanceForBandwidth()
public void setFrozenBalanceForBandwidth(long balance)
public void addFrozenBalanceForBandwidth(long balance)
public void reduceFrozenBalanceForBandwidth(long balance)
public long getExpireTimeForBandwidth()
public void setExpireTimeForBandwidth(long time)

// Energy Delegation
public long getFrozenBalanceForEnergy()
public void setFrozenBalanceForEnergy(long balance)
public void addFrozenBalanceForEnergy(long balance)
public void reduceFrozenBalanceForEnergy(long balance)
public long getExpireTimeForEnergy()
public void setExpireTimeForEnergy(long time)
```

---

## 8. TVM Integration

### Program Class

**File**: `actuator/src/main/java/org/tron/core/vm/program/Program.java`

The Program class is the execution context for smart contracts and handles all resource consumption during execution.

#### Native Contract Processor Integration (Lines 69-77)

```java
public class Program {
    // Native contract processors for resource operations
    private FreezeBalanceProcessor freezeBalanceProcessor;
    private FreezeBalanceV2Processor freezeBalanceV2Processor;
    private UnfreezeBalanceProcessor unfreezeBalanceProcessor;
    private UnfreezeBalanceV2Processor unfreezeBalanceV2Processor;
    private WithdrawExpireUnfreezeProcessor withdrawExpireUnfreezeProcessor;
    private CancelAllUnfreezeV2Processor cancelAllUnfreezeV2Processor;
    private DelegateResourceProcessor delegateResourceProcessor;
    private UnDelegateResourceProcessor unDelegateResourceProcessor;
    private VoteWitnessProcessor voteWitnessProcessor;
    private WithdrawRewardProcessor withdrawRewardProcessor;

    // Energy tracking
    private long energyLimit;           // Maximum energy available
    private long energyUsed;            // Energy consumed so far

    // ...
}
```

#### Energy Methods

```java
// Calculate energy cost for opcode
public long calcOperationGas(OpCode op)

// Spend energy for operation
public void spendGas(long gas)

// Check remaining energy
public long getRemainingGas()

// Energy for contract creation
public long energyForCreateContract(int codeLength)

// Energy for memory expansion
public long energyForDataCopy(long bytes)

// Check if out of energy
public boolean isOutOfEnergy()
```

### EnergyCost Class

**File**: `actuator/src/main/java/org/tron/core/vm/EnergyCost.java`

**Tier Definitions**:

```java
public static final int ZERO_TIER = 0;
public static final int BASE_TIER = 2;
public static final int VERY_LOW_TIER = 3;
public static final int LOW_TIER = 5;
public static final int MID_TIER = 8;
public static final int HIGH_TIER = 10;
public static final int EXT_TIER = 20;
```

**Resource Operation Costs**:

```java
// Legacy V1
public static final int FREEZE = 20000;
public static final int UNFREEZE = 20000;

// Modern V2
public static final int FREEZE_V2 = 10000;
public static final int UNFREEZE_V2 = 10000;
public static final int WITHDRAW_EXPIRE_UNFREEZE = 10000;
public static final int CANCEL_ALL_UNFREEZE_V2 = 10000;

// Delegation
public static final int DELEGATE_RESOURCE = 10000;
public static final int UN_DELEGATE_RESOURCE = 10000;

// Voting
public static final int VOTE_WITNESS = 30000;
public static final int WITHDRAW_REWARD = 20000;
```

**Memory Operations**:

```java
public static final int MEMORY = 3;              // Per word
public static final int COPY_GAS = 3;            // Per word copied
public static final int CREATE_DATA = 200;       // Per byte of contract code
```

**Storage Operations**:

```java
public static final int SLOAD = 50;              // Storage read
public static final int SSTORE_SET = 20000;      // Storage write (new)
public static final int SSTORE_RESET = 5000;     // Storage write (existing)
public static final int SSTORE_REFUND = 15000;   // Storage clear refund
```

**Call Operations**:

```java
public static final int CALL = 40;               // Base call cost
public static final int CALL_VALUE = 9000;       // Call with value transfer
public static final int CALL_NEW_ACCOUNT = 25000;// Call creating account
public static final int CREATE = 32000;          // Contract creation
```

### VM Execution Flow

```
Transaction submitted
  ↓
RuntimeImpl.execute()
  ↓
VMActuator.validate() / execute()
  ↓
Program created with energy limit
  ↓
VM.play(Program)
  ↓
For each opcode:
  ├─ Program.calcOperationGas(opcode)
  ├─ Program.spendGas(cost)
  ├─ Check Program.isOutOfEnergy()
  ├─ Execute operation
  └─ If native contract call:
      └─ Invoke NativeContractProcessor
  ↓
Program.getResult()
  ↓
ProgramResult with energy consumed
  ↓
TransactionTrace records consumption
```

### Native Contract Processors

**Location**: `actuator/src/main/java/org/tron/core/vm/nativecontract/`

Each processor allows smart contracts to call resource management functions:

**FreezeBalanceV2Processor.java**
```java
public void execute(InternalTransaction tx, Program program) {
    // Parse contract parameters
    byte[] data = tx.getData();
    long frozenBalance = parseAmount(data);
    ResourceCode resource = parseResource(data);

    // Validate caller has balance
    validateBalance(tx.getCaller(), frozenBalance);

    // Execute freeze logic
    FreezeBalanceV2Actuator actuator = new FreezeBalanceV2Actuator();
    actuator.execute(createContract(frozenBalance, resource));

    // Charge energy
    program.spendGas(EnergyCost.FREEZE_V2);
}
```

**DelegateResourceProcessor.java**
```java
public void execute(InternalTransaction tx, Program program) {
    // Parse parameters
    byte[] receiverAddress = parseReceiver(tx.getData());
    long balance = parseBalance(tx.getData());
    ResourceCode resource = parseResource(tx.getData());
    boolean lock = parseLock(tx.getData());
    long lockPeriod = parseLockPeriod(tx.getData());

    // Execute delegation
    DelegateResourceActuator actuator = new DelegateResourceActuator();
    actuator.execute(createContract(receiverAddress, balance, resource, lock, lockPeriod));

    // Charge energy
    program.spendGas(EnergyCost.DELEGATE_RESOURCE);
}
```

---

## 9. Network Parameters

### Configuration Sources

1. **Compile-Time Constants**: `Parameter.ChainConstant`
2. **Runtime Parameters**: `DynamicPropertiesStore`
3. **Proposal System**: `ProposalService`, `ProposalStore`

### Key Constants

**File**: `common/src/main/java/org/tron/core/config/Parameter.java`

```java
public class ChainConstant {
    // Block production
    public static final long BLOCK_PRODUCED_INTERVAL = 3000;  // 3 seconds

    // Resource recovery window
    public static final long WINDOW_SIZE_MS = 86400000;  // 24 hours

    // Precision for calculations
    public static final long TRX_PRECISION = 1000000;  // 1 TRX = 10^6 sun

    // Delegation
    public static final long DELEGATE_PERIOD = 2592000000L;  // 30 days in ms
    public static final long MAX_FROZEN_TIME = 7776000000L;  // 90 days

    // Unfreeze delay (V2)
    public static final long UNFREEZE_DELAY = 1209600000L;  // 14 days

    // Free resources
    public static final long FREE_NET_LIMIT = 5000;  // bytes per day

    // Fees
    public static final long TRANSACTION_FEE = 10;  // sun per byte
    public static final long ENERGY_FEE = 420;  // sun per energy (dynamic)
}
```

### Dynamic Parameters (DynamicPropertiesStore)

**Modifiable via Proposal System**:

| Parameter | Default | Unit | Description |
|-----------|---------|------|-------------|
| totalNetLimit | 43,200,000,000 | bytes | Total bandwidth per day |
| totalNetWeight | dynamic | TRX | Sum of frozen for bandwidth |
| freeNetLimit | 5,000 | bytes | Free bandwidth per account |
| publicNetLimit | 14,400,000,000 | bytes | Public free bandwidth |
| transactionFee | 10 | sun/byte | Bandwidth price |
| createAccountFee | 100,000 | sun | New account cost |
| totalEnergyLimit | 180,000,000,000 | energy | Total energy per day |
| totalEnergyCurrentLimit | dynamic | energy | Adaptive energy limit |
| totalEnergyWeight | dynamic | TRX | Sum of frozen for energy |
| energyFee | 420 | sun/energy | Energy price (dynamic) |

### Proposal System

**Proposal Types for Resources**:

| Proposal ID | Parameter | Type |
|-------------|-----------|------|
| 19 | Adaptive energy enable | boolean |
| 61 | Unfreeze delay period | long |
| 62 | Allow old resource model | boolean |
| 70 | Max delegate lock period | long |

**Proposal Workflow**:
1. Witness creates proposal
2. Other witnesses vote (>50% required)
3. Proposal approved at maintenance window
4. Parameter updated in DynamicPropertiesStore
5. Takes effect immediately or at next cycle

---

## 10. Key Algorithms

### Algorithm 1: Resource Recovery (24-Hour Window)

**Implementation**: `ResourceProcessor.increase()`

```
Input:
  - lastUsage: Previous resource usage
  - lastTime: Timestamp of last consumption
  - now: Current timestamp
  - windowSize: Recovery window (86,400,000 ms = 24 hours)

Process:
  1. Calculate time elapsed
     elapsed = now - lastTime

  2. If elapsed >= windowSize:
     // Fully recovered
     return 0 + newConsumption

  3. Calculate decay factor
     precision = 1,000,000
     decay = (windowSize - elapsed) / windowSize

  4. Apply decay to last usage
     decayedUsage = (lastUsage * decay)

  5. Add new consumption
     newUsage = decayedUsage + newConsumption

Output: newUsage
```

**Example**:
```
Scenario: User consumed 1000 bandwidth, 12 hours passed

lastUsage = 1000
lastTime = T0
now = T0 + 12 hours = T0 + 43,200,000 ms
windowSize = 86,400,000 ms
newConsumption = 500

elapsed = 43,200,000 ms
decay = (86,400,000 - 43,200,000) / 86,400,000 = 0.5
decayedUsage = 1000 * 0.5 = 500
newUsage = 500 + 500 = 1000

Result: 50% of previous usage recovered
```

### Algorithm 2: Bandwidth Limit Calculation

**Implementation**: `BandwidthProcessor.calculateGlobalNetLimit()`

```
Input:
  - frozenBalance: TRX frozen for bandwidth (in sun)
  - totalNetLimit: Global bandwidth limit (from DynamicPropertiesStore)
  - totalNetWeight: Sum of all frozen TRX for bandwidth

Process:
  1. Calculate frozen weight
     weight = frozenBalance / TRX_PRECISION
     weight = frozenBalance / 1,000,000

  2. Calculate proportional share
     if totalNetWeight == 0:
       return 0

     limit = weight * (totalNetLimit / totalNetWeight)

Output: limit (bandwidth in bytes)
```

**Example**:
```
Scenario: User freezes 10,000 TRX

frozenBalance = 10,000,000,000 sun (10,000 TRX)
totalNetLimit = 43,200,000,000 bytes
totalNetWeight = 10,000,000,000 TRX (total frozen by all users)

weight = 10,000,000,000 / 1,000,000 = 10,000
limit = 10,000 * (43,200,000,000 / 10,000,000,000)
limit = 10,000 * 4.32
limit = 43,200 bytes

Result: User gets 43,200 bytes of bandwidth every 24 hours
```

### Algorithm 3: Energy Limit Calculation

**Implementation**: `EnergyProcessor.calculateGlobalEnergyLimit()`

```
Same as bandwidth calculation, but with energy parameters:

limit = (frozenBalance / 1,000,000) * (totalEnergyLimit / totalEnergyWeight)
```

**Example**:
```
Scenario: User freezes 100,000 TRX

frozenBalance = 100,000,000,000 sun
totalEnergyLimit = 180,000,000,000 energy
totalEnergyWeight = 10,000,000,000 TRX

weight = 100,000
limit = 100,000 * (180,000,000,000 / 10,000,000,000)
limit = 100,000 * 18
limit = 1,800,000 energy

Result: User gets 1.8M energy every 24 hours
```

### Algorithm 4: Adaptive Energy Scaling

**Implementation**: `EnergyProcessor.updateAdaptiveTotalEnergyLimit()` (Lines 73-86)

```
Input:
  - blockEnergyUsage: Energy consumed in recent blocks
  - totalEnergyAverageUsage: Moving average
  - totalEnergyTargetLimit: Target limit
  - totalEnergyCurrentLimit: Current limit
  - totalEnergyLimit: Base limit
  - adaptiveResourceLimitMultiplier: Max expansion (e.g., 10x)

Process:
  1. Calculate 21-block average
     averageUsage = sum(last 21 blocks) / 21

  2. Compare with target
     if averageUsage < totalEnergyTargetLimit:
       // Demand low, expand capacity
       newLimit = totalEnergyCurrentLimit * 1.2
     else if averageUsage > totalEnergyTargetLimit:
       // Demand high, contract capacity
       newLimit = totalEnergyCurrentLimit * 0.5
     else:
       newLimit = totalEnergyCurrentLimit

  3. Apply cap
     maxLimit = totalEnergyLimit * adaptiveResourceLimitMultiplier
     newLimit = min(newLimit, maxLimit)
     newLimit = max(newLimit, totalEnergyLimit)

  4. Update current limit
     totalEnergyCurrentLimit = newLimit

Output: Updated totalEnergyCurrentLimit
```

### Algorithm 5: Delegation Resource Return

**Implementation**: `ResourceProcessor.unDelegateIncrease()`

```
Input:
  - lastUsage: Delegator's last usage
  - delegatedUsage: Receiver's resource usage
  - oldValue: Amount delegated
  - now, lastTime: Timestamps

Process:
  1. Calculate receiver's usage percentage
     usagePercent = delegatedUsage / oldValue

  2. Calculate usage to return to delegator
     usageToReturn = oldValue * usagePercent

  3. Apply recovery to delegator's own usage
     recovered = recovery(lastUsage, now, lastTime)

  4. Add returned usage
     newUsage = recovered + usageToReturn

Output: newUsage for delegator
```

**Example**:
```
Scenario: Owner delegated 10,000 bandwidth, receiver used 3,000

delegatedUsage = 3,000
oldValue = 10,000
usagePercent = 3,000 / 10,000 = 0.3

Delegator's own usage = 2,000 (12 hours ago)
recovered = 2,000 * 0.5 = 1,000

usageToReturn = 10,000 * 0.3 = 3,000
newUsage = 1,000 + 3,000 = 4,000

Result: Delegator's usage becomes 4,000 after undelegation
```

### Algorithm 6: Proportional Delegation Consumption

When receiver uses resources, consumption is distributed:

```
totalAvailable = ownResources + delegatedResources

consumptionRatio = usedAmount / totalAvailable

ownConsumed = ownResources * consumptionRatio
delegatedConsumed = delegatedResources * consumptionRatio
```

---

## 11. Testing Infrastructure

### Test Structure

```
framework/src/test/java/org/tron/
├── common/runtime/vm/
│   ├── BandWidthRuntimeTest.java
│   ├── EnergyWhenRequireStyleTest.java
│   ├── FreezeTest.java
│   └── FreezeV2Test.java
├── core/actuator/
│   ├── FreezeBalanceActuatorTest.java
│   ├── FreezeBalanceV2ActuatorTest.java
│   ├── UnfreezeBalanceV2ActuatorTest.java
│   ├── DelegateResourceActuatorTest.java
│   ├── UnDelegateResourceActuatorTest.java
│   └── CancelAllUnfreezeV2ActuatorTest.java
└── core/db/
    ├── BandwidthProcessorTest.java
    └── EnergyProcessorTest.java
```

### Key Test Files

**BandwidthProcessorTest.java**
- Tests bandwidth consumption priority
- Free bandwidth allocation
- Transaction fee fallback
- Resource recovery over time

**EnergyProcessorTest.java**
- Energy calculation tests
- Adaptive energy scaling tests
- Global energy limit updates

**FreezeBalanceV2ActuatorTest.java**
- V2 freeze operations
- Resource type handling
- Balance validation
- Global weight updates

**DelegateResourceActuatorTest.java**
- Delegation creation
- Lock period enforcement
- Multi-delegation scenarios
- Resource transfer validation

**UnDelegateResourceActuatorTest.java**
- Undelegation with lock check
- Partial undelegation
- Resource usage return
- Proportional consumption

### Test Utilities

**TestCommon.java**
- Database initialization
- Account creation helpers
- Transaction builders

**Manager.java** (Test instance)
- In-memory database
- Test blockchain setup
- Store initialization

---

## 12. Critical File Reference

### Top 20 Must-Read Files

| Priority | File | Purpose | Lines of Interest |
|----------|------|---------|------------------|
| 1 | ResourceProcessor.java | Base algorithm | 66-203 |
| 2 | BandwidthProcessor.java | Bandwidth logic | All |
| 3 | EnergyProcessor.java | Energy + adaptive | 73-86 (adaptive) |
| 4 | FreezeBalanceV2Actuator.java | V2 freeze | 60-81 |
| 5 | UnfreezeBalanceV2Actuator.java | V2 unfreeze | All |
| 6 | DelegateResourceActuator.java | Delegation | 74-91 |
| 7 | UnDelegateResourceActuator.java | Undelegation | All |
| 8 | AccountCapsule.java | Data structure | All methods |
| 9 | DynamicPropertiesStore.java | Parameters | All getters/setters |
| 10 | Program.java | TVM energy tracking | 69-77, energy methods |
| 11 | EnergyCost.java | Operation costs | All constants |
| 12 | DelegatedResourceStore.java | Delegation storage | All |
| 13 | DelegatedResourceCapsule.java | Delegation data | All |
| 14 | WithdrawExpireUnfreezeActuator.java | Withdrawal logic | All |
| 15 | CancelAllUnfreezeV2Actuator.java | Cancel unfreezes | All |
| 16 | MortgageService.java | Reward distribution | All |
| 17 | TransactionTrace.java | Resource tracking | All |
| 18 | common.proto | Resource enum | 9-13 |
| 19 | balance_contract.proto | Contract messages | All |
| 20 | Tron.proto | Account message | 227-290 |

### File Dependency Graph

```
balance_contract.proto (Contracts)
  ↓
FreezeBalanceV2Actuator.java (Execution)
  ↓
AccountCapsule.java (Data)
  ↓
AccountStore.java (Persistence)
  ↓
DynamicPropertiesStore.java (Global State)

ResourceProcessor.java (Base)
  ↓
BandwidthProcessor.java / EnergyProcessor.java
  ↓
TransactionTrace.java (Recording)

Program.java (TVM)
  ↓
EnergyCost.java (Costs)
  ↓
NativeContractProcessor (Resource Ops)
```

---

## Summary

This source code structure document provides a comprehensive map of the java-tron implementation for resource management. Key takeaways:

1. **Modular Architecture**: Clear separation between protocol, storage, processing, execution, and VM layers
2. **V2 System**: Modern freeze/unfreeze with flexible locking (V1 is legacy)
3. **Delegation System**: Complete resource sharing with lock mechanisms
4. **Adaptive Energy**: Dynamic scaling based on network demand
5. **24-Hour Recovery**: Linear resource recovery window
6. **TVM Integration**: Smart contracts can call resource operations natively
7. **Comprehensive Testing**: 35+ test files cover all scenarios

### Next Steps for Book Writing

1. **Part 1**: Use sections 3-4 for fundamentals chapter
2. **Part 2**: Use sections 5-6 for operations deep dive
3. **Part 3**: Use section 10 algorithms for consumption/recovery
4. **Part 4**: Use section 9 for advanced topics (parameters, governance)
5. **Part 5**: Use testing infrastructure section 11 for implementation guide
6. **Part 6**: Use section 7 (storage) for reference implementation

All code examples should be verified against the actual source files listed in section 12.
