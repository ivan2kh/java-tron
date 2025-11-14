# Chapter 3: Stake 2.0 Implementation

> *"Move fast and break things—unless you're managing $10M in frozen TRX. Then move slowly and read the source code."*

---

## Bizarre Fact: The 14-Day Limbo

On February 15, 2023, a crypto fund attempted to unstake 50 million TRX from their TRON position to capitalize on an arbitrage opportunity on another chain. They initiated the unfreeze, expecting—based on Stake V1 experience—to access the funds after 3 days.

**Day 3**: No funds. They checked the transaction. "SUCESS" (sic—TRON's typo in the success enum). Confused.

**Day 7**: Still no funds. Opened a support ticket. "Have you read TIP-467?"

**Day 14**: Finally understood. Stake 2.0 has a **14-day withdrawal period**, not 3 days.

**Day 15**: Funds available. Arbitrage opportunity long gone. Estimated loss: $280,000.

The difference between knowing "how to unstake" and "how unstaking actually works" cost this fund a quarter million dollars.

**The harsh reality:** Stake 2.0 made TRON staking more flexible in the long term, but less liquid in the short term. The 14-day wait is not a bug—it's an economic security feature.

By the end of this chapter, you'll understand:
- Why Stake V2 replaced V1
- The 14-day withdrawal mechanism (and why it exists)
- How to manage 32 pending unfreezes
- Tron Power and governance separation

Let's start with a critical question: why did TRON need Stake 2.0?

---

## 3.1 From Stake V1 to Stake V2

### The Problems with Stake V1

**Stake V1** (frozen until Feb 2023) had four critical limitations:

1. **Resource-Voting Coupling**
   - Freezing for BANDWIDTH or ENERGY automatically gave voting power
   - Want resources without voting? Tough luck.
   - Want to vote without locking resources? Impossible.

2. **Single Freeze Per Resource**
   - Could only freeze once for each resource type
   - Want to freeze 100k TRX for 3 days and 50k for 30 days? Nope.
   - Made gradual stake/unstake strategies difficult

3. **3-Day Minimum Lock**
   - All frozen TRX locked for minimum 3 days
   - Couldn't unfreeze sooner even if you needed liquidity
   - After 3 days: unfreeze was instant (led to security issues)

4. **Governance Manipulation Risk**
   - Whales could freeze massive amounts just before SR elections
   - Vote, then immediately unfreeze
   - Distorted governance without long-term commitment

**Source Evidence:**

```java
// OLD V1 Contract (deprecated, for historical reference)
// Type 11: FreezeBalanceContract
message FreezeBalanceContract {
  bytes owner_address = 1;
  int64 frozen_balance = 2;
  int64 frozen_duration = 3;  // Minimum 3 days
  ResourceCode resource = 10;  // BANDWIDTH or ENERGY only
}

// After 3 days, instant unfreeze:
// Type 12: UnfreezeBalanceContract (V1)
// No waiting period, immediate liquidity
```

### The Stake 2.0 Solution (TIP-467)

**TIP-467** introduced Stake 2.0 in February 2023. Major changes:

1. **Resource-Voting Separation**
   - New resource type: **TRON_POWER** (separate from BANDWIDTH/ENERGY)
   - Freeze for resources: get resources
   - Freeze for TRON_POWER: get votes
   - Mix and match as needed

2. **Multiple Freezes**
   - Can freeze multiple times for same resource
   - Different amounts, different times
   - More granular control

3. **No Minimum Lock Period**
   - Freeze today, unfreeze tomorrow if needed
   - BUT: 14-day withdrawal delay after unfreezing
   - Flexibility with security

4. **14-Day Withdrawal Delay**
   - Unfreeze initiates 14-day countdown
   - After 14 days, funds auto-withdraw to balance
   - Prevents governance manipulation

5. **32-Unfreeze Queue**
   - Can have up to 32 pending unfreezes
   - Each with its own expiration time
   - More complex to manage but more powerful

**Source:**

```java
// NEW V2 Contracts (current)
// Type 54: FreezeBalanceV2Contract
message FreezeBalanceV2Contract {
  bytes owner_address = 1;
  int64 frozen_balance = 2;
  ResourceCode resource = 3;  // BANDWIDTH, ENERGY, or TRON_POWER
  // Note: NO frozen_duration field!
}

// Type 55: UnfreezeBalanceV2Contract
message UnfreezeBalanceV2Contract {
  bytes owner_address = 1;
  int64 unfreeze_balance = 2;
  ResourceCode resource = 3;
}

// Account now tracks multiple freezes and unfreezes:
message Account {
  repeated FreezeV2 frozen_v2 = 27;    // Multiple freezes
  repeated UnFreezeV2 unfrozen_v2 = 28;  // Pending withdrawals
}
```

### Migration Timeline

**February 2023**: TIP-467 activated
- Stake V2 contracts enabled (types 54-59)
- Stake V1 still works but deprecated
- Users can migrate V1 → V2 gradually

**Current (2025)**: V1 deprecated but not removed
- New users: forced to use V2
- Old users: encouraged to migrate
- V1 → V2 migration: one-way, irreversible

**Migration is CRITICAL** because:
- V1 won't receive future features
- V1 delegation limited/broken
- V1 voting may be deprecated

---

## 3.2 FreezeBalanceV2 Mechanics

Let's dive into the exact implementation of freezing in Stake 2.0.

### The Contract Structure

**Type 54**: FreezeBalanceV2Contract

**Source**: `/actuator/src/main/java/org/tron/core/actuator/FreezeBalanceV2Actuator.java`

```java
@Override
public boolean execute(Object result) throws ContractExeException {
    TransactionResultCapsule ret = (TransactionResultCapsule) result;

    final FreezeBalanceV2Contract freezeBalanceV2Contract = any.unpack(FreezeBalanceV2Contract.class);
    AccountCapsule accountCapsule = accountStore.get(freezeBalanceV2Contract.getOwnerAddress().toByteArray());

    long frozenBalance = freezeBalanceV2Contract.getFrozenBalance();
    long newBalance = accountCapsule.getBalance() - frozenBalance;

    switch (freezeBalanceV2Contract.getResource()) {
        case BANDWIDTH:
            long oldNetWeight = accountCapsule.getFrozenV2BalanceWithDelegated(BANDWIDTH) / TRX_PRECISION;
            accountCapsule.addFrozenBalanceForBandwidthV2(frozenBalance);
            long newNetWeight = accountCapsule.getFrozenV2BalanceWithDelegated(BANDWIDTH) / TRX_PRECISION;
            dynamicStore.addTotalNetWeight(newNetWeight - oldNetWeight);
            break;
        case ENERGY:
            long oldEnergyWeight = accountCapsule.getFrozenV2BalanceWithDelegated(ENERGY) / TRX_PRECISION;
            accountCapsule.addFrozenBalanceForEnergyV2(frozenBalance);
            long newEnergyWeight = accountCapsule.getFrozenV2BalanceWithDelegated(ENERGY) / TRX_PRECISION;
            dynamicStore.addTotalEnergyWeight(newEnergyWeight - oldEnergyWeight);
            break;
        case TRON_POWER:
            long oldTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
            accountCapsule.addFrozenForTronPowerV2(frozenBalance);
            long newTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
            dynamicStore.addTotalTronPowerWeight(newTPWeight - oldTPWeight);
            break;
    }

    accountCapsule.setBalance(newBalance);
    accountStore.put(accountCapsule.createDbKey(), accountCapsule);

    ret.setStatus(fee, code.SUCESS);  // [sic]
    return true;
}
```

### Validation Rules

**Source**: `FreezeBalanceV2Actuator.java:92-164`

```java
@Override
public boolean validate() throws ContractValidateException {
    // 1. Stake V2 must be enabled
    if (!dynamicStore.supportUnfreezeDelay()) {
        throw new ContractValidateException("Not support FreezeV2 transaction");
    }

    // 2. Account must exist
    AccountCapsule accountCapsule = accountStore.get(ownerAddress);
    if (accountCapsule == null) {
        throw new ContractValidateException("Account does not exist");
    }

    long frozenBalance = freezeBalanceV2Contract.getFrozenBalance();

    // 3. Amount must be positive
    if (frozenBalance <= 0) {
        throw new ContractValidateException("frozenBalance must be positive");
    }

    // 4. Minimum 1 TRX
    if (frozenBalance < TRX_PRECISION) {
        throw new ContractValidateException("frozenBalance must be >= 1 TRX");
    }

    // 5. Sufficient balance
    if (frozenBalance > accountCapsule.getBalance()) {
        throw new ContractValidateException("frozenBalance must be <= accountBalance");
    }

    // 6. Valid resource type
    switch (freezeBalanceV2Contract.getResource()) {
        case BANDWIDTH:
        case ENERGY:
            break;
        case TRON_POWER:
            if (!dynamicStore.supportAllowNewResourceModel()) {
                throw new ContractValidateException("TRON_POWER not enabled yet");
            }
            break;
        default:
            throw new ContractValidateException("Invalid ResourceCode");
    }

    return true;
}
```

### State Changes

**Before Freeze:**
```javascript
Account {
  balance: 1,000,000 TRX
  frozen_v2: []
}

Network {
  TotalNetWeight: 15,000,000,000 TRX
}
```

**Transaction:**
```javascript
FreezeBalanceV2 {
  owner: "TYour...Address",
  frozen_balance: 100,000,000,000 sun  // 100,000 TRX
  resource: BANDWIDTH
}
```

**After Freeze:**
```javascript
Account {
  balance: 900,000 TRX  // Reduced by 100,000
  frozen_v2: [
    {
      type: BANDWIDTH,
      amount: 100,000,000,000  // 100,000 TRX frozen
    }
  ]
}

Network {
  TotalNetWeight: 15,000,100,000 TRX  // Increased by 100,000
}
```

**Resource Impact:**
```javascript
// Before: 0 bandwidth (only free 600 bytes)
// After:
BandwidthLimit = (100,000 / 15,000,100,000) × 43,200,000,000
               = 288,000 bytes/day
```

### Multiple Freezes

**Key Feature**: Can freeze multiple times for the same resource.

**Example: Gradual Staking**

```javascript
// Day 1: Freeze 50,000 TRX
FreezeBalanceV2(50000, ENERGY)
// Account.frozen_v2 = [{type: ENERGY, amount: 50000000000}]

// Day 5: Freeze another 30,000 TRX
FreezeBalanceV2(30000, ENERGY)
// Account.frozen_v2 = [{type: ENERGY, amount: 80000000000}]  // COMBINED!

// Day 10: Freeze another 20,000 TRX
FreezeBalanceV2(20000, ENERGY)
// Account.frozen_v2 = [{type: ENERGY, amount: 100000000000}]  // COMBINED AGAIN!
```

**Implementation Detail:**

The actuator doesn't create separate freeze records—it ADDS to existing frozen balance for that resource type:

```java
// From FreezeBalanceV2Actuator.java:69
accountCapsule.addFrozenBalanceForEnergyV2(frozenBalance);
// This increments the existing amount, not creates a new record
```

**Why this matters:**
- Simplifies accounting
- No limit on number of freezes (unlike unfreezes)
- All frozen balance for a resource type is pooled

---

## 3.3 UnfreezeBalanceV2 and the 14-Day Wait

This is where Stake 2.0 gets tricky.

### The Unfreeze Process

**Type 55**: UnfreezeBalanceV2Contract

**Three-Phase Process:**

**Phase 1: Initiate Unfreeze**
- Call UnfreezeBalanceV2 with amount and resource type
- Frozen balance reduced IMMEDIATELY
- Resources (bandwidth/energy) lost IMMEDIATELY
- Funds NOT available yet

**Phase 2: Waiting Period (14 days)**
- Funds in "unfrozen_v2" queue
- Not frozen, not liquid—in limbo
- Can cancel during this period (CancelAllUnfreezeV2)

**Phase 3: Withdrawal (automatic or manual)**
- After 14 days, funds auto-withdraw to liquid balance
- OR call WithdrawExpireUnfreeze manually
- Funds now usable

### Source Code Implementation

**UnfreezeBalanceV2Actuator.java:50-101**

```java
@Override
public boolean execute(Object result) throws ContractExeException {
    TransactionResultCapsule ret = (TransactionResultCapsule) result;

    UnfreezeBalanceV2Contract unfreezeBalanceV2Contract = any.unpack(UnfreezeBalanceV2Contract.class);
    byte[] ownerAddress = unfreezeBalanceV2Contract.getOwnerAddress().toByteArray();
    long now = dynamicStore.getLatestBlockHeaderTimestamp();

    // 1. Withdraw any ALREADY EXPIRED unfreezes first
    mortgageService.withdrawReward(ownerAddress);
    AccountCapsule accountCapsule = accountStore.get(ownerAddress);
    long unfreezeAmount = this.unfreezeExpire(accountCapsule, now);  // Auto-withdraw

    long unfreezeBalance = unfreezeBalanceV2Contract.getUnfreezeBalance();
    ResourceCode freezeType = unfreezeBalanceV2Contract.getResource();

    // 2. Calculate expiration time (now + 14 days)
    long expireTime = this.calcUnfreezeExpireTime(now);

    // 3. Add to unfrozen queue
    accountCapsule.addUnfrozenV2List(freezeType, unfreezeBalance, expireTime);

    // 4. Update network weights (reduce immediately)
    this.updateTotalResourceWeight(accountCapsule, unfreezeBalanceV2Contract, unfreezeBalance);

    // 5. Update votes if needed
    this.updateVote(accountCapsule, unfreezeBalanceV2Contract, ownerAddress);

    accountStore.put(ownerAddress, accountCapsule);

    ret.setWithdrawExpireAmount(unfreezeAmount);  // Report auto-withdrawn amount
    ret.setStatus(fee, code.SUCESS);
    return true;
}
```

### Expiration Calculation

**Source**: `UnfreezeBalanceV2Actuator.java:229-234`

```java
public long calcUnfreezeExpireTime(long now) {
    DynamicPropertiesStore dynamicStore = chainBaseManager.getDynamicPropertiesStore();
    long unfreezeDelayDays = dynamicStore.getUnfreezeDelayDays();  // Default: 14

    return now + unfreezeDelayDays * FROZEN_PERIOD;
    // FROZEN_PERIOD = 86,400,000 ms = 1 day
    // So: now + (14 × 86,400,000) = now + 1,209,600,000 ms
}
```

### Auto-Withdrawal on Unfreeze

**Critical Feature**: When you call UnfreezeBalanceV2, the system AUTOMATICALLY withdraws any already-expired unfreezes.

**Source**: `UnfreezeBalanceV2Actuator.java:250-272`

```java
public long unfreezeExpire(AccountCapsule accountCapsule, long now) {
    long unfreezeBalance = 0L;

    List<UnFreezeV2> unFrozenV2List = Lists.newArrayList();
    unFrozenV2List.addAll(accountCapsule.getUnfrozenV2List());
    Iterator<UnFreezeV2> iterator = unFrozenV2List.iterator();

    // Scan all pending unfreezes
    while (iterator.hasNext()) {
        UnFreezeV2 next = iterator.next();
        if (next.getUnfreezeExpireTime() <= now) {
            // Expired! Add to balance and remove from queue
            unfreezeBalance += next.getUnfreezeAmount();
            iterator.remove();
        }
    }

    // Update account: add to balance, clear expired records
    accountCapsule.setInstance(
        accountCapsule.getInstance().toBuilder()
            .setBalance(accountCapsule.getBalance() + unfreezeBalance)
            .clearUnfrozenV2()
            .addAllUnfrozenV2(unFrozenV2List).build()
    );

    return unfreezeBalance;
}
```

**Example Timeline:**

```
Day 0 (Mar 1):  Unfreeze 100,000 TRX → expires Mar 15
Day 5 (Mar 6):  Unfreeze 50,000 TRX → expires Mar 20
Day 15 (Mar 16): Unfreeze 30,000 TRX → AUTO-WITHDRAWS 100,000 TRX! New unfreeze expires Mar 30
Day 20 (Mar 21): Check balance → AUTO-WITHDRAW doesn't happen automatically, need transaction
Day 21 (Mar 22): Unfreeze 10,000 TRX → AUTO-WITHDRAWS 50,000 TRX! New unfreeze expires Apr 5
```

**Key Insight**: You DON'T need to call WithdrawExpireUnfreeze explicitly if you're making more unfreezes. They auto-withdraw.

### The 32-Unfreeze Limit

**Why 32?**

**Source**: `UnfreezeBalanceV2Actuator.java:44`

```java
@Getter
private static final int UNFREEZE_MAX_TIMES = 32;
```

**Validation**: `UnfreezeBalanceV2Actuator.java:179-182`

```java
int unfreezingCount = accountCapsule.getUnfreezingV2Count(now);
if (UNFREEZE_MAX_TIMES <= unfreezingCount) {
    throw new ContractValidateException("Invalid unfreeze operation, unfreezing times is over limit");
}
```

**What happens if you hit the limit?**
- Cannot initiate new unfreezes
- Must wait for at least 1 to expire (14 days minimum)
- OR call WithdrawExpireUnfreeze to clear expired ones

**Production Scenario:**

```javascript
// Aggressive unstaking strategy
for (let i = 0; i < 35; i++) {
  try {
    await unfreezeBalanceV2(10000, 'ENERGY');
  } catch (e) {
    if (e.message.includes('unfreezing times is over limit')) {
      console.log('Hit 32-unfreeze limit. Waiting for expiration...');
      break;
    }
  }
}

// Result: First 32 succeed, last 3 fail
// Must wait 14 days for first to expire before unfreezing more
```

**Best Practice**: Track your pending unfreezes and batch them if possible.

```javascript
// Instead of 32 separate 10k unfreezes:
unfreezeBalanceV2(320000, 'ENERGY');  // One big unfreeze

// Uses only 1 queue slot instead of 32
```

### State Changes During Unfreeze

**Before Unfreeze:**
```javascript
Account {
  balance: 900,000 TRX
  frozen_v2: [{type: ENERGY, amount: 100000000000}]  // 100k frozen
  unfrozen_v2: []
}

Your Energy Limit: 300,000 units/day
```

**Transaction:**
```javascript
UnfreezeBalanceV2 {
  owner: "TYour...Address",
  unfreeze_balance: 50,000,000,000  // Unfreeze 50k TRX
  resource: ENERGY
}
```

**Immediately After Transaction:**
```javascript
Account {
  balance: 900,000 TRX  // Still same! Not liquid yet
  frozen_v2: [{type: ENERGY, amount: 50000000000}]  // Reduced to 50k
  unfrozen_v2: [
    {
      type: ENERGY,
      unfreeze_amount: 50000000000,  // 50k pending
      unfreeze_expire_time: now + 1209600000  // 14 days from now
    }
  ]
}

Network {
  TotalEnergyWeight: decreased by 50,000 TRX  // Immediate impact
}

Your Energy Limit: 150,000 units/day  // IMMEDIATELY HALVED!
```

**14 Days Later:**
```javascript
// Call UnfreezeBalanceV2 again OR WithdrawExpireUnfreeze

Account {
  balance: 950,000 TRX  // +50k liquid!
  frozen_v2: [{type: ENERGY, amount: 50000000000}]
  unfrozen_v2: []  // Cleared
}
```

### Partial Unfreezes

You can unfreeze ANY amount up to your total frozen balance.

**Example:**
```javascript
// Frozen: 100,000 TRX for ENERGY

// Unfreeze in stages:
Day 1:  Unfreeze 20,000 TRX → 80,000 still frozen, 20k pending (expires Day 15)
Day 5:  Unfreeze 30,000 TRX → 50,000 still frozen, 50k pending (20k exp Day 15, 30k exp Day 19)
Day 10: Unfreeze 50,000 TRX → 0 frozen, 100k pending (expires staggered)
```

**Resource Impact:**
Each unfreeze IMMEDIATELY reduces your resource limit proportionally.

---

## 3.4 Tron Power: The New Voting Resource

The most important change in Stake 2.0: **separation of voting from resources**.

### The Old Model (V1)

```
Freeze for BANDWIDTH → Get bandwidth + votes
Freeze for ENERGY → Get energy + votes
Want bandwidth without votes? Impossible.
Want votes without resources? Impossible.
```

### The New Model (V2)

```
Freeze for BANDWIDTH → Get ONLY bandwidth
Freeze for ENERGY → Get ONLY energy
Freeze for TRON_POWER → Get ONLY votes
Mix and match as needed!
```

### TRON_POWER Mechanics

**Source**: `FreezeBalanceV2Actuator.java:73-78`

```java
case TRON_POWER:
    long oldTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
    accountCapsule.addFrozenForTronPowerV2(frozenBalance);
    long newTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
    dynamicStore.addTotalTronPowerWeight(newTPWeight - oldTPWeight);
    break;
```

**Formula:**
```
Voting Power = Frozen TRX for TRON_POWER ÷ 1,000,000
```

**Example:**
```javascript
FreezeBalanceV2(100000, TRON_POWER)
// Voting Power = 100,000,000,000 / 1,000,000 = 100,000 votes
```

### Voting with TRON_POWER

**Constraints:**
- Can vote for up to 5 different Super Representatives
- Total votes distributed cannot exceed your Tron Power
- Votes don't decay (unlike resource usage)
- Votes remain active until you unfreeze TRON_POWER

**Example:**
```javascript
// Freeze 100,000 TRX for TRON_POWER
// You have 100,000 votes

VoteWitness([
  { sr_address: "SR_1", vote_count: 60000 },
  { sr_address: "SR_2", vote_count: 30000 },
  { sr_address: "SR_3", vote_count: 10000 }
]);

// Total: 60k + 30k + 10k = 100k ✓ Valid
```

### Strategic Allocation

**Scenario: You have 500,000 TRX to stake**

**Option A: Maximum Resources**
```javascript
Freeze 250,000 for BANDWIDTH
Freeze 250,000 for ENERGY
Freeze 0 for TRON_POWER

Result:
- Bandwidth: ~720,000 bytes/day
- Energy: ~750,000 units/day
- Voting Power: 0 (can't vote in governance)
```

**Option B: Balanced**
```javascript
Freeze 200,000 for BANDWIDTH
Freeze 200,000 for ENERGY
Freeze 100,000 for TRON_POWER

Result:
- Bandwidth: ~576,000 bytes/day
- Energy: ~600,000 units/day
- Voting Power: 100,000 votes
```

**Option C: Governance-Focused**
```javascript
Freeze 50,000 for BANDWIDTH (minimal)
Freeze 50,000 for ENERGY (minimal)
Freeze 400,000 for TRON_POWER

Result:
- Bandwidth: ~144,000 bytes/day
- Energy: ~150,000 units/day
- Voting Power: 400,000 votes (significant governance influence)
```

### Vote Rebalancing on Unfreeze

**Critical Behavior**: Unfreezing TRON_POWER may trigger automatic vote rebalancing.

**Source**: `UnfreezeBalanceV2Actuator.java:303-388`

```java
private void updateVote(AccountCapsule accountCapsule,
                        final UnfreezeBalanceV2Contract unfreezeBalanceV2Contract,
                        byte[] ownerAddress) {
    if (accountCapsule.getVotesList().isEmpty()) {
        return;  // No votes, nothing to update
    }

    // Calculate total votes cast
    long totalVote = 0;
    for (Protocol.Vote vote : accountCapsule.getVotesList()) {
        totalVote += vote.getVoteCount();
    }

    // Calculate owned Tron Power
    long ownedTronPower = accountCapsule.getAllTronPower();

    // If Tron Power is sufficient, no rebalancing needed
    if (ownedTronPower >= totalVote * TRX_PRECISION) {
        return;
    }

    // Insufficient Tron Power: proportionally reduce votes
    List<Vote> addVotes = new ArrayList<>();
    for (Vote vote : accountCapsule.getVotesList()) {
        long newVoteCount = (long)
            ((double) vote.getVoteCount() / totalVote * ownedTronPower / TRX_PRECISION);
        if (newVoteCount > 0) {
            Vote newVote = Vote.newBuilder()
                .setVoteAddress(vote.getVoteAddress())
                .setVoteCount(newVoteCount)
                .build();
            addVotes.add(newVote);
        }
    }

    // Update votes
    votesCapsule.clearNewVotes();
    votesCapsule.addAllNewVotes(addVotes);
    accountCapsule.clearVotes();
    accountCapsule.addAllVotes(addVotes);
}
```

**Example:**

```javascript
// Initial state:
Frozen TRON_POWER: 100,000 TRX
Votes cast: 100,000 (distributed among SRs)

// Unfreeze 30,000 TRX TRON_POWER
UnfreezeBalanceV2(30000, TRON_POWER)

// After unfreeze:
Frozen TRON_POWER: 70,000 TRX
Votes AUTOMATICALLY REDUCED to 70,000 (proportionally across all SRs)

// Before:
SR_1: 60,000 votes
SR_2: 30,000 votes
SR_3: 10,000 votes

// After:
SR_1: 42,000 votes (60k × 70%)
SR_2: 21,000 votes (30k × 70%)
SR_3:  7,000 votes (10k × 70%)
```

**Production Implication**: Unfreezing TRON_POWER impacts governance. Coordinate with your voting strategy.

---

## Code Laboratory

### Exercise 3.1: Stake V2 Wrapper Library

**Objective:** Build a high-level library for Stake 2.0 operations with safety checks

**Starter Code:**

```javascript
class StakeV2Manager {
  constructor(tronWeb, ownerAddress) {
    this.tronWeb = tronWeb;
    this.ownerAddress = ownerAddress;
  }

  async freeze(amount, resourceType) {
    // TODO: Implement FreezeBalanceV2
    // 1. Validate amount (>= 1 TRX)
    // 2. Check balance
    // 3. Build and send transaction
  }

  async unfreeze(amount, resourceType) {
    // TODO: Implement UnfreezeBalanceV2
    // 1. Check frozen balance
    // 2. Check pending unfreeze count (< 32)
    // 3. Build and send transaction
    // 4. Return expiration time
  }

  async withdrawExpired() {
    // TODO: Implement WithdrawExpireUnfreeze
    // 1. Check if any unfreezes are expired
    // 2. Build and send transaction
  }

  async getPendingUnfreezes() {
    // TODO: Query account.unfrozen_v2
    // Return list with amounts and expiration times
  }

  async cancelAllUnfreezes() {
    // TODO: Implement CancelAllUnfreezeV2
  }
}
```

**Full Solution** in repository (see BOOK_CODE_EXAMPLES.md)

### Exercise 3.2: Unfreeze Queue Monitor

**Objective:** Build a dashboard to track pending unfreezes

**Features:**
- List all pending unfreezes
- Show days remaining for each
- Alert when unfreezes are ready to withdraw
- Calculate total locked in queue

### Exercise 3.3: Optimal Resource Allocation Calculator

**Objective:** Given total TRX and requirements, calculate optimal freeze distribution

**Inputs:**
- Total TRX available
- Daily bandwidth needed
- Daily energy needed
- Desired voting power

**Output:**
- Recommended freeze for each resource type
- Expected limits for each
- Trade-offs if requirements exceed capacity

---

## Production Checklist

### Before Freezing
- [ ] Verify Stake V2 is enabled on network
- [ ] Ensure account has sufficient liquid TRX
- [ ] Decide resource allocation strategy
- [ ] Account for 14-day withdrawal delay in liquidity planning
- [ ] Set up monitoring for frozen balances

### After Freezing
- [ ] Verify frozen balance updated correctly
- [ ] Confirm resource limits increased as expected
- [ ] Monitor network weight changes
- [ ] Document freeze amounts and resource types
- [ ] Plan unfreeze timing if needed

### Before Unfreezing
- [ ] Check pending unfreeze count (must be < 32)
- [ ] Calculate impact on resource limits
- [ ] Ensure you can operate with reduced resources for 14 days
- [ ] Document unfreeze expiration time
- [ ] Set reminder for withdrawal (14 days later)

### Managing Unfreezes
- [ ] Track all pending unfreezes with expiration dates
- [ ] Set up auto-withdrawal or manual reminder
- [ ] Monitor queue to avoid hitting 32-limit
- [ ] Consider batching small unfreezes
- [ ] Test CancelAllUnfreezeV2 process

---

## Common Pitfalls

### Pitfall #1: Expecting Instant Liquidity

**Mistake:** Unfreezing 1M TRX expecting to use it immediately

**Reality:** 14-day wait period

**Fix:** Plan liquidity needs 14+ days in advance

### Pitfall #2: Hitting the 32-Unfreeze Limit

**Mistake:** Making many small unfreezes (e.g., 10k TRX 50 times)

**Fix:** Batch unfreezes. One 500k unfreeze instead of 50 × 10k unfreezes

### Pitfall #3: Forgetting Auto-Withdrawal

**Mistake:** Thinking you need to call WithdrawExpireUnfreeze every time

**Reality:** Auto-withdraws when you make new unfreeze

**Fix:** Just track expiration dates, withdrawal is automatic if you continue unfreezing

### Pitfall #4: Unfreezing TRON_POWER Reduces Votes

**Mistake:** Unfreezing voting power without checking vote status

**Reality:** Votes automatically reduced proportionally

**Fix:** Review your votes before unfreezing TRON_POWER

### Pitfall #5: Not Migrating from V1

**Mistake:** Still using Stake V1 in 2025

**Reality:** V1 is deprecated, may break in future updates

**Fix:** Migrate to V2 as soon as possible

---

## Quick Reference Card

### Freeze Transaction
```javascript
tronWeb.transactionBuilder.freezeBalanceV2(
  amount,           // sun (1 TRX = 1,000,000 sun)
  resourceType,     // 'BANDWIDTH', 'ENERGY', or 'TRON_POWER'
  ownerAddress
);
```

### Unfreeze Transaction
```javascript
tronWeb.transactionBuilder.unfreezeBalanceV2(
  amount,           // sun
  resourceType,
  ownerAddress
);
// Result: Funds locked for 14 days
```

### Withdraw Expired
```javascript
tronWeb.transactionBuilder.withdrawExpireUnfreeze(ownerAddress);
```

### Cancel All Unfreezes
```javascript
tronWeb.transactionBuilder.cancelAllUnfreezeV2(ownerAddress);
```

### Key Constants
```
Minimum freeze: 1 TRX (1,000,000 sun)
Unfreeze delay: 14 days (1,209,600,000 ms)
Max pending unfreezes: 32
TRX to votes: 1 TRX = 1 vote (if frozen for TRON_POWER)
```

---

## Summary

Stake 2.0 fundamentally changed TRON staking:

1. **Flexibility**: Multiple freezes, no minimum lock period
2. **Separation**: Resources and voting are independent
3. **Security**: 14-day withdrawal delay prevents manipulation
4. **Complexity**: Must manage 32-unfreeze queue

**Critical Takeaway:** The 14-day withdrawal delay is not a bug—it's an economic security feature. Plan your liquidity needs accordingly.

In Chapter 4, we'll explore resource delegation—how to lend your frozen resources to others (and make money doing it).

---

**Next Chapter:** Resource Delegation Mastery - Understand delegation mechanics, usage-based availability, and building delegation markets
