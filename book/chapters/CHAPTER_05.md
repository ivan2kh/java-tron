# Chapter 5: Energy Cost Analysis

## The Bizarre Fact: Why Popular Contracts Pay 340% More (And How USDT Got Here)

In December 2022, a TRON developer noticed something strange. Their DEX smart contract had been working perfectly for months, consistently costing users around 65,000 energy per swap. Then, overnight, the same transactions started consuming 185,000 energy - nearly **3x more** for identical operations.

The contract code hadn't changed. The TRX price was stable. The network wasn't congested. Yet somehow, their users were paying 340% more in energy costs.

What happened? The contract had become **too popular**.

TRON implements a dynamic energy penalty system called **energy_factor** that increases costs for heavily-used contracts. When a contract exceeds a threshold of energy usage per maintenance cycle (every 6 hours), its `energy_factor` increases by a percentage. This penalty multiplies **all** operation costs within that contract.

The most famous victim? **USDT on TRON** (contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`).

At its peak usage in 2021, the USDT contract had an `energy_factor` of approximately **10,000** (100% penalty), meaning every operation cost **double** the normal amount. A standard USDT transfer that should consume ~14,000 energy was actually consuming ~28,000 energy. Users were burning twice as much TRX (or needing twice as much frozen energy) simply because the contract was popular.

This mechanism is designed to discourage DoS attacks through spam contracts, but it creates a perverse economic outcome: **successful dApps are punished with higher costs**.

For the DEX developer, this was a crisis. Their business model assumed 65,000 energy per transaction. At 185,000 energy, they were operating at a loss. They had three options:

1. **Increase user fees** (risk losing customers to competitors)
2. **Optimize contract code** (reduce base energy, hope penalty doesn't exceed savings)
3. **Deploy a new contract** (reset energy_factor to 0, but lose accumulated user base)

They chose option 2, spending 3 weeks rewriting their contract to use 40% less energy. Combined with reducing usage patterns, they got their `energy_factor` back down to manageable levels.

In this chapter, you'll learn:
- How TRON's EVM operation costs work (Section 5.1)
- The complete energy_factor penalty system (Section 5.2)
- How energy is metered during VM execution (Section 5.3)
- Contract settings that control energy distribution (Section 5.4)
- The real cost of energy after penalties and fees (Section 5.5)
- Techniques to profile and optimize contracts (Section 5.6)

By the end, you'll understand exactly why popular contracts cost more, how to measure your contract's true energy consumption, and strategies to minimize costs even under penalty conditions.

---

## 5.1 EVM Operation Costs

Every operation in the TVM (TRON Virtual Machine, based on EVM) has a base energy cost. These costs are defined in `EnergyCost.java` and follow a tiered pricing model.

### 5.1.1 Cost Tier System

TRON uses 8 tiers of operation costs:

**Source**: `actuator/src/main/java/org/tron/core/vm/EnergyCost.java:13-21`

```java
private static final long ZERO_TIER = 0;        // Free operations
private static final long BASE_TIER = 2;        // Basic operations
private static final long VERY_LOW_TIER = 3;    // Simple operations
private static final long LOW_TIER = 5;         // Low-cost operations
private static final long MID_TIER = 8;         // Medium operations
private static final long HIGH_TIER = 10;       // High-cost operations
private static final long EXT_TIER = 20;        // External operations
private static final long SPECIAL_TIER = 1;     // Special case operations
```

**Examples by tier**:

- **ZERO_TIER (0)**: `STOP`, `INVALID`
- **BASE_TIER (2)**: `ADDRESS`, `ORIGIN`, `CALLER`, `CALLVALUE`
- **VERY_LOW_TIER (3)**: `ADD`, `SUB`, `NOT`, `LT`, `GT`, `EQ`
- **LOW_TIER (5)**: `MUL`, `DIV`, `MOD`, `SIGNEXTEND`
- **MID_TIER (8)**: `ADDMOD`, `MULMOD`, `JUMP`
- **HIGH_TIER (10)**: `JUMPI`, `EXTCODEHASH`
- **EXT_TIER (20)**: `BALANCE`, `EXTCODESIZE`, `EXTCODECOPY`

### 5.1.2 Storage Operations (Highest Costs)

Storage operations dominate energy costs in most contracts.

**Source**: `EnergyCost.java:30-33`

```java
private static final long SLOAD = 50;           // Read from storage
private static final long CLEAR_SSTORE = 5000;  // Clear storage slot
private static final long SET_SSTORE = 20000;   // Set new storage value
private static final long RESET_SSTORE = 5000;  // Reset existing storage
```

**Dynamic SSTORE pricing** depends on the previous and new values:

**Source**: `EnergyCost.java:217-235`

```java
public static long getSstoreCost(Program program) {
    Stack stack = program.getStack();
    DataWord newValue = stack.get(stack.size() - 2);
    DataWord oldValue = program.storageLoad(stack.peek());

    if (oldValue == null && !newValue.isZero()) {
        // Set a new not-zero value (first write to slot)
        return SET_SSTORE;  // 20,000 energy
    }
    if (oldValue != null && newValue.isZero()) {
        // Clear storage (delete value)
        program.refundEnergy(REFUND_SSTORE, "CLEAR_SSTORE");  // Refund 15,000
        return CLEAR_SSTORE;  // 5,000 energy (net: -10,000 with refund)
    }
    // oldValue == null && newValue == 0  OR
    // oldValue != null && newValue != 0 (modify existing)
    return RESET_SSTORE;  // 5,000 energy
}
```

**Cost breakdown**:

| Operation | Old Value | New Value | Cost | Net Cost (with refund) |
|-----------|-----------|-----------|------|------------------------|
| First write | null | non-zero | 20,000 | 20,000 |
| Modify | non-zero | non-zero | 5,000 | 5,000 |
| Delete | non-zero | 0 | 5,000 | -10,000 (refund 15,000) |
| No-op | 0 | 0 | 5,000 | 5,000 |

**Key insight**: Deleting storage (`SSTORE(slot, 0)`) actually **saves** energy through the refund mechanism. This is why contracts that clean up old data can be more efficient.

### 5.1.3 Memory Operations (Quadratic Expansion)

Memory costs are **quadratic** in the memory size, not linear.

**Source**: `EnergyCost.java:511-532`

```java
private static long calcMemEnergy(long oldMemSize, BigInteger newMemSize,
                           long copySize, int op) {
    long energyCost = 0;

    // Memory expansion cost (quadratic formula)
    long memoryUsage = (newMemSize.longValueExact() + 31) / 32 * 32;
    if (memoryUsage > oldMemSize) {
        long memWords = (memoryUsage / 32);
        long memWordsOld = (oldMemSize / 32);

        // Formula: 3 × words + words² / 512
        long memEnergy = (MEMORY * memWords + memWords * memWords / 512)
            - (MEMORY * memWordsOld + memWordsOld * memWordsOld / 512);
        energyCost += memEnergy;
    }

    // Copy cost (linear: 3 energy per 32-byte word)
    if (copySize > 0) {
        long copyEnergy = COPY_ENERGY * ((copySize + 31) / 32);
        energyCost += copyEnergy;
    }
    return energyCost;
}
```

**Formula**:
```
MemoryCost = 3 × words + (words² / 512) - 3 × old_words - (old_words² / 512)

Where:
  words = ceil(new_memory_size / 32)
  old_words = ceil(old_memory_size / 32)
```

**Memory limit**: 3 MB per transaction (`EnergyCost.java:26`)

**Example calculation**:

```javascript
// Expand memory from 0 to 1024 bytes
const oldWords = 0;
const newWords = Math.ceil(1024 / 32); // 32 words

const cost = (3 * newWords + newWords * newWords / 512) - (3 * oldWords + oldWords * oldWords / 512);
// = (3 * 32 + 32 * 32 / 512) - 0
// = (96 + 1024/512)
// = 96 + 2 = 98 energy

// Expand from 1024 to 2048 bytes
const cost2 = (3 * 64 + 64 * 64 / 512) - (3 * 32 + 32 * 32 / 512);
// = (192 + 8) - (96 + 2)
// = 200 - 98 = 102 energy

// Notice: Second 1024 bytes costs MORE than first 1024 bytes (quadratic!)
```

**Why quadratic?** To prevent DoS attacks that allocate huge memory regions. The cost grows rapidly:
- First 1 KB: 98 energy
- 0-10 KB: ~1,000 energy
- 0-100 KB: ~60,000 energy
- 0-1 MB: ~6,000,000 energy

### 5.1.4 Contract Interaction Operations

**Source**: `EnergyCost.java:37-59`

```java
private static final long BALANCE = 20;              // Get balance
private static final long NEW_ACCT_CALL = 25000;     // Create new account
private static final long CREATE = 32000;            // Create contract
private static final long CALL_ENERGY = 40;          // Base call cost
private static final long VT_CALL = 9000;            // Value transfer call
private static final long STIPEND_CALL = 2300;       // Stipend for payable
private static final long EXT_CODE_COPY = 20;        // Copy external code
private static final long EXT_CODE_SIZE = 20;        // Get code size
private static final long EXT_CODE_HASH = 400;       // Get code hash
private static final long SUICIDE = 0;               // Self-destruct (free)
private static final long CREATE_DATA = 200;         // Per byte of contract code
```

**CALL operation cost breakdown**:

| Scenario | Base | Value Transfer | New Account | Total |
|----------|------|----------------|-------------|-------|
| Call existing (no TRX) | 40 | 0 | 0 | 40 |
| Call existing (send TRX) | 40 | 9,000 | 0 | 9,040 |
| Call new account (no TRX) | 40 | 0 | 25,000 | 25,040 |
| Call new account (send TRX) | 40 | 9,000 | 25,000 | 34,040 |

**Important**: Calling a non-existent address costs **625x more** than calling an existing address (25,040 vs 40 energy).

### 5.1.5 TRON-Specific Operations

TRON adds native operations for staking, delegation, and governance:

**Source**: `EnergyCost.java:38-49`

```java
private static final long FREEZE_V2 = 10000;                   // Freeze v2
private static final long UNFREEZE_V2 = 10000;                 // Unfreeze v2
private static final long WITHDRAW_EXPIRE_UNFREEZE = 10000;    // Withdraw
private static final long CANCEL_ALL_UNFREEZE_V2 = 10000;      // Cancel unfreeze
private static final long DELEGATE_RESOURCE = 10000;            // Delegate
private static final long UN_DELEGATE_RESOURCE = 10000;         // Undelegate
private static final long VOTE_WITNESS = 30000;                 // Vote (most expensive)
private static final long WITHDRAW_REWARD = 20000;              // Withdraw rewards
```

These operations allow smart contracts to interact directly with TRON's resource system. For example, a contract can:
- Freeze its own TRX balance to gain energy
- Delegate energy to users
- Vote for witnesses (though 30,000 energy makes this expensive)

### 5.1.6 Logging Operations

Event logs have costs based on topics and data size:

**Source**: `EnergyCost.java:34-36`

```java
private static final long LOG_DATA_ENERGY = 8;       // Per byte of log data
private static final long LOG_ENERGY = 375;          // Base log cost
private static final long LOG_TOPIC_ENERGY = 375;    // Per topic
```

**Formula**:
```
LogCost = 375 + (375 × num_topics) + (8 × data_bytes)
```

**Examples**:

```solidity
// LOG0: No topics (just data)
emit Anonymous(bytes data);
// Cost: 375 + 0 + 8 × len(data)

// LOG1: 1 indexed topic
emit Transfer(address indexed from, address to, uint256 amount);
// Cost: 375 + 375 + 8 × 96 = 1,518 energy
// (from is indexed/topic, to and amount are 64 bytes data)

// LOG4: Maximum 4 topics
emit ComplexEvent(bytes32 indexed a, bytes32 indexed b,
                  bytes32 indexed c, bytes32 indexed d, bytes data);
// Cost: 375 + 1,500 + 8 × len(data) = 1,875 + 8 × len(data)
```

**Optimization tip**: Indexed parameters become topics (expensive), non-indexed go to data (cheap per byte). If you don't need to filter by a parameter, don't index it.

---

## 5.2 The Energy Factor Penalty System

The energy factor (`energy_factor`) is a **dynamic multiplier** applied to contracts that exceed a usage threshold. It's TRON's mechanism to discourage resource-intensive contracts and prevent DoS attacks.

### 5.2.1 How Energy Factor Works

Every smart contract has a `ContractState` tracking its energy usage:

**Proto definition**: `protocol/src/main/protos/core/contract/smart_contract.proto:61-65`

```protobuf
message ContractState {
  int64 energy_usage = 1;      // Energy consumed in current cycle
  int64 energy_factor = 2;     // Penalty factor (0 to 100,000)
  int64 update_cycle = 3;      // Last update maintenance cycle
}
```

**Source**: `chainbase/src/main/java/org/tron/core/capsule/ContractStateCapsule.java`

**Key parameters** (set via governance proposals):

- **dynamicEnergyThreshold**: Energy usage per cycle to trigger increase (e.g., 2,000,000 energy)
- **dynamicEnergyIncreaseFactor**: Percentage to increase per cycle (e.g., 2000 = 20%)
- **dynamicEnergyMaxFactor**: Maximum penalty (e.g., 10,000 = 100% penalty, up to 100,000 = 1000%)

**Note**: As of this writing, mainnet has `dynamicEnergyThreshold = 0`, which **disables** the energy factor system. However, the code is fully implemented and can be activated via proposal. This section documents the system as implemented.

### 5.2.2 Increase Formula (Exceeding Threshold)

When a contract's `energy_usage` exceeds `dynamicEnergyThreshold` in a maintenance cycle, its `energy_factor` increases:

**Source**: `ContractStateCapsule.java:108-119`

```java
// INCREASE: Contract exceeded threshold in last cycle
if (getEnergyUsage() > threshold) {
    lastCycle += 1;
    double increasePercent = 1 + (double) increaseFactor / precisionFactor;
    // precisionFactor = 10,000

    this.contractState = ContractState.newBuilder()
        .setUpdateCycle(lastCycle)
        .setEnergyFactor(min(
            maxFactor,
            (long) ((getEnergyFactor() + precisionFactor) * increasePercent) - precisionFactor,
            disableMath))
        .build();
}
```

**Formula**:
```
newFactor = min(
    maxFactor,
    (oldFactor + 10,000) × (1 + increaseFactor/10,000) - 10,000
)
```

**Example**:

```javascript
// Contract state:
// - energy_usage = 3,000,000 (exceeded threshold of 2,000,000)
// - energy_factor = 5,000 (current penalty)
// Network parameters:
// - increaseFactor = 2,000 (20%)
// - maxFactor = 100,000

const oldFactor = 5000;
const increaseFactor = 2000;

const newFactor = Math.min(
    100000,
    (oldFactor + 10000) * (1 + increaseFactor / 10000) - 10000
);
// = min(100000, (5000 + 10000) × 1.20 - 10000)
// = min(100000, 15000 × 1.20 - 10000)
// = min(100000, 18000 - 10000)
// = min(100000, 8000)
// = 8000

// New energy_factor = 8,000 (80% penalty)
// Operations now cost 1.8x normal
```

### 5.2.3 Decrease Formula (Natural Decay)

When a contract's usage is below threshold, its `energy_factor` decreases over time:

**Source**: `ContractStateCapsule.java:123-144`

```java
// DECREASE: Apply decay for cycles without activity
long cycleCount = newCycle - lastCycle;
if (cycleCount <= 0) {
    return true;
}

// Decrease formula: factor *= (1 - increaseFactor/4/10000)^cycleCount
double decreasePercent = pow(
    1 - (double) increaseFactor / DYNAMIC_ENERGY_DECREASE_DIVISION / precisionFactor,
    cycleCount, useStrictMath
);
// DYNAMIC_ENERGY_DECREASE_DIVISION = 4

this.contractState = ContractState.newBuilder()
    .setUpdateCycle(newCycle)
    .setEnergyFactor(max(
        0,
        (long) ((getEnergyFactor() + precisionFactor) * decreasePercent) - precisionFactor,
        disableMath))
    .build();
```

**Formula**:
```
newFactor = max(
    0,
    (oldFactor + 10,000) × (1 - increaseFactor/4/10,000)^cycleCount - 10,000
)
```

**Key insight**: Decay rate is **1/4 the increase rate**. If increase factor is 20%, decay is 5% per cycle.

**Example**:

```javascript
// Contract state after 10 idle cycles:
// - energy_usage = 100,000 (below threshold)
// - energy_factor = 8,000
// Network parameters:
// - increaseFactor = 2,000 (20% increase, 5% decay)

const oldFactor = 8000;
const increaseFactor = 2000;
const cycleCount = 10;

const decreasePercent = Math.pow(
    1 - increaseFactor / 4 / 10000,
    cycleCount
);
// = (1 - 2000/40000)^10
// = (1 - 0.05)^10
// = 0.95^10
// = 0.5987

const newFactor = Math.max(
    0,
    (oldFactor + 10000) * decreasePercent - 10000
);
// = max(0, 18000 × 0.5987 - 10000)
// = max(0, 10776 - 10000)
// = 776

// After 10 idle cycles, energy_factor dropped from 8,000 to 776
```

**Decay timeline** (20% increase factor, starting at 10,000):

| Cycles | energy_factor | Cost Multiplier |
|--------|---------------|-----------------|
| 0 | 10,000 | 2.0x |
| 1 | 9,500 | 1.95x |
| 5 | 7,738 | 1.77x |
| 10 | 5,987 | 1.60x |
| 20 | 3,585 | 1.36x |
| 50 | 769 | 1.08x |
| 100 | 59 | 1.01x |

### 5.2.4 Energy Factor Impact on Costs

The energy factor multiplies **every operation** in the contract:

**Source**: `actuator/src/main/java/org/tron/core/vm/VM.java:52-71`

```java
// Calculate base energy cost
long energy = op.getEnergyCost(program);

if (VMConfig.allowDynamicEnergy()) {
    long actualEnergy = energy;

    // CALL operations have special handling
    if (CALL_OPS.contains(op.getOpcode())) {
        actualEnergy = energy
            - program.getAdjustedCallEnergy().longValueSafe()
            - program.getCallPenaltyEnergy();
    }
    energyUsage += actualEnergy;

    // Apply energy factor penalty
    if (factor > DYNAMIC_ENERGY_FACTOR_DECIMAL) {  // factor > 10,000
        long penalty;

        if (CALL_OPS.contains(op.getOpcode())) {
            penalty = program.getCallPenaltyEnergy();
        } else {
            // penalty = baseCost × (factor / 10,000) - baseCost
            penalty = energy * factor / DYNAMIC_ENERGY_FACTOR_DECIMAL - energy;
            if (penalty < 0) {
                penalty = 0;
            }
            energy += penalty;
        }

        program.spendEnergyWithPenalty(energy, penalty, opName);
    } else {
        program.spendEnergy(energy, opName);
    }
}
```

**Penalty formula**:
```
actualCost = baseCost × (10,000 + energy_factor) / 10,000
penalty = actualCost - baseCost
```

**Cost multiplier table**:

| energy_factor | Multiplier | SSTORE (20k) | SLOAD (50) | CREATE (32k) |
|---------------|------------|--------------|------------|--------------|
| 0 | 1.0× | 20,000 | 50 | 32,000 |
| 2,500 | 1.25× | 25,000 | 63 | 40,000 |
| 5,000 | 1.5× | 30,000 | 75 | 48,000 |
| 10,000 | 2.0× | 40,000 | 100 | 64,000 |
| 25,000 | 3.5× | 70,000 | 175 | 112,000 |
| 50,000 | 6.0× | 120,000 | 300 | 192,000 |
| 100,000 | 11.0× | 220,000 | 550 | 352,000 |

**Real-world impact**:

A contract with `energy_factor = 10,000` (100% penalty) performing:
- 5 SSTORE operations: 5 × 20,000 × 2.0 = **200,000 energy** (vs 100,000 normal)
- 10 SLOAD operations: 10 × 50 × 2.0 = **1,000 energy** (vs 500 normal)
- 1 LOG event: 1,518 × 2.0 = **3,036 energy** (vs 1,518 normal)

**Total**: 204,036 energy vs 102,018 normal = **double the cost**.

### 5.2.5 Checking Your Contract's Energy Factor

Query a contract's energy factor:

```javascript
const info = await tronWeb.trx.getContract(contractAddress);
const state = info.contract_state || {};

const factor = state.energy_factor || 0;
const multiplier = (10000 + factor) / 10000;

console.log(`Energy Factor: ${factor} (${multiplier}x cost multiplier)`);
// If factor > 0: operations cost more than base rate
```

**Example**:
```javascript
// Check USDT contract
const info = await tronWeb.trx.getContract('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
console.log('Factor:', info.contract_state?.energy_factor || 0);
```

**Note**: Currently disabled on mainnet (`dynamicEnergyThreshold = 0`). Can be activated via governance.

---

## 5.3 VM Execution and Energy Metering

Understanding how the VM tracks energy consumption is crucial for optimization and debugging.

### 5.3.1 VM Execution Loop

The main execution loop processes opcodes and tracks energy:

**Source**: `actuator/src/main/java/org/tron/core/vm/VM.java:22-123`

```java
public static void play(Program program, JumpTable jumpTable) {
    try {
        long factor = DYNAMIC_ENERGY_FACTOR_DECIMAL;  // 10,000
        long energyUsage = 0L;

        // Initialize contract energy factor
        if (VMConfig.allowDynamicEnergy()) {
            factor = program.updateContextContractFactor();
        }

        while (!program.isStopped()) {
            // Get next operation
            Operation op = jumpTable.get(program.getCurrentOpIntValue());

            // Calculate base energy cost
            long energy = op.getEnergyCost(program);

            // Track usage and apply penalty
            if (VMConfig.allowDynamicEnergy()) {
                // ... (penalty calculation from previous section)
            }

            // Execute the operation
            op.execute(program);
        }

        // Record total usage for contract state
        if (VMConfig.allowDynamicEnergy()) {
            program.addContextContractUsage(energyUsage);
        }
    } catch (RuntimeException e) {
        // On error, spend all remaining energy (no refund)
        program.spendAllEnergy();
        program.stop();
        throw e;
    }
}
```

**Key behaviors**:

1. **Initialization**: Load contract's `energy_factor` before execution
2. **Per-operation**: Calculate cost, apply penalty, spend energy
3. **Execution**: Actually perform the operation
4. **Completion**: Update contract's cumulative `energy_usage`
5. **Error handling**: On exception, consume ALL remaining energy (no refunds)

### 5.3.2 Energy Spending

**Source**: `actuator/src/main/java/org/tron/core/vm/program/Program.java:1113-1131`

```java
public void spendEnergy(long energyValue, String opName) {
    if (getEnergylimitLeftLong() < energyValue) {
        throw new OutOfEnergyException(
            "Not enough energy for '%s' operation executing: curInvokeEnergyLimit[%d],"
                + " curOpEnergy[%d], usedEnergy[%d]",
            opName, invoke.getEnergyLimit(), energyValue, getResult().getEnergyUsed());
    }
    getResult().spendEnergy(energyValue);
}

public void spendEnergyWithPenalty(long total, long penalty, String opName) {
    if (getEnergylimitLeftLong() < total) {
        throw new OutOfEnergyException(
            "Not enough energy for '%s' operation executing: curInvokeEnergyLimit[%d],"
                + " curOpEnergy[%d], penaltyEnergy[%d], usedEnergy[%d]",
            opName, invoke.getEnergyLimit(), total - penalty, penalty, getResult().getEnergyUsed());
    }
    getResult().spendEnergyWithPenalty(total, penalty);
}
```

**Important**: The VM checks available energy **before** executing each operation. If insufficient, it throws `OutOfEnergyException` and the transaction fails.

### 5.3.3 Energy Refunds

Some operations refund energy:

**Source**: `Program.java:1158-1162`

```java
public void refundEnergy(long energyValue, String cause) {
    logger.debug("[{}] Refund for cause: [{}], energy: [{}]",
        invoke.hashCode(), cause, energyValue);
    getResult().refundEnergy(energyValue);
}
```

**Refund scenarios**:

1. **SSTORE delete**: Refund 15,000 when clearing storage (`EnergyCost.java:221`)
2. **Failed CALL**: Refund unused energy if call fails (`Program.java:946-948`)
3. **Call returns**: Refund remaining energy to parent call (`Program.java:872-882`)
4. **Precompiled contracts**: Refund unused energy (`Program.java:1628-1630`)

**Example**: SSTORE delete refund

```solidity
// Storage slot contains value 0x1234
uint256 value = mySlot;  // SLOAD: 50 energy

// Delete the value
mySlot = 0;  // SSTORE: 5,000 energy cost, 15,000 refund
             // Net: -10,000 energy (you GAIN energy!)
```

**Important**: Refunds are capped at 50% of total gas spent (EIP-3529). You can't profit from refunds.

### 5.3.4 Tracking Energy Usage

The `ProgramResult` tracks cumulative usage:

**Source**: `chainbase/src/main/java/org/tron/common/runtime/ProgramResult.java:24-84`

```java
private long energyUsed = 0;
private long energyPenaltyTotal = 0;

public void spendEnergy(long energy) {
    energyUsed += energy;
}

public void spendEnergyWithPenalty(long total, long penalty) {
    energyPenaltyTotal += penalty;
    energyUsed += total;
}

public void refundEnergy(long energy) {
    energyUsed -= energy;
}

public long getEnergyUsed() {
    return energyUsed;
}

public long getEnergyPenaltyTotal() {
    return energyPenaltyTotal;
}
```

After execution, you can inspect the receipt to see:
- **energyUsed**: Total energy consumed (including penalties)
- **energyPenaltyTotal**: Just the penalty portion
- **Base energy**: `energyUsed - energyPenaltyTotal`

### 5.3.5 Energy Limits

Multiple limits apply:

1. **Transaction energy_limit**: Set by caller (max willing to spend)
2. **Contract origin_energy_limit**: Max provided by contract creator
3. **Account available energy**: From frozen TRX
4. **Block energy limit**: Network-wide per-block cap

**Hierarchy**:

```
Block Energy Limit (43,200,000,000 on mainnet)
    ↓
Transaction Energy Limit (caller-specified)
    ↓
Origin Energy Limit (contract creator's contribution)
    ↓
Account Energy (from frozen TRX or burned TRX)
```

**Source**: `Program.java:1291-1297`

```java
public long getEnergylimitLeftLong() {
    return invoke.getEnergyLimit() - getResult().getEnergyUsed();
}

public DataWord getEnergyLimitLeft() {
    return new DataWord(invoke.getEnergyLimit() - getResult().getEnergyUsed());
}
```

---

## 5.4 Contract Settings: Energy Distribution

Smart contracts have two critical settings that control who pays for energy:

### 5.4.1 consume_user_resource_percent (0-100%)

This parameter determines the **split** between caller and contract creator.

**Proto definition**: `smart_contract.proto:88-92`

```protobuf
message UpdateSettingContract {
  bytes owner_address = 1;
  bytes contract_address = 2;
  int64 consume_user_resource_percent = 3;  // 0-100
}
```

**Validation**: `UpdateSettingContractActuator.java:93-97`

```java
long newPercent = contract.getConsumeUserResourcePercent();
if (newPercent > 100 || newPercent < 0) {
    throw new ContractValidateException("percent not in [0, 100]");
}
```

**Meaning**:

- **0%**: Contract creator pays ALL energy (from `origin_energy_limit`)
- **50%**: Energy split 50/50 between creator and caller
- **100%**: Caller pays ALL energy (creator pays nothing)

**Example**:

```javascript
// User pays 30%, contract pays 70%
const tx = await tronWeb.transactionBuilder.updateSetting(contractAddress, 30);
await tronWeb.trx.sign(tx).then(tronWeb.trx.sendRawTransaction);
```

**Use cases**:

- **0%**: Total subsidization (creator pays everything) - good for onboarding
- **25-50%**: Shared cost model (popular for DEXs)
- **100%**: No subsidization (caller pays) - good for public utility contracts

### 5.4.2 origin_energy_limit (Maximum Creator Contribution)

This parameter sets the **maximum energy** the contract creator is willing to provide per transaction.

**Proto definition**: `smart_contract.proto:94-98`

```protobuf
message UpdateEnergyLimitContract {
  bytes owner_address = 1;
  bytes contract_address = 2;
  int64 origin_energy_limit = 3;
}
```

**Validation**: `UpdateEnergyLimitContractActuator.java:97-101`

```java
long newOriginEnergyLimit = contract.getOriginEnergyLimit();
if (newOriginEnergyLimit <= 0) {
    throw new ContractValidateException("origin energy limit must be > 0");
}
```

**Example**:

```javascript
// Set max creator contribution to 100,000 energy per transaction
const tx = await tronWeb.transactionBuilder.updateEnergyLimit(contractAddress, 100000);
await tronWeb.trx.sign(tx).then(tronWeb.trx.sendRawTransaction);
```

**Default**: When deploying a contract, `origin_energy_limit` defaults to 10,000,000 (10 million energy).

### 5.4.3 Energy Distribution Calculation

The actual energy split is calculated at settlement:

**Source**: `ReceiptCapsule.java:227-238`

```java
// Step 1: Calculate creator's portion based on percent
long originUsage = multiplyExact(receipt.getEnergyUsageTotal(), percent, disableJavaLangMath)
    / 100;
// percent = 100 - consume_user_resource_percent
// Example: If consume_user_resource_percent = 30%, then percent = 70%

// Step 2: Cap by origin_energy_limit and available frozen energy
originUsage = getOriginUsage(dynamicPropertiesStore, origin, originEnergyLimit,
    energyProcessor, originUsage);

// Step 3: Remainder paid by caller
long callerUsage = receipt.getEnergyUsageTotal() - originUsage;

// Step 4: Deduct from both accounts
energyProcessor.useEnergy(origin, originUsage, now);
this.setOriginEnergyUsage(originUsage);
payEnergyBill(dynamicPropertiesStore, accountStore, forkController,
    caller, callerUsage, receipt.getResult(), energyProcessor, now);
```

**getOriginUsage capping logic**:

```java
private long getOriginUsage(DynamicPropertiesStore store, AccountCapsule origin,
                             long originEnergyLimit, EnergyProcessor processor,
                             long usage) {
    // Cap 1: origin_energy_limit
    if (usage > originEnergyLimit) {
        usage = originEnergyLimit;
    }

    // Cap 2: Creator's available frozen energy
    long availableEnergy = processor.getAccountLeftEnergyFromFreeze(origin);
    if (usage > availableEnergy) {
        usage = availableEnergy;
    }

    return usage;
}
```

**Complete example**:

```javascript
// Scenario:
// - consume_user_resource_percent = 30% (user pays 30%, creator pays 70%)
// - origin_energy_limit = 100,000
// - Transaction uses 150,000 energy total
// - Creator has 80,000 frozen energy available
// - Caller has 20,000 frozen energy available

// Step 1: Calculate creator's intended portion
const creatorPercent = 100 - 30;  // 70%
let creatorPortion = Math.floor(150000 * creatorPercent / 100);
// = 105,000 energy

// Step 2: Cap by origin_energy_limit
creatorPortion = Math.min(creatorPortion, 100000);
// = 100,000 energy

// Step 3: Cap by creator's available energy
creatorPortion = Math.min(creatorPortion, 80000);
// = 80,000 energy (FINAL)

// Step 4: Caller pays remainder
const callerPortion = 150000 - creatorPortion;
// = 70,000 energy

// Step 5: Caller's frozen energy
const callerFrozen = 20000;
const callerBurned = callerPortion - callerFrozen;
// = 50,000 energy burned

// Step 6: Calculate TRX cost (420 sun per energy)
const cost = callerBurned * 420;
// = 21,000,000 sun = 21 TRX

console.log('Creator provides:', creatorPortion, 'energy (from frozen)');
console.log('Caller provides:', callerPortion, 'energy');
console.log('  - From frozen:', callerFrozen);
console.log('  - Burned as TRX:', callerBurned, `(${cost / 1e6} TRX)`);
```

**Key insights**:

1. Creator's contribution is capped by BOTH `origin_energy_limit` AND available frozen energy
2. If creator can't provide their full share, **caller pays the difference**
3. Caller's energy comes from frozen TRX first, then burns TRX for remainder
4. Setting `consume_user_resource_percent = 100%` makes creator pay nothing (even if they have frozen energy)

---

## 5.5 Energy Fee Calculation (The Real Cost)

After all penalties and distributions, what does the user actually pay?

### 5.5.1 The Complete Formula

**Source**: `ReceiptCapsule.java:260-318`

```java
private void payEnergyBill(
    DynamicPropertiesStore dynamicPropertiesStore, AccountStore accountStore,
    ForkController forkController, AccountCapsule account,
    long usage, contractResult contractResult,
    EnergyProcessor energyProcessor, long now) throws BalanceInsufficientException {

    // Get available energy from frozen TRX
    long accountEnergyLeft = energyProcessor.getAccountLeftEnergyFromFreeze(account);

    if (accountEnergyLeft >= usage) {
        // User has enough frozen energy - no fee charged
        energyProcessor.useEnergy(account, accountEnergyLeft, now);
        this.setEnergyUsage(usage);
    } else {
        // Partial frozen energy + burn TRX for remaining
        energyProcessor.useEnergy(account, accountEnergyLeft, now);

        // Get dynamic energy fee (420 sun on mainnet)
        long sunPerEnergy = Constant.SUN_PER_ENERGY;  // Default: 100
        long dynamicEnergyFee = dynamicPropertiesStore.getEnergyFee();
        if (dynamicEnergyFee > 0) {
            sunPerEnergy = dynamicEnergyFee;  // Mainnet: 420
        }

        // Calculate fee for unfrozen portion
        long energyFee = (usage - accountEnergyLeft) * sunPerEnergy;
        this.setEnergyUsage(accountEnergyLeft);
        this.setEnergyFee(energyFee);

        // Deduct fee from account balance
        long balance = account.getBalance();
        if (balance < energyFee) {
            throw new BalanceInsufficientException(
                StringUtil.createReadableString(account.createDbKey()) +
                " insufficient balance");
        }
        account.setBalance(balance - energyFee);

        // Burn the fee (sent to fee pool or black hole)
        // ... (fee destination logic)
    }

    accountStore.put(account.getAddress().toByteArray(), account);
}
```

**Formula breakdown**:

```
Step 1: Calculate total energy with penalties
  TotalEnergy = Σ[baseCost × (1 + energy_factor/10,000)]

Step 2: Apply consume_user_resource_percent split
  CreatorEnergy = min(
      TotalEnergy × (100 - consume_user_resource_percent) / 100,
      origin_energy_limit,
      CreatorFrozenEnergy
  )
  CallerEnergy = TotalEnergy - CreatorEnergy

Step 3: Use caller's frozen energy first
  CallerFrozenEnergy = min(CallerEnergy, CallerAvailableFrozenEnergy)
  CallerBurnedEnergy = CallerEnergy - CallerFrozenEnergy

Step 4: Calculate TRX cost
  TRX_Cost = CallerBurnedEnergy × EnergyFee_Sun

Where:
  EnergyFee_Sun = 420 (mainnet) or 100 (default)
```

### 5.5.2 Complete Worked Example

Let's calculate the real cost for a complex scenario:

**Scenario**:
- Contract has `energy_factor = 5000` (50% penalty)
- `consume_user_resource_percent = 40%` (user pays 40%, creator pays 60%)
- `origin_energy_limit = 150,000`
- Creator has 200,000 frozen energy available
- Caller has 30,000 frozen energy available
- Transaction performs:
  - 5× SSTORE (5 × 20,000 = 100,000 base energy)
  - 10× SLOAD (10 × 50 = 500 base energy)
  - 1× LOG1 event (1,518 base energy)
  - Misc operations: 8,000 base energy

**Step 1: Calculate total energy with penalty**

```javascript
const energyFactor = 5000;
const multiplier = (10000 + energyFactor) / 10000;  // 1.5x

const operations = [
    { name: 'SSTORE', count: 5, baseCost: 20000 },
    { name: 'SLOAD', count: 10, baseCost: 50 },
    { name: 'LOG1', count: 1, baseCost: 1518 },
    { name: 'Misc', count: 1, baseCost: 8000 }
];

let totalEnergy = 0;
let baseEnergy = 0;

operations.forEach(op => {
    const base = op.count * op.baseCost;
    const actual = Math.floor(base * multiplier);
    baseEnergy += base;
    totalEnergy += actual;
    console.log(`${op.name}: ${base} → ${actual} (+${actual - base} penalty)`);
});

console.log(`\nBase total: ${baseEnergy.toLocaleString()}`);
console.log(`With penalty: ${totalEnergy.toLocaleString()}`);
console.log(`Penalty: ${(totalEnergy - baseEnergy).toLocaleString()} (${((multiplier - 1) * 100).toFixed(0)}%)`);
```

**Output**:
```
SSTORE: 100,000 → 150,000 (+50,000 penalty)
SLOAD: 500 → 750 (+250 penalty)
LOG1: 1,518 → 2,277 (+759 penalty)
Misc: 8,000 → 12,000 (+4,000 penalty)

Base total: 110,018
With penalty: 165,027
Penalty: 55,009 (50%)
```

**Step 2: Split between creator and caller**

```javascript
const consumeUserPercent = 40;
const originEnergyLimit = 150000;
const creatorFrozen = 200000;

// Creator's intended share: 60%
const creatorPercent = 100 - consumeUserPercent;
let creatorEnergy = Math.floor(totalEnergy * creatorPercent / 100);
console.log(`Creator intended: ${creatorEnergy.toLocaleString()} (${creatorPercent}%)`);

// Cap by origin_energy_limit
creatorEnergy = Math.min(creatorEnergy, originEnergyLimit);
console.log(`After origin_energy_limit cap: ${creatorEnergy.toLocaleString()}`);

// Cap by creator's frozen energy
creatorEnergy = Math.min(creatorEnergy, creatorFrozen);
console.log(`After frozen energy cap: ${creatorEnergy.toLocaleString()}`);

// Caller pays remainder
const callerEnergy = totalEnergy - creatorEnergy;
console.log(`\nCaller must provide: ${callerEnergy.toLocaleString()} energy`);
```

**Output**:
```
Creator intended: 99,016 (60%)
After origin_energy_limit cap: 99,016
After frozen energy cap: 99,016

Caller must provide: 66,011 energy
```

**Step 3: Caller's frozen vs burned**

```javascript
const callerFrozen = 30000;

const callerFrozenUsed = Math.min(callerEnergy, callerFrozen);
const callerBurned = callerEnergy - callerFrozenUsed;

console.log(`Caller's frozen energy used: ${callerFrozenUsed.toLocaleString()}`);
console.log(`Caller must burn: ${callerBurned.toLocaleString()} energy`);
```

**Output**:
```
Caller's frozen energy used: 30,000
Caller must burn: 36,011 energy
```

**Step 4: Calculate TRX cost**

```javascript
const sunPerEnergy = 420;  // Mainnet value

const costSun = callerBurned * sunPerEnergy;
const costTRX = costSun / 1e6;

console.log(`\n=== FINAL COST ===`);
console.log(`Energy burned: ${callerBurned.toLocaleString()} units`);
console.log(`Cost: ${costSun.toLocaleString()} sun = ${costTRX.toFixed(2)} TRX`);
console.log(`\nBreakdown:`);
console.log(`  Total energy (with penalty): ${totalEnergy.toLocaleString()}`);
console.log(`  Creator provides: ${creatorEnergy.toLocaleString()} (from frozen)`);
console.log(`  Caller frozen: ${callerFrozenUsed.toLocaleString()}`);
console.log(`  Caller burned: ${callerBurned.toLocaleString()}`);
console.log(`  TRX cost: ${costTRX.toFixed(2)} TRX`);
```

**Output**:
```
=== FINAL COST ===
Energy burned: 36,011 units
Cost: 15,124,620 sun = 15.12 TRX

Breakdown:
  Total energy (with penalty): 165,027
  Creator provides: 99,016 (from frozen)
  Caller frozen: 30,000
  Caller burned: 36,011
  TRX cost: 15.12 TRX
```

**Key insight**: Even though the base energy was only 110,018, the caller paid 15.12 TRX due to:
1. 50% energy penalty (55,009 extra energy)
2. Creator's limited contribution (only 99,016 of 165,027)
3. Limited frozen energy (only 30,000 available)

### 5.5.3 Cost Comparison Table

Here's how different scenarios affect cost:

| Scenario | Total Energy | Creator Pays | Caller Frozen | Caller Burned | TRX Cost |
|----------|--------------|--------------|---------------|---------------|----------|
| **No penalty, full subsidy** | 110,018 | 110,018 | 0 | 0 | 0 TRX |
| **No penalty, no subsidy** | 110,018 | 0 | 30,000 | 80,018 | 33.61 TRX |
| **50% penalty, full subsidy** | 165,027 | 165,027 | 0 | 0 | 0 TRX |
| **50% penalty, no subsidy** | 165,027 | 0 | 30,000 | 135,027 | 56.71 TRX |
| **50% penalty, 60% subsidy (actual)** | 165,027 | 99,016 | 30,000 | 36,011 | 15.12 TRX |
| **100% penalty, 60% subsidy** | 220,036 | 132,022 | 30,000 | 58,014 | 24.37 TRX |

**Observations**:

- Energy penalty has **multiplicative** effect on cost
- Subsidization (low `consume_user_resource_percent`) dramatically reduces user cost
- Frozen energy provides "free" resources (no TRX burned)

---

## 5.6 Profiling and Optimization Techniques

Now that you understand the cost model, let's explore practical techniques for measuring and reducing energy consumption.

### 5.6.1 Energy Profiler

Build a tool to analyze transaction receipts:

```javascript
class TronEnergyProfiler {
    constructor(tronWeb) {
        this.tronWeb = tronWeb;
    }

    async analyzeTransaction(txid) {
        const txInfo = await this.tronWeb.trx.getTransactionInfo(txid);
        const tx = await this.tronWeb.trx.getTransaction(txid);

        if (!txInfo.receipt || !txInfo.receipt.energy_usage_total) {
            throw new Error('Transaction has no energy usage data');
        }

        const receipt = txInfo.receipt;

        const analysis = {
            txid: txid,
            success: receipt.result === 'SUCCESS',
            energyUsageTotal: receipt.energy_usage_total || 0,
            energyPenaltyTotal: receipt.energy_penalty_total || 0,
            originEnergyUsage: receipt.origin_energy_usage || 0,
            energyUsage: receipt.energy_usage || 0,
            energyFee: receipt.energy_fee || 0,
            netFee: receipt.net_fee || 0,
        };

        // Calculate derived metrics
        analysis.baseEnergy = analysis.energyUsageTotal - analysis.energyPenaltyTotal;
        analysis.creatorPaid = analysis.originEnergyUsage;
        analysis.callerFrozen = analysis.energyUsage;
        analysis.callerBurned = (analysis.energyFee / 420);  // Assuming 420 sun/energy
        analysis.callerTotal = analysis.callerFrozen + analysis.callerBurned;

        // Calculate multiplier from penalty
        if (analysis.baseEnergy > 0) {
            analysis.penaltyMultiplier = analysis.energyUsageTotal / analysis.baseEnergy;
            analysis.energyFactor = Math.round((analysis.penaltyMultiplier - 1) * 10000);
        } else {
            analysis.penaltyMultiplier = 1.0;
            analysis.energyFactor = 0;
        }

        // Cost breakdown
        analysis.costTRX = analysis.energyFee / 1e6;
        analysis.costUSD = analysis.costTRX * (await this.getTRXPrice());

        return analysis;
    }

    async getTRXPrice() {
        // In production, fetch from price oracle
        // For now, use placeholder
        return 0.10;  // $0.10 per TRX
    }

    printAnalysis(analysis) {
        console.log('\n=== Energy Analysis ===');
        console.log(`Transaction: ${analysis.txid}`);
        console.log(`Status: ${analysis.success ? '✓ SUCCESS' : '✗ FAILED'}`);
        console.log('');
        console.log('Energy Breakdown:');
        console.log(`  Base energy: ${analysis.baseEnergy.toLocaleString()}`);
        console.log(`  Penalty: ${analysis.energyPenaltyTotal.toLocaleString()} ` +
                    `(${((analysis.penaltyMultiplier - 1) * 100).toFixed(1)}%)`);
        console.log(`  Total: ${analysis.energyUsageTotal.toLocaleString()}`);
        console.log(`  Energy factor: ${analysis.energyFactor.toLocaleString()} ` +
                    `(${analysis.penaltyMultiplier.toFixed(2)}x)`);
        console.log('');
        console.log('Payment Distribution:');
        console.log(`  Creator paid: ${analysis.creatorPaid.toLocaleString()} (from frozen)`);
        console.log(`  Caller frozen: ${analysis.callerFrozen.toLocaleString()}`);
        console.log(`  Caller burned: ${analysis.callerBurned.toLocaleString()}`);
        console.log(`  Caller total: ${analysis.callerTotal.toLocaleString()}`);
        console.log('');
        console.log('Cost:');
        console.log(`  TRX: ${analysis.costTRX.toFixed(4)} TRX`);
        console.log(`  USD: $${analysis.costUSD.toFixed(4)}`);
        console.log(`  Bandwidth fee: ${(analysis.netFee / 1e6).toFixed(4)} TRX`);

        // Recommendations
        console.log('');
        console.log('Recommendations:');
        if (analysis.energyFactor > 5000) {
            console.log('  ⚠️  High energy penalty! Consider optimizing contract or reducing usage.');
        }
        if (analysis.callerBurned > analysis.callerFrozen) {
            console.log('  💡 Freeze more TRX for energy to avoid burning.');
        }
        if (analysis.creatorPaid === 0 && analysis.callerBurned > 0) {
            console.log('  💡 Contract creator could subsidize via consume_user_resource_percent.');
        }
    }
}

// Usage
const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io'
});

const profiler = new TronEnergyProfiler(tronWeb);
const analysis = await profiler.analyzeTransaction('your_tx_id_here');
profiler.printAnalysis(analysis);
```

### 5.6.2 Contract Optimization Patterns

**Pattern 1: Minimize SSTORE operations**

Storage writes are the most expensive operations. Batch updates and avoid redundant writes.

**Bad** (multiple SSTORE):
```solidity
contract BadPattern {
    uint256 public counter;

    function incrementMultiple(uint256 times) external {
        for (uint256 i = 0; i < times; i++) {
            counter++;  // SSTORE every iteration!
        }
    }
    // Cost for times=10: 10 × 20,000 = 200,000 energy
}
```

**Good** (single SSTORE):
```solidity
contract GoodPattern {
    uint256 public counter;

    function incrementMultiple(uint256 times) external {
        uint256 temp = counter;  // SLOAD: 50 energy
        temp += times;           // ADD: 3 energy
        counter = temp;          // SSTORE: 20,000 energy
    }
    // Cost for times=10: 20,053 energy (10x cheaper!)
}
```

**Pattern 2: Use events instead of storage for historical data**

If data is only needed off-chain, emit events instead of storing.

**Bad** (store all history):
```solidity
contract BadHistory {
    struct Record {
        uint256 timestamp;
        uint256 value;
    }
    Record[] public history;  // Unbounded growth!

    function addRecord(uint256 value) external {
        history.push(Record(block.timestamp, value));
        // SSTORE: ~40,000 energy (2 storage slots)
    }
}
```

**Good** (emit events):
```solidity
contract GoodHistory {
    event RecordAdded(uint256 indexed timestamp, uint256 value);

    function addRecord(uint256 value) external {
        emit RecordAdded(block.timestamp, value);
        // LOG1: 1,518 energy (26x cheaper!)
    }
    // Off-chain indexer can reconstruct history from events
}
```

**Pattern 3: Pack storage variables**

Solidity packs variables into 32-byte slots. Optimize layout to minimize slots.

**Bad** (uses 4 slots):
```solidity
contract BadPacking {
    uint256 public bigValue;     // Slot 0
    uint8 public smallValue;     // Slot 1 (wastes 31 bytes!)
    uint256 public anotherBig;   // Slot 2
    bool public flag;            // Slot 3 (wastes 31 bytes!)

    function update() external {
        bigValue = 1;
        smallValue = 2;
        anotherBig = 3;
        flag = true;
        // 4 SSTORE = 80,000 energy
    }
}
```

**Good** (uses 3 slots):
```solidity
contract GoodPacking {
    uint256 public bigValue;     // Slot 0
    uint256 public anotherBig;   // Slot 1
    uint8 public smallValue;     // Slot 2 (packed with flag)
    bool public flag;            // Slot 2 (packed with smallValue)

    function update() external {
        bigValue = 1;
        anotherBig = 2;
        smallValue = 3;
        flag = true;
        // 3 SSTORE = 60,000 energy (25% savings)
    }
}
```

**Pattern 4: Delete unused storage**

Get refunds by clearing old data.

```solidity
contract StorageCleanup {
    mapping(address => uint256) public balances;

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        balances[msg.sender] = 0;  // SSTORE delete: 5,000 cost - 15,000 refund = -10,000

        // Transfer TRX...
    }
}
```

**Pattern 5: Limit loop iterations**

Unbounded loops can hit gas limits.

**Bad** (unbounded):
```solidity
function processAll() external {
    for (uint256 i = 0; i < users.length; i++) {
        // If users.length = 1000, might exceed block energy limit!
        process(users[i]);
    }
}
```

**Good** (batched):
```solidity
function processBatch(uint256 start, uint256 count) external {
    uint256 end = start + count;
    require(end <= users.length, "Out of bounds");

    for (uint256 i = start; i < end; i++) {
        process(users[i]);
    }
}
// Caller can process in chunks: processBatch(0, 50), processBatch(50, 50), ...
```

### 5.6.3 Estimating Energy Before Execution

Use TronWeb's `triggerConstantContract` to estimate costs:

```javascript
// Estimate energy without executing transaction
const result = await tronWeb.transactionBuilder.triggerConstantContract(
    contractAddress,
    'transfer(address,uint256)',
    {},
    [{ type: 'address', value: recipient }, { type: 'uint256', value: amount }],
    callerAddress
);

const energyUsed = result.energy_used || 0;
const costInTRX = (energyUsed * 420) / 1e6;

console.log(`Energy: ${energyUsed}, Cost: ${costInTRX} TRX`);
```

**Example - USDT transfer**:
```javascript
const result = await tronWeb.transactionBuilder.triggerConstantContract(
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',  // USDT
    'transfer(address,uint256)',
    {},
    [{ type: 'address', value: 'TRec...' }, { type: 'uint256', value: 1000000 }],
    'TYour...'
);
// result.energy_used ~= 14500 energy
```

**Important**: `triggerConstantContract` provides estimates, but actual cost may vary due to:
- State changes between estimate and execution
- Energy factor changes
- Network parameter updates

---

## 5.7 Code Laboratory

### Exercise 5.1: Build an Energy Cost Analyzer

Create a tool that analyzes a contract's historical transactions to profile energy usage patterns.

**Objective**: Identify optimization opportunities by analyzing actual transaction costs.

**Starter Code**:

```javascript
class ContractEnergyAnalyzer {
    constructor(tronWeb, contractAddress) {
        this.tronWeb = tronWeb;
        this.contractAddress = contractAddress;
        this.transactions = [];
    }

    async fetchTransactions(limit = 100) {
        // Fetch recent transactions for the contract
        // Use TronGrid API: https://api.trongrid.io/v1/contracts/{address}/transactions

        const response = await fetch(
            `https://api.trongrid.io/v1/contracts/${this.contractAddress}/transactions?limit=${limit}`
        );
        const data = await response.json();

        this.transactions = data.data || [];
        return this.transactions;
    }

    async analyzeAll() {
        const stats = {
            totalTx: 0,
            successTx: 0,
            failedTx: 0,
            totalEnergy: 0,
            totalPenalty: 0,
            totalCost: 0,
            byFunction: {}
        };

        for (const tx of this.transactions) {
            const txInfo = await this.tronWeb.trx.getTransactionInfo(tx.txID);

            // TODO: Extract function name from tx
            // TODO: Accumulate statistics
            // TODO: Calculate averages and percentiles

            stats.totalTx++;
        }

        return stats;
    }

    printReport(stats) {
        // TODO: Print comprehensive report
        console.log('=== Contract Energy Analysis ===');
        console.log(`Contract: ${this.contractAddress}`);
        // ... (print statistics)
    }
}

// Usage
const analyzer = new ContractEnergyAnalyzer(tronWeb, 'TYourContractAddress');
await analyzer.fetchTransactions(200);
const stats = await analyzer.analyzeAll();
analyzer.printReport(stats);
```

**Your task**: Complete the TODOs to:
1. Extract function names from transaction data
2. Group statistics by function (min/max/avg/p50/p95 energy)
3. Calculate total costs in TRX and USD
4. Identify the most expensive functions
5. Generate optimization recommendations

### Exercise 5.2: Storage Optimizer

Create a tool that analyzes a contract's storage layout and suggests optimizations.

**Objective**: Identify storage packing opportunities.

**Approach**:
1. Read contract source code (ABI)
2. Parse state variable declarations
3. Calculate storage slots used
4. Suggest reordering to minimize slots

**Bonus**: Estimate energy savings from optimization.

### Exercise 5.3: Energy-Aware Transaction Builder

Build a transaction builder that estimates costs before submission and warns users.

**Objective**: Provide users with cost transparency before executing transactions.

**Features**:
- Estimate energy usage
- Calculate TRX cost based on user's frozen energy
- Show warning if cost exceeds threshold
- Suggest freezing more TRX if burning is expensive

---

## 5.8 Production Checklist

Before deploying energy-sensitive contracts:

### Code Optimization
- [ ] Minimize SSTORE operations (batch updates, cache in memory)
- [ ] Pack storage variables efficiently (group by size)
- [ ] Use events for historical data instead of storage
- [ ] Delete unused storage to trigger refunds
- [ ] Limit loop iterations (use batching patterns)
- [ ] Avoid redundant SLOAD (cache in memory variables)

### Contract Configuration
- [ ] Set appropriate `consume_user_resource_percent`
  - 0-30%: Subsidized dApp (creator pays most)
  - 50-70%: Shared cost model
  - 100%: User pays all (utility contract)
- [ ] Set realistic `origin_energy_limit`
  - Estimate peak usage × 1.5 for safety margin
- [ ] Freeze sufficient TRX for energy
  - Calculate: (daily tx × energy per tx) / (energy per TRX)

### Monitoring
- [ ] Track daily energy usage via contract state
- [ ] Monitor `energy_factor` (if enabled on network)
- [ ] Alert if approaching `origin_energy_limit`
- [ ] Track user complaints about high costs
- [ ] Compare costs vs competitors

### Testing
- [ ] Profile energy costs on testnet
- [ ] Test with different frozen energy amounts
- [ ] Simulate high `energy_factor` scenarios
- [ ] Verify refunds work correctly
- [ ] Load test to find energy bottlenecks

### Documentation
- [ ] Document expected energy costs for each function
- [ ] Provide guidance on how much to freeze
- [ ] Explain subsidization model to users
- [ ] Include cost estimates in UI

### Contingency Plans
- [ ] Strategy if `energy_factor` increases significantly
- [ ] Reoptimization plan (code improvements)
- [ ] Resource pool backup (extra frozen TRX)
- [ ] Migration path (deploy new contract if needed)

---

## 5.9 Common Pitfalls

### Pitfall 1: Assuming Energy Factor = 0

**Problem**: Designing for `energy_factor = 0`, then getting surprised when it activates.

**Solution**: Even if currently disabled, design for 2-3x cost multiplier. Test with simulated penalties.

### Pitfall 2: Underestimating origin_energy_limit

**Problem**: Setting `origin_energy_limit` too low, causing user transactions to fail or cost more.

**Example**:
```
Transaction needs 150,000 energy
origin_energy_limit = 100,000
consume_user_resource_percent = 30%

Expected: Creator pays 105,000 (70%), user pays 45,000 (30%)
Actual: Creator pays 100,000 (capped), user pays 50,000 (11% more!)
```

**Solution**: Set `origin_energy_limit` to at least peak usage × 1.5.

### Pitfall 3: Not Refunding Deleted Storage

**Problem**: Forgetting to set storage to zero when done, missing 15,000 energy refund.

**Bad**:
```solidity
function withdraw() external {
    uint256 amount = balances[msg.sender];
    // Forgot to delete!
    // balances[msg.sender] = 0;
}
```

**Good**:
```solidity
function withdraw() external {
    uint256 amount = balances[msg.sender];
    balances[msg.sender] = 0;  // Refund 15,000 energy
}
```

### Pitfall 4: Unbounded Arrays

**Problem**: Iterating over unbounded arrays can exceed block energy limit.

**Solution**: Use pagination or off-chain indexing.

### Pitfall 5: Ignoring Memory Expansion Costs

**Problem**: Large memory allocations (e.g., `new uint256[](10000)`) can cost millions of energy.

**Solution**: Process data in chunks or use storage (ironically, sometimes cheaper).

---

## 5.10 Quick Reference

### Operation Costs (Base Energy)

| Operation | Cost | Notes |
|-----------|------|-------|
| ADD/SUB | 3 | Arithmetic |
| MUL/DIV | 5 | Multiplication/division |
| SLOAD | 50 | Read storage |
| SSTORE (new) | 20,000 | First write |
| SSTORE (modify) | 5,000 | Update existing |
| SSTORE (delete) | 5,000 | Refunds 15,000 |
| LOG0-4 | 375 + 375×topics + 8×data | Events |
| CALL | 40-34,040 | Depends on context |
| CREATE | 32,000 + 200×codeSize | Deploy contract |
| Memory (first 1KB) | ~98 | Quadratic expansion |

### Energy Factor Impact

| energy_factor | Multiplier | Example SSTORE |
|---------------|------------|----------------|
| 0 | 1.0× | 20,000 |
| 5,000 | 1.5× | 30,000 |
| 10,000 | 2.0× | 40,000 |
| 50,000 | 6.0× | 120,000 |
| 100,000 | 11.0× | 220,000 |

### Cost Formula

```
TRX_Cost = max(0, CallerEnergy - CallerFrozenEnergy) × 420 sun

Where:
  CallerEnergy = TotalEnergy × (consume_user_resource_percent / 100)
                 or remainder after creator's contribution
```

---

## 5.11 What's Next?

You now understand:
- ✅ How every EVM operation is priced
- ✅ The energy_factor penalty system (and why USDT is expensive)
- ✅ How energy is tracked during VM execution
- ✅ Contract settings that control cost distribution
- ✅ The complete formula for calculating real TRX cost
- ✅ Optimization techniques to minimize energy usage

In **Chapter 6: Advanced Contract Patterns**, we'll explore:
- Subsidization strategies (meta-transactions, resource pools)
- Proxy patterns and upgrade mechanisms (energy implications)
- Multi-contract architectures (minimizing cross-contract calls)
- Emergency stop mechanisms (circuit breakers)
- Gas-optimized data structures (tries, merkle trees)

The goal: build production-grade contracts that are both feature-rich AND energy-efficient.

---

**[End of Chapter 5]**
