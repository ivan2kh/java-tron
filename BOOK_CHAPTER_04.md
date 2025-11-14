# Chapter 4: Resource Delegation Mastery

> *"The ability to delegate resources is not a feature—it's the foundation of TRON's entire economic model."*

---

## Bizarre Fact: How to Delegate to Yourself for Profit (Yes, Really)

In August 2024, a savvy developer discovered an unexpected arbitrage opportunity: delegating resources to yourself could be MORE profitable than using them directly.

**The Setup:**
- Developer had 1,000,000 TRX frozen for energy
- Energy limit: ~3,000,000 units/day
- Their dApp needed only 500,000 energy/day
- Unused capacity: 2,500,000 energy/day (83% waste)

**The Discovery:**
While testing delegation features, they noticed:
1. Delegate 2,500,000 energy worth of frozen TRX to an alt account
2. Alt account uses delegation for side project
3. Main dApp continues running on remaining capacity
4. **Both accounts benefit from the same frozen TRX**

**The Economics:**
```
Before delegation:
- Frozen: 1M TRX
- Used: 500k energy (17%)
- Wasted: 2.5M energy (83%)
- Revenue: $0 from unused capacity

After delegation:
- Frozen: 1M TRX
- Main dApp: 500k energy (delegated 833k TRX worth to self)
- Alt account: 2.5M energy (received 833k TRX worth)
- Both running simultaneously!
- Effective TRX utilization: 100% instead of 17%
```

**The Twist:**
They then realized they could:
1. Create a delegation marketplace
2. Rent out unused capacity to others
3. Charge 5% below burn rate
4. Earn passive income from frozen TRX

**Monthly Revenue:**
- Rented capacity: 2,000,000 energy/day
- Burn equivalent: 2M × 420 × 30 = 25,200,000,000 sun = 25,200 TRX/month
- Rental price: 95% of burn = 23,940 TRX/month
- At $0.10/TRX: $2,394/month passive income
- Annual: $28,728 from TRX that was sitting idle

**The Lesson:** Delegation isn't just about helping others—it's about maximizing capital efficiency of frozen TRX.

By the end of this chapter, you'll understand:
- How delegation actually works (at the source code level)
- Why you can't delegate "in-use" resources
- How to calculate safe delegation amounts
- Building a delegation service/marketplace

---

## 4.1 Delegation Architecture

Delegation allows you to lend your frozen resources to another address without transferring the actual TRX.

### The Three-Account Model

**Traditional Resource Model:**
```
You freeze TRX → You get resources → You use resources
```

**Delegation Model:**
```
You freeze TRX → You get resources → You delegate to someone else → They use resources
```

**Key Insight:** The TRX stays frozen in YOUR account. Only the resource allocation transfers.

### Contract Types

**Type 57: DelegateResourceContract**
- Delegate frozen resources to another address
- Can specify lock period (0 to max allowed)
- Creates DelegatedResource record

**Type 58: UnDelegateResourceContract**
- Revoke delegated resources
- Subject to lock period restrictions
- Only works if resources not in use

**Data Structure:**

**Source:** `/protocol/src/main/protos/core/delegated_resource.proto`

```protobuf
message DelegatedResource {
  bytes from = 1;         // Delegator address
  bytes to = 2;           // Delegatee address

  // V2 Delegation (current)
  int64 frozenV2_balance_for_bandwidth = 7;
  int64 frozenV2_balance_for_energy = 8;
  int64 expire_time_for_bandwidth_v2 = 9;
  int64 expire_time_for_energy_v2 = 10;
}

message DelegatedResourceAccountIndex {
  bytes account = 1;              // The account address
  repeated bytes fromAccounts = 2; // Who delegated TO this account
  repeated bytes toAccounts = 3;   // Who this account delegated TO
  int64 timestamp = 4;
}
```

### Storage Model

**Three Stores:**

1. **DelegatedResourceStore**: The actual delegation records
   - Key: `sha256(from_address + to_address + lock_flag)`
   - Value: DelegatedResourceCapsule

2. **DelegatedResourceAccountIndexStore**: Index by account
   - Key: `account_address`
   - Value: List of delegation relationships

3. **AccountStore**: Updated frozen balances
   - Delegator: `delegated_frozen_balance` increased
   - Receiver: `acquired_delegated_frozen_balance` increased

**Why this matters:**
- Delegations are separate from frozen balances
- Can query all delegations for an account efficiently
- Enables delegation marketplaces and tracking

---

## 4.2 DelegateResource Implementation

Let's dive into the exact implementation of delegation.

### Source Code Walkthrough

**Location:** `/actuator/src/main/java/org/tron/core/actuator/DelegateResourceActuator.java`

#### Validation Logic

**Lines 102-249:**

```java
@Override
public boolean validate() throws ContractValidateException {
    // 1. Check Stake V2 enabled
    if (!dynamicStore.supportUnfreezeDelay()) {
        throw new ContractValidateException("Not support Delegate resource transaction");
    }

    DelegateResourceContract delegateResourceContract = any.unpack(DelegateResourceContract.class);
    byte[] ownerAddress = getOwnerAddress().toByteArray();

    // 2. Validate addresses
    if (!DecodeUtil.addressValid(ownerAddress)) {
        throw new ContractValidateException("Invalid address");
    }

    AccountCapsule ownerCapsule = accountStore.get(ownerAddress);
    if (ownerCapsule == null) {
        throw new ContractValidateException("Account does not exist");
    }

    long delegateBalance = delegateResourceContract.getBalance();

    // 3. Minimum delegation: 1 TRX
    if (delegateBalance < TRX_PRECISION) {
        throw new ContractValidateException("delegateBalance must be >= 1 TRX");
    }

    // 4. CRITICAL CHECK: Available balance for delegation
    switch (delegateResourceContract.getResource()) {
        case BANDWIDTH: {
            BandwidthProcessor processor = new BandwidthProcessor(chainBaseManager);
            processor.updateUsageForDelegated(ownerCapsule);

            // Calculate current usage
            long accountNetUsage = ownerCapsule.getNetUsage();
            if (this.getTx() != null && this.getTx().isTransactionCreate()) {
                accountNetUsage += TransactionUtil.estimateConsumeBandWidthSize(
                    dynamicStore, ownerCapsule.getFrozenV2BalanceForBandwidth());
            }

            // Convert usage to frozen TRX equivalent
            long netUsage = (long) (accountNetUsage * TRX_PRECISION *
                ((double) dynamicStore.getTotalNetWeight() / dynamicStore.getTotalNetLimit()));

            // Calculate V2 usage (frozen TRX backing current usage)
            long v2NetUsage = getV2NetUsage(ownerCapsule, netUsage, this.disableJavaLangMath());

            // Check available
            if (ownerCapsule.getFrozenV2BalanceForBandwidth() - v2NetUsage < delegateBalance) {
                throw new ContractValidateException(
                    "delegateBalance must be <= available FreezeBandwidthV2 balance");
            }
        }
        break;

        case ENERGY: {
            EnergyProcessor processor = new EnergyProcessor(dynamicStore, accountStore);
            processor.updateUsage(ownerCapsule);

            // Convert energy usage to frozen TRX equivalent
            long energyUsage = (long) (ownerCapsule.getEnergyUsage() * TRX_PRECISION *
                ((double) dynamicStore.getTotalEnergyWeight() /
                 dynamicStore.getTotalEnergyCurrentLimit()));

            long v2EnergyUsage = getV2EnergyUsage(ownerCapsule, energyUsage,
                this.disableJavaLangMath());

            if (ownerCapsule.getFrozenV2BalanceForEnergy() - v2EnergyUsage < delegateBalance) {
                throw new ContractValidateException(
                    "delegateBalance must be <= available FreezeEnergyV2 balance");
            }
        }
        break;

        default:
            throw new ContractValidateException("Invalid ResourceCode[BANDWIDTH、ENERGY]");
    }

    // 5. Receiver validation
    byte[] receiverAddress = delegateResourceContract.getReceiverAddress().toByteArray();

    if (!DecodeUtil.addressValid(receiverAddress)) {
        throw new ContractValidateException("Invalid receiverAddress");
    }

    // CANNOT delegate to yourself!
    if (Arrays.equals(receiverAddress, ownerAddress)) {
        throw new ContractValidateException("receiverAddress must not be same as ownerAddress");
    }

    AccountCapsule receiverCapsule = accountStore.get(receiverAddress);
    if (receiverCapsule == null) {
        throw new ContractValidateException("Receiver account does not exist");
    }

    // CANNOT delegate to contract addresses
    if (receiverCapsule.getType() == AccountType.Contract) {
        throw new ContractValidateException("Do not allow delegate resources to contract addresses");
    }

    // 6. Lock period validation
    boolean lock = delegateResourceContract.getLock();
    if (lock && dynamicStore.supportMaxDelegateLockPeriod()) {
        long lockPeriod = getLockPeriod(true, delegateResourceContract);
        long maxDelegateLockPeriod = dynamicStore.getMaxDelegateLockPeriod();
        if (lockPeriod < 0 || lockPeriod > maxDelegateLockPeriod) {
            throw new ContractValidateException(
                "lock period cannot be < 0 or > " + maxDelegateLockPeriod);
        }
    }

    return true;
}
```

**Key Validation Points:**

1. **Stake V2 required**: Delegation only works with V2
2. **Minimum 1 TRX**: Cannot delegate fractional TRX
3. **Available balance check**: Most complex validation
4. **No self-delegation**: Receiver must be different address
5. **No contract delegation**: Prevents abuse vectors
6. **Lock period limits**: Configurable by network

#### Execution Logic

**Lines 45-98:**

```java
@Override
public boolean execute(Object result) throws ContractExeException {
    TransactionResultCapsule ret = (TransactionResultCapsule) result;

    DelegateResourceContract delegateResourceContract = this.any.unpack(DelegateResourceContract.class);
    AccountCapsule ownerCapsule = accountStore.get(
        delegateResourceContract.getOwnerAddress().toByteArray());

    DynamicPropertiesStore dynamicStore = chainBaseManager.getDynamicPropertiesStore();
    long delegateBalance = delegateResourceContract.getBalance();
    boolean lock = delegateResourceContract.getLock();
    long lockPeriod = getLockPeriod(dynamicStore.supportMaxDelegateLockPeriod(),
        delegateResourceContract);
    byte[] receiverAddress = delegateResourceContract.getReceiverAddress().toByteArray();
    byte[] ownerAddress = getOwnerAddress().toByteArray();

    // Delegate resource to receiver
    switch (delegateResourceContract.getResource()) {
        case BANDWIDTH:
            delegateResource(ownerAddress, receiverAddress, true,
                delegateBalance, lock, lockPeriod);

            // Update delegator account
            ownerCapsule.addDelegatedFrozenV2BalanceForBandwidth(delegateBalance);
            ownerCapsule.addFrozenBalanceForBandwidthV2(-delegateBalance);
            break;

        case ENERGY:
            delegateResource(ownerAddress, receiverAddress, false,
                delegateBalance, lock, lockPeriod);

            // Update delegator account
            ownerCapsule.addDelegatedFrozenV2BalanceForEnergy(delegateBalance);
            ownerCapsule.addFrozenBalanceForEnergyV2(-delegateBalance);
            break;
    }

    accountStore.put(ownerCapsule.createDbKey(), ownerCapsule);
    ret.setStatus(fee, code.SUCESS);

    return true;
}
```

#### The delegateResource Helper

**Lines 282-326:**

```java
private void delegateResource(byte[] ownerAddress, byte[] receiverAddress, boolean isBandwidth,
                              long balance, boolean lock, long lockPeriod) {
    AccountStore accountStore = chainBaseManager.getAccountStore();
    DynamicPropertiesStore dynamicPropertiesStore = chainBaseManager.getDynamicPropertiesStore();
    DelegatedResourceStore delegatedResourceStore = chainBaseManager.getDelegatedResourceStore();
    DelegatedResourceAccountIndexStore delegatedResourceAccountIndexStore =
        chainBaseManager.getDelegatedResourceAccountIndexStore();

    // 1. Unlock expired delegations first
    long now = chainBaseManager.getDynamicPropertiesStore().getLatestBlockHeaderTimestamp();
    delegatedResourceStore.unLockExpireResource(ownerAddress, receiverAddress, now);

    // 2. Calculate expiration time
    long expireTime = 0;
    if (lock) {
        expireTime = now + lockPeriod * BLOCK_PRODUCED_INTERVAL;
    }

    // 3. Create or update DelegatedResource record
    byte[] key = DelegatedResourceCapsule.createDbKeyV2(ownerAddress, receiverAddress, lock);
    DelegatedResourceCapsule delegatedResourceCapsule = delegatedResourceStore.get(key);
    if (delegatedResourceCapsule == null) {
        delegatedResourceCapsule = new DelegatedResourceCapsule(
            ByteString.copyFrom(ownerAddress),
            ByteString.copyFrom(receiverAddress));
    }

    if (isBandwidth) {
        delegatedResourceCapsule.addFrozenBalanceForBandwidth(balance, expireTime);
    } else {
        delegatedResourceCapsule.addFrozenBalanceForEnergy(balance, expireTime);
    }
    delegatedResourceStore.put(key, delegatedResourceCapsule);

    // 4. Update index store
    delegatedResourceAccountIndexStore.delegateV2(ownerAddress, receiverAddress,
        dynamicPropertiesStore.getLatestBlockHeaderTimestamp());

    // 5. Update receiver account
    AccountCapsule receiverCapsule = accountStore.get(receiverAddress);
    if (isBandwidth) {
        receiverCapsule.addAcquiredDelegatedFrozenV2BalanceForBandwidth(balance);
    } else {
        receiverCapsule.addAcquiredDelegatedFrozenV2BalanceForEnergy(balance);
    }
    accountStore.put(receiverCapsule.createDbKey(), receiverCapsule);
}
```

### State Changes During Delegation

**Before Delegation:**

```javascript
Delegator Account {
  frozen_v2: [{type: ENERGY, amount: 1000000000000}]  // 1M TRX frozen
  delegated_frozen_v2_balance_for_energy: 0
  energy_usage: 200000  // Using some energy
}

Receiver Account {
  frozen_v2: []
  acquired_delegated_frozen_v2_balance_for_energy: 0
}

Network {
  TotalEnergyWeight: 60,000,000,000 TRX
  TotalEnergyCurrentLimit: 180,000,000,000
}

Delegator Energy Limit: (1M / 60B) × 180B = 3,000,000 units/day
Receiver Energy Limit: 0 units/day
```

**Transaction:**
```javascript
DelegateResource {
  owner: "TDelegator...Address",
  receiver: "TReceiver...Address",
  balance: 500000000000,  // Delegate 500k TRX worth of energy
  resource: ENERGY,
  lock: true,
  lock_period: 86400  // 3 days in slots
}
```

**After Delegation:**

```javascript
Delegator Account {
  frozen_v2: [{type: ENERGY, amount: 500000000000}]  // Now only 500k frozen
  delegated_frozen_v2_balance_for_energy: 500000000000  // 500k delegated out
  energy_usage: 200000  // Still same usage
}

Receiver Account {
  frozen_v2: []  // Still no own frozen balance
  acquired_delegated_frozen_v2_balance_for_energy: 500000000000  // 500k received
}

DelegatedResource Record {
  from: "TDelegator...Address",
  to: "TReceiver...Address",
  frozenV2_balance_for_energy: 500000000000,
  expire_time_for_energy_v2: now + (86400 × 3000) = now + 3 days
}

DelegatedResourceAccountIndex (Delegator) {
  toAccounts: ["TReceiver...Address"]
}

DelegatedResourceAccountIndex (Receiver) {
  fromAccounts: ["TDelegator...Address"]
}

Delegator Energy Limit: (500k / 60B) × 180B = 1,500,000 units/day (HALVED!)
Receiver Energy Limit: (500k / 60B) × 180B = 1,500,000 units/day (NEW!)

Total in system: 3M units/day (same as before, just redistributed)
```

**Critical Observations:**

1. **Delegator's frozen balance REDUCED**: From 1M to 500k
2. **Delegator's resources IMMEDIATELY REDUCED**: From 3M to 1.5M energy/day
3. **Receiver's resources IMMEDIATELY GAINED**: From 0 to 1.5M energy/day
4. **TRX doesn't move**: Delegator still owns all TRX
5. **Lock period prevents undelegation**: Must wait 3 days

---

## 4.3 Available Balance for Delegation: The Critical Formula

The most important and misunderstood aspect of delegation: **you cannot delegate frozen balance that is currently backing active resource usage**.

### The Problem

**Scenario:**
```javascript
Frozen for energy: 1,000,000 TRX
Energy limit: 3,000,000 units/day
Current energy usage: 1,500,000 units (50% utilization)
```

**Question:** How much can you safely delegate?

**Wrong Answer:** 1,000,000 TRX (all of it)
**Wrong Answer:** 500,000 TRX (unused capacity)
**Right Answer:** ~500,000 TRX, but let's derive it properly

### The Formula Derivation

**Step 1: Calculate resource usage in frozen TRX equivalent**

```java
// From DelegateResourceActuator.java:172-184
long energyUsage = (long) (ownerCapsule.getEnergyUsage() * TRX_PRECISION *
    ((double) dynamicStore.getTotalEnergyWeight() /
     dynamicStore.getTotalEnergyCurrentLimit()));
```

**Mathematical Formula:**
```
FrozenTRX_InUse = EnergyUsage × TRX_PRECISION × (TotalEnergyWeight / TotalEnergyCurrentLimit)
```

**Step 2: Calculate available for delegation**

```java
long v2EnergyUsage = getV2EnergyUsage(ownerCapsule, energyUsage, this.disableJavaLangMath());

if (ownerCapsule.getFrozenV2BalanceForEnergy() - v2EnergyUsage < delegateBalance) {
    throw new ContractValidateException("Insufficient available balance");
}
```

**Complete Formula:**
```
AvailableForDelegation = TotalFrozen - InUseFrozen - AlreadyDelegated

Where:
  InUseFrozen = CurrentUsage × TRX_PRECISION × (TotalWeight / TotalLimit)
```

### Worked Example: Energy Delegation

**Account State:**
```javascript
Frozen for energy: 1,000,000 TRX (1,000,000,000,000 sun)
Already delegated: 200,000 TRX
Current energy usage: 1,500,000 units
```

**Network State:**
```javascript
TotalEnergyWeight: 60,000,000,000 TRX
TotalEnergyCurrentLimit: 180,000,000,000 units
```

**Step 1: Calculate frozen TRX backing current usage**
```
InUseFrozen = 1,500,000 × 1,000,000 × (60,000,000,000 / 180,000,000,000)
            = 1,500,000 × 1,000,000 × (1/3)
            = 1,500,000,000,000 / 3
            = 500,000,000,000 sun
            = 500,000 TRX
```

**Step 2: Calculate available**
```
Available = 1,000,000 - 500,000 - 200,000
          = 300,000 TRX
```

**Result:** Can delegate up to 300,000 TRX safely.

### Worked Example: Bandwidth Delegation

**Account State:**
```javascript
Frozen for bandwidth: 500,000 TRX
Already delegated: 100,000 TRX
Current bandwidth usage: 720,000 bytes (in last 24h)
```

**Network State:**
```javascript
TotalNetWeight: 15,000,000,000 TRX
TotalNetLimit: 43,200,000,000 bytes
```

**Step 1: Calculate frozen TRX backing current usage**
```
InUseFrozen = 720,000 × 1,000,000 × (15,000,000,000 / 43,200,000,000)
            = 720,000 × 1,000,000 × 0.347222
            = 250,000,000,000 sun
            = 250,000 TRX
```

**Step 2: Calculate available**
```
Available = 500,000 - 250,000 - 100,000
          = 150,000 TRX
```

**Result:** Can delegate up to 150,000 TRX.

### Why This Matters

**If you try to delegate too much:**

```javascript
// Attempt to delegate 400k TRX (more than available 300k)
DelegateResource({
  balance: 400000000000,
  resource: 'ENERGY'
})

// Result: Transaction FAILS with:
// "delegateBalance must be <= available FreezeEnergyV2 balance"
```

**Production Implication:**
Always calculate available balance BEFORE attempting delegation:

```javascript
async function calculateAvailableDelegation(address, resourceType) {
  const account = await tronWeb.trx.getAccount(address);
  const resources = await tronWeb.trx.getAccountResources(address);
  const networkState = await getNetworkState();

  let frozen, usage, totalWeight, totalLimit, alreadyDelegated;

  if (resourceType === 'ENERGY') {
    frozen = getFrozenV2ForEnergy(account);
    usage = resources.EnergyUsed || 0;
    totalWeight = networkState.totalEnergyWeight;
    totalLimit = networkState.totalEnergyCurrentLimit;
    alreadyDelegated = account.delegated_frozenV2_balance_for_energy || 0;
  } else {
    frozen = getFrozenV2ForBandwidth(account);
    usage = resources.NetUsed || 0;
    totalWeight = networkState.totalNetWeight;
    totalLimit = networkState.totalNetLimit;
    alreadyDelegated = account.delegated_frozenV2_balance_for_bandwidth || 0;
  }

  // Calculate frozen TRX backing current usage
  const inUseFrozen = Math.floor(usage * 1000000 * (totalWeight / totalLimit));

  // Calculate available
  const available = frozen - inUseFrozen - alreadyDelegated;

  return Math.max(0, available);
}
```

---

## 4.4 Lock Periods and Undelegation

Delegation can be locked or unlocked, affecting when you can reclaim resources.

### Lock Period Calculation

**Source:** `DelegateResourceActuator.java:251-259`

```java
private long getLockPeriod(boolean supportMaxDelegateLockPeriod,
                          DelegateResourceContract delegateResourceContract) {
    long lockPeriod = delegateResourceContract.getLockPeriod();
    if (supportMaxDelegateLockPeriod) {
        return lockPeriod == 0 ? DELEGATE_PERIOD / BLOCK_PRODUCED_INTERVAL : lockPeriod;
    } else {
        return DELEGATE_PERIOD / BLOCK_PRODUCED_INTERVAL;
    }
}

// DELEGATE_PERIOD = 3 * 86_400_000L  // 3 days in milliseconds
// BLOCK_PRODUCED_INTERVAL = 3000     // 3 seconds
// Default lock period = 259,200,000 / 3000 = 86,400 slots = 3 days
```

### Locked vs Unlocked Delegation

**Unlocked Delegation (`lock = false`):**
```javascript
DelegateResource({
  balance: 500000000000,
  resource: 'ENERGY',
  lock: false  // or omit lock field
})

// Can undelegate immediately (if resources not in use)
// Flexible for short-term resource provision
```

**Locked Delegation (`lock = true, lock_period = 86400`):**
```javascript
DelegateResource({
  balance: 500000000000,
  resource: 'ENERGY',
  lock: true,
  lock_period: 86400  // 3 days in slots (3 days × 24h × 3600s / 3s)
})

// Cannot undelegate for 3 days
// Provides stability for receiver
// Use case: Rental agreements, subsidization contracts
```

**Custom Lock Period:**
```javascript
DelegateResource({
  balance: 500000000000,
  resource: 'ENERGY',
  lock: true,
  lock_period: 288000  // 10 days (10 × 24 × 3600 / 3 = 288,000 slots)
})

// Locked for 10 days
// Must be within maxDelegateLockPeriod (set by network)
```

### Undelegation Mechanics

**Type 58: UnDelegateResourceContract**

**Source:** `/actuator/src/main/java/org/tron/core/actuator/UnDelegateResourceActuator.java`

**Validation:**
```java
// Check delegation exists
byte[] key = DelegatedResourceCapsule.createDbKeyV2(ownerAddress, receiverAddress, lock);
DelegatedResourceCapsule delegatedResourceCapsule = delegatedResourceStore.get(key);
if (delegatedResourceCapsule == null) {
    throw new ContractValidateException("Delegation not found");
}

// Check lock period expired
long now = dynamicStore.getLatestBlockHeaderTimestamp();
if (lock) {
    long expireTime = getExpireTime(delegatedResourceCapsule, resource);
    if (now < expireTime) {
        throw new ContractValidateException(
            "Delegation is locked. Expire time: " + expireTime);
    }
}

// Check receiver is not using delegated resources
// (Complex check similar to delegation availability)
```

**Execution:**
```java
// Reduce or remove delegation
if (unDelegateBalance >= delegatedAmount) {
    // Remove entire delegation
    delegatedResourceStore.delete(key);
} else {
    // Reduce delegation
    delegatedResourceCapsule.addFrozenBalance(-unDelegateBalance, resource);
    delegatedResourceStore.put(key, delegatedResourceCapsule);
}

// Update accounts
ownerCapsule.addDelegatedFrozenV2Balance(-unDelegateBalance, resource);
ownerCapsule.addFrozenV2Balance(unDelegateBalance, resource);

receiverCapsule.addAcquiredDelegatedFrozenV2Balance(-unDelegateBalance, resource);
```

### Critical Constraint: Receiver Usage Check

**You CANNOT undelegate if the receiver is actively using the delegated resources.**

**Example:**
```javascript
// Delegated: 500k TRX worth of energy (1.5M units/day)
// Receiver currently using: 1M units

// Try to undelegate:
UnDelegateResource({
  receiver: "TReceiver...Address",
  balance: 500000000000,
  resource: 'ENERGY'
})

// Result: FAILS
// Reason: Receiver has 1M units in use, backed by your delegation
// Must wait for receiver's usage to decay below threshold
```

**The recovery window matters here:**
- Receiver's usage decays over 24 hours
- After 12 hours, usage drops to ~500k units
- After 18 hours, usage drops to ~250k units
- After 24 hours, usage fully recovered
- Can now undelegate

**Production Strategy:**
```javascript
async function safeUndelegate(receiver, amount, resourceType) {
  // Check receiver's current usage
  const receiverResources = await tronWeb.trx.getAccountResources(receiver);
  const usage = resourceType === 'ENERGY' ?
    receiverResources.EnergyUsed : receiverResources.NetUsed;

  if (usage > 0) {
    console.log(`Receiver has ${usage} ${resourceType} in use. Waiting for recovery...`);

    // Calculate when usage will decay enough
    const lastConsumeTime = resourceType === 'ENERGY' ?
      receiverResources.latest_consume_time_for_energy :
      receiverResources.latest_consume_time;

    const recoveryTime = calculateFullRecoveryTime(lastConsumeTime);
    console.log(`Can safely undelegate after: ${new Date(recoveryTime)}`);

    return false;
  }

  // Safe to undelegate
  return await undelegateResource(receiver, amount, resourceType);
}
```

---

## 4.5 Delegation Use Cases and Economics

### Use Case 1: dApp Subsidization

**Scenario:** Your dApp wants to provide free transactions to users.

**Traditional Approach:**
- Burn TRX for every user transaction
- Cost: 50k energy × 420 sun = 21 TRX per transaction
- 1000 tx/day = 21,000 TRX/day = $2,100/day at $0.10/TRX

**Delegation Approach:**
```javascript
// One-time setup:
// 1. Freeze 70,000,000 TRX for energy
// 2. Energy limit: ~210,000,000 units/day
// 3. Delegate 50M energy to user pool contract

// User flow:
// 1. User registers
// 2. System delegates 150k energy to user (from pool)
// 3. User can make 3 transactions
// 4. After 24h, delegation auto-recovers
// 5. User can transact again

// Cost: $0 ongoing (just capital lock)
// Savings: $2,100/day × 365 = $766,500/year
```

**Implementation:**
```javascript
class ResourcePool {
  constructor(poolAddress, frozenEnergy) {
    this.poolAddress = poolAddress;
    this.totalEnergy = frozenEnergy;
    this.delegations = new Map();
  }

  async delegateToUser(userAddress, amount, duration) {
    // Check available
    const available = await this.getAvailableEnergy();
    if (amount > available) {
      throw new Error('Insufficient pool energy');
    }

    // Delegate with time lock
    const lockPeriod = Math.floor(duration / 3000);  // Convert ms to slots
    await tronWeb.transactionBuilder.delegateResource(
      amount,
      userAddress,
      'ENERGY',
      this.poolAddress,
      true,
      lockPeriod
    );

    // Track
    this.delegations.set(userAddress, {
      amount,
      expires: Date.now() + duration
    });
  }

  async reclaimExpired() {
    const now = Date.now();
    for (const [user, delegation] of this.delegations) {
      if (now >= delegation.expires) {
        try {
          await tronWeb.transactionBuilder.undelegateResource(
            delegation.amount,
            user,
            'ENERGY',
            this.poolAddress
          );
          this.delegations.delete(user);
        } catch (e) {
          console.log(`Cannot reclaim from ${user}: ${e.message}`);
        }
      }
    }
  }
}
```

### Use Case 2: Resource Rental Marketplace

**Business Model:**
- You have 10M TRX frozen (worth $1M at $0.10)
- You use only 10% for your own operations
- Rent out the remaining 90% to others
- Charge 5% below burn rate

**Economics:**
```javascript
// Your capacity:
Frozen: 10,000,000 TRX
Energy: ~30,000,000 units/day
Own usage: 3,000,000 units/day (10%)
Available to rent: 27,000,000 units/day

// Burn rate pricing:
27M energy × 420 sun = 11,340,000,000 sun = 11,340 TRX/day
Monthly burn equivalent: 11,340 × 30 = 340,200 TRX = $34,020/month

// Your rental price (95% of burn):
340,200 × 0.95 = 323,190 TRX/month = $32,319/month

// Your profit:
Revenue: $32,319/month
Cost: $0 (just opportunity cost of frozen capital)
Annual revenue: $387,828
ROI: 38.7% per year on $1M capital
```

**Platform Implementation:**
```javascript
class DelegationMarketplace {
  constructor() {
    this.providers = new Map();  // Address -> available resources
    this.renters = new Map();    // Address -> rented resources
  }

  async listResources(provider, amount, resourceType, pricePerDay) {
    // Verify provider has available balance
    const available = await calculateAvailableDelegation(provider, resourceType);
    if (amount > available) {
      throw new Error('Insufficient available resources');
    }

    this.providers.set(provider, {
      amount,
      resourceType,
      pricePerDay,
      available: amount
    });
  }

  async rentResources(renter, amount, resourceType, days) {
    // Find cheapest provider
    const provider = this.findBestProvider(amount, resourceType);
    if (!provider) {
      throw new Error('No providers available');
    }

    // Calculate cost
    const totalCost = provider.pricePerDay * days;

    // Collect payment
    await this.collectPayment(renter, provider.address, totalCost);

    // Delegate resources
    const lockPeriod = Math.floor((days * 24 * 3600 * 1000) / 3000);
    await tronWeb.transactionBuilder.delegateResource(
      amount,
      renter,
      resourceType,
      provider.address,
      true,
      lockPeriod
    );

    // Track rental
    this.renters.set(renter, {
      provider: provider.address,
      amount,
      resourceType,
      expires: Date.now() + (days * 24 * 3600 * 1000)
    });
  }

  findBestProvider(amount, resourceType) {
    let best = null;
    for (const [address, listing] of this.providers) {
      if (listing.resourceType === resourceType &&
          listing.available >= amount &&
          (!best || listing.pricePerDay < best.pricePerDay)) {
        best = { address, ...listing };
      }
    }
    return best;
  }
}
```

### Use Case 3: Multi-Account Management

**Scenario:** Enterprise with 50 service accounts

**Challenge:**
- Each account needs 100k energy/day
- Total: 5M energy/day
- Traditional: Freeze TRX in each account separately
- Problem: Inefficient capital allocation

**Solution:** Central delegation hub
```javascript
// Instead of:
50 accounts × 16,700 TRX each = 835,000 TRX total

// Do this:
1 hub account: Freeze 835,000 TRX
50 service accounts: Receive delegation as needed

// Benefits:
- Centralized management
- Dynamic reallocation
- Unused capacity can be rented out
- Easy monitoring and optimization
```

**Implementation:**
```javascript
class CentralResourceHub {
  constructor(hubAddress, serviceAccounts) {
    this.hubAddress = hubAddress;
    this.serviceAccounts = serviceAccounts;
    this.allocations = new Map();
  }

  async balanceAllocations() {
    // Measure usage across all accounts
    const usage = await this.measureUsage();

    // Reallocate based on actual usage
    for (const account of this.serviceAccounts) {
      const currentAllocation = this.allocations.get(account) || 0;
      const actualUsage = usage.get(account) || 0;
      const utilizationRate = actualUsage / currentAllocation;

      if (utilizationRate > 0.8) {
        // Over-utilized: allocate more
        const increase = currentAllocation * 0.2;
        await this.increaseAllocation(account, increase);
      } else if (utilizationRate < 0.3) {
        // Under-utilized: reduce allocation
        const decrease = currentAllocation * 0.3;
        await this.decreaseAllocation(account, decrease);
      }
    }
  }

  async increaseAllocation(account, amount) {
    await tronWeb.transactionBuilder.delegateResource(
      amount,
      account,
      'ENERGY',
      this.hubAddress,
      false  // Unlocked for flexibility
    );
    this.allocations.set(account,
      (this.allocations.get(account) || 0) + amount);
  }

  async decreaseAllocation(account, amount) {
    await tronWeb.transactionBuilder.undelegateResource(
      amount,
      account,
      'ENERGY',
      this.hubAddress
    );
    this.allocations.set(account,
      this.allocations.get(account) - amount);
  }
}
```

---

## Code Laboratory

### Exercise 4.1: Delegation Calculator

**Objective:** Build a comprehensive delegation availability calculator

**Requirements:**
- Calculate available balance for delegation
- Account for current usage
- Account for existing delegations
- Support both bandwidth and energy
- Handle edge cases

**Solution provided in repository**

### Exercise 4.2: Delegation Marketplace MVP

**Objective:** Build a basic resource rental marketplace

**Features:**
- Providers can list available resources
- Renters can browse and rent
- Automatic delegation/undelegation
- Payment handling
- Usage tracking

### Exercise 4.3: Multi-Account Resource Manager

**Objective:** Build an enterprise resource hub

**Features:**
- Manage resources for N service accounts
- Dynamic reallocation based on usage
- Centralized monitoring
- Cost optimization
- Alert on under/over-utilization

---

## Production Checklist

### Before Delegating
- [ ] Calculate available balance (account for current usage)
- [ ] Verify receiver address is valid (not self, not contract)
- [ ] Decide lock period based on use case
- [ ] Document delegation for tracking
- [ ] Consider delegation recovery time

### After Delegating
- [ ] Verify delegation recorded in DelegatedResourceStore
- [ ] Confirm receiver's resource limits increased
- [ ] Monitor delegator's remaining capacity
- [ ] Track lock period expiration
- [ ] Set up undelegation reminder

### Before Undelegating
- [ ] Check lock period has expired
- [ ] Verify receiver is not using delegated resources
- [ ] Calculate impact on receiver's operations
- [ ] Coordinate with receiver if needed
- [ ] Prepare alternative resource provision if critical

### Managing Delegations
- [ ] Track all active delegations
- [ ] Monitor receiver usage patterns
- [ ] Optimize delegation amounts based on actual usage
- [ ] Automate rebalancing where possible
- [ ] Review delegation economics quarterly

---

## Common Pitfalls

### Pitfall #1: Delegating In-Use Resources

**Mistake:** Trying to delegate all frozen TRX when currently using resources

**Reality:** Can only delegate unused frozen balance

**Fix:** Always calculate available balance first

### Pitfall #2: Forgetting Lock Periods

**Mistake:** Delegating with lock, then trying to undelegate immediately

**Reality:** Must wait for lock period to expire

**Fix:** Use unlocked delegation for flexibility, locked for stability

### Pitfall #3: Delegating to Contract Addresses

**Mistake:** Trying to delegate to a smart contract

**Reality:** Delegation to contracts is forbidden

**Fix:** Validate receiver is EOA (externally owned account)

### Pitfall #4: Not Checking Receiver Usage

**Mistake:** Undelegating while receiver is using resources

**Reality:** Undelegation fails if resources in use

**Fix:** Wait for receiver's usage to decay, or coordinate undelegation timing

### Pitfall #5: Ignoring Network Weight Changes

**Mistake:** Delegating fixed amounts without accounting for network changes

**Reality:** Delegation value fluctuates with network weights

**Fix:** Monitor network weights, adjust delegations as needed

---

## Quick Reference Card

### Delegate Resources
```javascript
tronWeb.transactionBuilder.delegateResource(
  balance,        // Amount in sun
  receiverAddress,
  resourceType,   // 'BANDWIDTH' or 'ENERGY'
  ownerAddress,
  lock,          // true/false
  lockPeriod     // In slots (optional if not locked)
);
```

### Undelegate Resources
```javascript
tronWeb.transactionBuilder.undelegateResource(
  balance,
  receiverAddress,
  resourceType,
  ownerAddress
);
```

### Calculate Available for Delegation
```javascript
const available = frozen - inUseFrozen - alreadyDelegated;
where:
  inUseFrozen = usage × 1000000 × (totalWeight / totalLimit)
```

### Key Constraints
```
Minimum delegation: 1 TRX (1,000,000 sun)
Cannot delegate to: Self, contracts
Cannot undelegate: If locked, if receiver using resources
Lock period: 0 to maxDelegateLockPeriod (typically up to 30 days)
```

---

## Summary

Resource delegation is TRON's killer feature for capital efficiency:

1. **Economics:** Earn passive income from frozen TRX
2. **Flexibility:** Dynamic allocation across accounts
3. **Constraints:** Cannot delegate in-use resources
4. **Lock Periods:** Trade flexibility for stability
5. **Marketplaces:** Enable resource rental economy

**Critical Takeaway:** Delegation allows 100% utilization of frozen capital, turning idle TRX into productive assets.

In Chapter 5, we'll dive into energy costs—understanding VM operation costs, energy_factor penalties, and contract optimization strategies.

---

**Next Chapter:** Energy Cost Analysis - Master VM operation costs and optimize contracts for minimal energy consumption
