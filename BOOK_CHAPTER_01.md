# Chapter 1: TRON Resource Fundamentals

> *"The best time to understand TRON resources was before you deployed your contract. The second best time is now."*

---

## Bizarre Fact: The Invisible Tax

In December 2024, a popular NFT marketplace on TRON mysteriously started failing transactions for its users. The contract was perfect. The logic was sound. The testnet worked flawlessly. Yet, on mainnet, 40% of transactions reverted with cryptic errors.

The culprit? **Resources.**

The developers had frozen 100,000 TRX for energy—enough for 300,000 units per day. Their simulations showed each mint consumed 45,000 energy. Simple math: 300,000 / 45,000 = 6.66 mints per day. They expected 5-6 mints daily. Perfect, right?

Wrong.

What they didn't account for:
1. The energy_factor penalty (their contract had a 15% penalty = 51,750 actual energy per mint)
2. The 24-hour sliding window (energy doesn't fully recover until 24 hours after EACH use)
3. Failed transactions still consuming energy
4. Multiple users calling simultaneously

Reality: They could handle 4 mints per day, not 6. And when they hit that limit, every transaction failed—costing users bandwidth fees while providing nothing in return.

**The invisible tax: Every TRON transaction pays in resources BEFORE it pays in TRX.**

By the end of this chapter, you'll understand exactly how to avoid this $50,000 mistake.

---

## 1.1 The Resource Trilemma

Blockchain networks face an impossible trilemma: decentralization, security, and scalability. You can optimize for two, but the third always suffers.

TRON's solution? **Resource accounting.**

### Why Resources Exist

Every blockchain operation has a real cost:
- **Storage**: Storing data across thousands of nodes
- **Computation**: Executing smart contract code on every validating node
- **Bandwidth**: Propagating transactions through the network

Traditional blockchains (like Bitcoin) handle this with simple transaction fees. Ethereum introduced "gas"—a unit of computational cost. TRON went further: **separating different types of costs into distinct, recoverable resources**.

### The TRON Approach vs. Ethereum Gas

| Feature | Ethereum Gas | TRON Resources |
|---------|-------------|----------------|
| **Cost Model** | Burn ETH for every operation | Consume recoverable resources OR burn TRX |
| **Recovery** | None (gas is burned) | 100% recovery over 24 hours |
| **Free Tier** | None | 600 bandwidth per account per day |
| **Resource Types** | Single (gas) | Three separate types (bandwidth, energy, tron power) |
| **Volatility** | High (gas price fluctuates 10-100x) | Low (resource costs are stable) |
| **Predictability** | Difficult (depends on network congestion) | Easier (know your limits in advance) |

**Key Insight**: TRON resources are like a **refillable battery**, not a fuel tank. You can use them, wait for recovery, and use them again—without spending more TRX.

### The Economic Purpose

Resources serve three critical functions:

1. **Anti-Spam**: Free transactions would enable denial-of-service attacks
2. **Fair Allocation**: Users who stake more TRX get proportionally more resources
3. **Sustainability**: Validators are compensated through staking rewards, not just transaction fees

**Source Code Evidence**:
```java
// chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java:47-64
protected long increase(long lastUsage, long usage, long lastTime, long now, long windowSize) {
    // This is the heart of the resource system: decay over time
    if (lastTime + windowSize > now) {
        long delta = now - lastTime;
        double decay = (windowSize - delta) / (double) windowSize;
        averageLastUsage = round(averageLastUsage * decay);
    } else {
        averageLastUsage = 0;  // Fully recovered after 24 hours
    }
    // ...
}
```

This code, executed billions of times per day, implements the recovery mechanism that makes TRON's resource model unique.

---

## 1.2 Three Types of Resources

TRON has three distinct resource types, each with a specific purpose.

### Bandwidth: The Cost of Existence

**Purpose**: Pay for the storage and propagation of transaction data

**How to Get It**:
1. **Free Bandwidth**: 600 bytes per account per day (automatic)
2. **Frozen Bandwidth**: Stake TRX for BANDWIDTH resource
3. **Burn TRX**: Last resort, pay 10 sun per byte

**What Consumes It**:
- Transaction size in bytes
- Typically 200-300 bytes for simple transfers
- 300-500 bytes for contract calls

**Source Code Location**:
```
/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java
```

**Key Lines**:
```java
// Line 114-120: Calculate transaction size
if (chainBaseManager.getDynamicPropertiesStore().supportVM()) {
    bytesSize = trx.getInstance().toBuilder().clearRet().build().getSerializedSize();
} else {
    bytesSize = trx.getSerializedSize();
}
```

**Real-World Example**:
```
Simple TRX transfer:
- Transaction size: ~250 bytes
- Free bandwidth: 600 bytes
- Cost: FREE (use free bandwidth)
- Transactions per day: 600 / 250 = 2.4 ≈ 2 transfers

Contract call:
- Transaction size: ~350 bytes
- Free bandwidth: 600 bytes
- Cost: FREE for first call, need frozen bandwidth for more
- Transactions per day with free: 600 / 350 = 1.7 ≈ 1 call
```

### Energy: The Cost of Computation

**Purpose**: Pay for smart contract execution (VM operations)

**How to Get It**:
1. **Frozen Energy**: Stake TRX for ENERGY resource (ONLY source of "free" energy)
2. **Burn TRX**: Pay energy_fee (default: 420 sun per unit)

**Note**: There is NO free energy tier. You must freeze TRX or pay.

**What Consumes It**:
- EVM operations (ADD, MUL, SSTORE, CALL, etc.)
- Contract storage operations (most expensive)
- Memory expansion
- External calls

**Source Code Location**:
```
/actuator/src/main/java/org/tron/core/vm/EnergyCost.java
```

**Key Energy Costs**:
```java
// Common operation costs
public static final int ADD = 3;
public static final int MUL = 5;
public static final int SLOAD = 200;  // Read storage
public static final int SSTORE_SET = 20000;  // Write to new storage slot
public static final int SSTORE_RESET = 5000;  // Update existing storage
public static final int CALL = 700;  // Base call cost
```

**Real-World Example**:
```
USDT TRC-20 Transfer:
- Base energy: ~14,000 units
- Energy factor penalty: +20% (USDT is popular)
- Actual energy: 14,000 × 1.2 = 16,800 units
- Cost if frozen: 0 TRX (uses frozen energy)
- Cost if burned: 16,800 × 420 sun = 7,056,000 sun = 7.056 TRX

DeFi Swap:
- Base energy: ~80,000 units
- Energy factor penalty: +10% (moderately popular)
- Actual energy: 80,000 × 1.1 = 88,000 units
- Cost if burned: 88,000 × 420 sun = 36,960,000 sun = 36.96 TRX
```

### Tron Power: The Weight of Governance

**Purpose**: Voting power for Super Representative elections

**How to Get It**:
- **Stake V2 Only**: Freeze TRX for TRON_POWER resource

**What It Does**:
- 1 TRX frozen = 1 Tron Power = 1 vote
- Vote for up to 5 different Super Representatives
- Votes do NOT decay (unlike bandwidth/energy usage)

**Key Difference from Stake V1**:
- **V1**: Freezing for BANDWIDTH or ENERGY automatically gave voting power
- **V2**: Must explicitly freeze for TRON_POWER to vote (separates governance from resources)

**Source Code Location**:
```
/actuator/src/main/java/org/tron/core/actuator/FreezeBalanceV2Actuator.java:73-78
```

```java
case TRON_POWER:
    long oldTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
    accountCapsule.addFrozenForTronPowerV2(frozenBalance);
    long newTPWeight = accountCapsule.getTronPowerFrozenV2Balance() / TRX_PRECISION;
    dynamicStore.addTotalTronPowerWeight(newTPWeight - oldTPWeight);
    break;
```

**Real-World Example**:
```
Staking 50,000 TRX:
- Option A: 25,000 for ENERGY + 25,000 for BANDWIDTH
  Result: Resources for transactions, but NO voting power

- Option B: 20,000 for ENERGY + 20,000 for BANDWIDTH + 10,000 for TRON_POWER
  Result: Resources for transactions AND 10,000 votes

- Option C: 50,000 for TRON_POWER
  Result: 50,000 votes, but must burn TRX for all resources
```

### Resource Independence

**Critical Concept**: The three resource types are INDEPENDENT.

- Using bandwidth does NOT affect your energy limit
- Using energy does NOT affect your bandwidth limit
- Having Tron Power does NOT give you resources

However, they all share the same recovery mechanism: **24-hour sliding window**.

**Interdependencies**:
1. **Transactions consume BOTH bandwidth and energy** (if calling a contract)
2. **Delegating resources temporarily reduces YOUR limit** (but doesn't consume resources)
3. **Unfreezing ANY resource type MAY trigger vote rebalancing** (if insufficient Tron Power)

**Source Code Evidence**:
```java
// BandwidthProcessor.java:96-178
@Override
public void consume(TransactionCapsule trx, TransactionTrace trace) {
    // First: consume bandwidth for transaction size
    long bytesSize = trx.getInstance().toBuilder().clearRet().build().getSerializedSize();
    // Bandwidth is consumed regardless of energy consumption

    // Later: VMActuator will separately consume energy
    // (in a different processor)
}
```

---

## 1.3 The 24-Hour Recovery Window

The recovery mechanism is the **most misunderstood** aspect of TRON resources.

### The Mental Model: A Leaky Battery

Imagine a battery that:
- Drains when you use it
- Refills automatically over exactly 24 hours
- Starts refilling IMMEDIATELY after use (not after 24 hours)
- Refills LINEARLY (not all at once)

**This is TRON resource recovery.**

### The Decay Formula

**Source**: `/chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java:47-64`

```java
protected long increase(long lastUsage, long usage, long lastTime, long now, long windowSize) {
    long averageLastUsage = divideCeil(lastUsage * precision, windowSize);
    long averageUsage = divideCeil(usage * precision, windowSize);

    if (lastTime != now) {
        assert now > lastTime;
        if (lastTime + windowSize > now) {
            // Within 24-hour window: apply linear decay
            long delta = now - lastTime;
            double decay = (windowSize - delta) / (double) windowSize;
            averageLastUsage = round(averageLastUsage * decay);
        } else {
            // Beyond 24 hours: fully recovered
            averageLastUsage = 0;
        }
    }
    averageLastUsage += averageUsage;
    return getUsage(averageLastUsage, windowSize);
}
```

### Mathematical Formula

```
Given:
- lastUsage: resource usage at last consumption
- lastTime: timestamp of last consumption (in slots)
- now: current timestamp (in slots)
- windowSize: 24 hours = 86,400,000 ms / 3,000 ms per block = 28,800 slots

Calculate:
1. delta = now - lastTime

2. IF delta ≥ windowSize (24 hours) THEN
     currentUsage = 0  // Fully recovered
   ELSE
     decay_ratio = (windowSize - delta) / windowSize
     currentUsage = lastUsage × decay_ratio
   END IF
```

### Graphical Representation

```
Usage
  │
100%│  ●────────────────────────────────────────────────────
    │   ╲                       Resource used at t=0
    │    ╲
    │     ╲
    │      ╲                    Linear decay
    │       ╲
 50%│        ●──────────────────  50% recovered at t=12h
    │         ╲
    │          ╲
    │           ╲
    │            ╲
  0%│_____________●_____________  100% recovered at t=24h
    │             │
    0            12h           24h          Time
```

### Worked Example: Energy Recovery

**Scenario**: You have 300,000 energy limit per day.

**Timeline**:
- **00:00**: Use 150,000 energy (contract call)
  - Available: 300,000 - 150,000 = 150,000

- **06:00** (6 hours later):
  - Recovered: 150,000 × (6/24) = 37,500
  - Available: 150,000 + 37,500 = 187,500

- **12:00** (12 hours later):
  - Recovered: 150,000 × (12/24) = 75,000
  - Available: 150,000 + 75,000 = 225,000

- **12:00**: Use another 100,000 energy
  - Available: 225,000 - 100,000 = 125,000
  - Now tracking TWO recovery streams!

- **18:00** (18h from first, 6h from second):
  - First usage recovered: 150,000 × (18/24) = 112,500
  - Second usage recovered: 100,000 × (6/24) = 25,000
  - Available: 300,000 - (150,000 - 112,500) - (100,000 - 25,000)
             = 300,000 - 37,500 - 75,000 = 187,500

- **24:00** (24h from first, 12h from second):
  - First usage: FULLY recovered
  - Second usage: 50% recovered = 50,000
  - Available: 300,000 - 50,000 = 250,000

### The Critical Mistake

**Common Misconception**: "I have 300,000 energy per day, so I can do 5 transactions of 60,000 energy each."

**Reality**: Depends on timing!

**Scenario A** (Transactions spread over 24 hours):
- 00:00: Use 60,000 (available: 240,000)
- 06:00: Use 60,000 (available: 195,000)  [first 15,000 recovered]
- 12:00: Use 60,000 (available: 165,000)  [30k + 15k recovered]
- 18:00: Use 60,000 (available: 150,000)  [45k + 30k + 15k recovered]
- 24:00: Use 60,000 (available: 195,000)  [60k + 45k + 30k + 15k recovered]
- ✓ ALL 5 transactions succeed

**Scenario B** (All transactions within 1 hour):
- 00:00: Use 60,000 (available: 240,000)
- 00:12: Use 60,000 (available: 180,000)  [minimal recovery]
- 00:24: Use 60,000 (available: 120,000)
- 00:36: Use 60,000 (available: 60,000)
- 00:48: Use 60,000 (available: 0)
- ✓ First 5 transactions succeed
- 01:00: Try to use 60,000 (available: ~1,250)  [only 1h recovery]
- ✗ 6th transaction FAILS (insufficient energy)

**This is why the NFT marketplace failed**: They assumed "6 mints per day" meant 6 anytime, but bursts of activity depleted resources faster than they recovered.

### Strategic Implications

1. **Burst Capacity**: Your "burst" capacity is your full limit, but sustained throughput is lower
2. **Traffic Shaping**: Smoothing transaction patterns maximizes resource utilization
3. **Peak Planning**: High-traffic events need MORE frozen TRX than daily averages suggest
4. **Grace Period**: Always keep 20-30% headroom for recovery delays

**Production Formula**:
```
Required Frozen TRX = (Peak Hourly Usage × 24) × 1.3 safety margin
NOT: Average Daily Usage
```

---

## 1.4 Free vs. Frozen Resources

Every account must make a fundamental economic decision: **use free resources, freeze TRX, or burn TRX?**

### The Free Bandwidth Tier

**Specification**:
- **Amount**: 600 bytes per account per day
- **Recovery**: 24-hour sliding window (same as frozen resources)
- **Cost**: $0.00

**Source Code**:
```java
// BandwidthProcessor.java:500-541
private boolean useFreeNet(AccountCapsule accountCapsule, long bytes, long now) {
    long freeNetLimit = chainBaseManager.getDynamicPropertiesStore().getFreeNetLimit();
    // Default: 600 bytes

    long freeNetUsage = accountCapsule.getFreeNetUsage();
    long latestConsumeFreeTime = accountCapsule.getLatestConsumeFreeTime();
    long newFreeNetUsage = increase(freeNetUsage, 0, latestConsumeFreeTime, now);

    if (bytes > (freeNetLimit - newFreeNetUsage)) {
        return false;  // Not enough free bandwidth
    }
    // ... use free bandwidth
}
```

**What Can You Do With 600 Bytes?**

| Activity | Size (bytes) | Count per Day |
|----------|-------------|---------------|
| TRX transfer | ~250 | 2 |
| TRC-10 token transfer | ~280 | 2 |
| Vote for SRs | ~300 | 2 |
| Simple contract call | ~350 | 1 |
| Complex contract call | ~500 | 1 |
| Multi-sig transaction | ~600 | 1 |

**Key Insight**: Free bandwidth is sufficient for casual users (2 transactions per day), but ANY production application needs frozen bandwidth.

### The Economic Breakeven Analysis

**Question**: When should you freeze TRX vs. burn TRX?

**Bandwidth Burn Cost**:
- 10 sun per byte
- 250-byte transaction = 2,500 sun = 0.0025 TRX

**Energy Burn Cost**:
- 420 sun per energy unit
- 50,000 energy transaction = 21,000,000 sun = 21 TRX

**Frozen Bandwidth**:
Assuming:
- TRX price: $0.10
- Frozen amount: 10,000 TRX ($1,000)
- Bandwidth gained: ~29,000 bytes per day (based on current network weights)
- Transactions per day: 29,000 / 250 = 116 transactions

Burn equivalent: 116 × 0.0025 TRX = 0.29 TRX per day = $0.029 per day

**Breakeven**: NEVER (you can unfreeze and recover the 10,000 TRX after 14 days)

**Frozen Energy**:
Assuming:
- TRX price: $0.10
- Frozen amount: 100,000 TRX ($10,000)
- Energy gained: ~300,000 units per day
- Contract calls per day: 300,000 / 50,000 = 6 calls

Burn equivalent: 6 × 21 TRX = 126 TRX per day = $12.60 per day

**Breakeven**:
- Daily burn cost: $12.60
- Frozen capital: $10,000
- Daily return: $12.60 / $10,000 = 0.126% per day = 46% per year

If you can earn MORE than 46% APY with your TRX (e.g., DeFi staking), burning might be cheaper. Otherwise, freeze.

**Reality Check**: Most users should freeze, because:
1. Burning is expensive for high-frequency apps
2. Freezing locks capital but enables unlimited transactions
3. Frozen TRX can be unfrozen (after 14 days) and redeployed

**Decision Matrix**:

| Use Case | Recommendation | Reasoning |
|----------|---------------|-----------|
| Personal wallet (< 10 tx/day) | Free bandwidth only | No cost, sufficient capacity |
| Small dApp (< 100 tx/day) | Freeze 10,000-50,000 TRX | Cheaper than burning |
| Medium dApp (1,000 tx/day) | Freeze 100,000-500,000 TRX | Essential for operations |
| High-volume dApp (10,000+ tx/day) | Freeze millions + delegation | Only viable model |
| One-time contract deployment | Burn TRX | Not worth freezing for single use |

### Why 99% of Production Apps Need Frozen Resources

**Hard Truth**: Free resources are a marketing gimmick for users, not developers.

**Evidence**:
1. **600 bandwidth** = 2 transactions per day per user
   - If you have 1,000 users, that's only 2,000 tx/day
   - A moderately active dApp needs 10,000+ tx/day

2. **No free energy** = every contract call burns TRX or uses frozen energy
   - USDT transfer: 7 TRX if burned
   - If users pay: terrible UX, users leave
   - If dApp pays: unsustainable burn rate

3. **User acquisition** requires subsidization
   - New users have NO frozen TRX
   - They cannot pay 7 TRX per transaction
   - You must provide resources via delegation

**Production Requirement**:
```
Minimum Viable Stake = (Daily Transactions × Avg Energy per Tx × 420 sun) / (Energy per TRX frozen)

Example for 1,000 transactions per day:
= (1,000 × 50,000 × 420) / 300  [assuming 1 TRX → 300 energy per day]
= 21,000,000,000 / 300
= 70,000,000 sun
= 70,000 TRX minimum

Recommended (with 30% buffer): 100,000 TRX
```

---

## Code Laboratory

### Exercise 1.1: Resource Recovery Calculator

**Objective**: Build a function to calculate available resources after time elapsed

**Starter Code** (JavaScript/TronWeb):
```javascript
/**
 * Calculate available resources after decay
 * @param {number} limit - Total resource limit (e.g., 300000 energy)
 * @param {number} lastUsage - Usage at last consumption
 * @param {number} lastTime - Timestamp of last consumption (ms)
 * @param {number} now - Current timestamp (ms)
 * @returns {number} Currently available resources
 */
function calculateAvailableResources(limit, lastUsage, lastTime, now) {
  const WINDOW_SIZE_MS = 24 * 60 * 60 * 1000;  // 24 hours

  // TODO: Implement the decay formula
  // Hint: Follow the formula from section 1.3

  return limit;  // Replace with actual calculation
}

// Test cases
console.assert(
  calculateAvailableResources(300000, 150000, Date.now() - 12*60*60*1000, Date.now()) === 225000,
  "12 hours after using 150k should have 225k available"
);
```

**Solution**:
```javascript
function calculateAvailableResources(limit, lastUsage, lastTime, now) {
  const WINDOW_SIZE_MS = 24 * 60 * 60 * 1000;
  const delta = now - lastTime;

  let currentUsage;
  if (delta >= WINDOW_SIZE_MS) {
    // Fully recovered
    currentUsage = 0;
  } else {
    // Linear decay
    const decayRatio = (WINDOW_SIZE_MS - delta) / WINDOW_SIZE_MS;
    currentUsage = Math.floor(lastUsage * decayRatio);
  }

  return limit - currentUsage;
}

// Extended test cases
console.log(calculateAvailableResources(300000, 150000, Date.now() - 0, Date.now()));
// Expected: 150000 (just used, no recovery)

console.log(calculateAvailableResources(300000, 150000, Date.now() - 6*60*60*1000, Date.now()));
// Expected: 187500 (6 hours = 25% recovery)

console.log(calculateAvailableResources(300000, 150000, Date.now() - 24*60*60*1000, Date.now()));
// Expected: 300000 (fully recovered)
```

### Exercise 1.2: Daily Transaction Capacity Estimator

**Objective**: Calculate maximum transactions per day given frozen TRX and transaction patterns

**Requirements**:
1. Input: Frozen TRX amount, transaction energy cost, transaction timing pattern
2. Output: Maximum sustainable transactions per day

**Hints**:
- Uniform distribution (1 tx per hour) is different from bursts (10 tx in 10 minutes)
- Account for recovery between transactions
- Don't forget the energy_factor penalty

**Challenge**: Implement both optimistic (uniform) and pessimistic (burst) estimates

### Exercise 1.3: Resource Monitoring Dashboard

**Objective**: Build a real-time resource monitoring tool

**Features**:
- Display current available bandwidth and energy
- Show recovery progress (time until full recovery)
- Alert when resources drop below 20%
- Historical usage chart (last 24 hours)

**APIs**:
```javascript
// TronWeb example
const account = await tronWeb.trx.getAccount(address);
// Returns: account.bandwidth, account.energy resources

const accountResources = await tronWeb.trx.getAccountResources(address);
// Returns: detailed resource info including limits, usage, recovery times
```

**Bonus**: Predict when resources will be fully recovered and send a notification

---

## Production Checklist

### Before Deployment
- [ ] Calculate required frozen TRX for peak traffic (not average)
- [ ] Add 30% safety buffer for unexpected bursts
- [ ] Decide resource allocation: bandwidth vs. energy vs. tron power
- [ ] Set up backup energy pool (for TRX burning if frozen depletes)
- [ ] Configure consume_user_resource_percent for contracts
- [ ] Document resource requirements in deployment guide

### Monitoring Setup
- [ ] Track available resources every minute
- [ ] Alert when resources drop below 30%
- [ ] Critical alert when resources drop below 10%
- [ ] Monitor recovery rates (should match 24-hour window)
- [ ] Track actual vs. estimated resource consumption

### Incident Response
- [ ] Document procedure for resource exhaustion
- [ ] Prepare emergency TRX for burning
- [ ] Set up delegation sources (if using delegation)
- [ ] Test resource exhaustion recovery process
- [ ] Create runbook for resource incidents

### Optimization
- [ ] Profile all contract functions for energy cost
- [ ] Identify high-frequency operations
- [ ] Optimize hot paths for minimal energy
- [ ] Batch operations where possible
- [ ] Review and reduce transaction sizes

---

## Common Pitfalls

### Pitfall #1: Assuming Resources Are "Free"

**Mistake**:
"I froze TRX, so transactions are free now."

**Reality**:
- Resources are LIMITED and RECOVER OVER TIME
- Exceeding your limit means transactions FAIL or BURN TRX
- "Free" means "no additional cost if within limits"

**Fix**:
- Always monitor resource usage
- Plan for peak usage, not average
- Keep 20-30% buffer for safety

**Code Check**:
```javascript
// BAD: Assume energy is always available
await contract.methods.expensiveFunction().send();

// GOOD: Check energy before expensive operations
const resources = await tronWeb.trx.getAccountResources(address);
const available = resources.EnergyLimit - resources.EnergyUsed;
const required = await estimateEnergy(contract, 'expensiveFunction');

if (available < required) {
  throw new Error(`Insufficient energy: need ${required}, have ${available}`);
}
```

### Pitfall #2: Ignoring the 24-Hour Recovery Window

**Mistake**:
"I have 300k energy per day, so I can do 6 transactions of 50k energy each, anytime."

**Reality**:
- Recovery is CONTINUOUS, not instantaneous
- Burst usage depletes resources faster than they recover
- Must account for recovery between transactions

**Example Failure**:
```
Event launch at 12:00:
- 12:00-12:05: 8 transactions (400k energy)
- Available energy: 300k
- Result: First 6 succeed, next 2 fail, users complain

Should have staked: 400k energy capacity / day = ~133,000 TRX
Actually staked: 300k energy capacity / day = 100,000 TRX
```

**Fix**:
- Calculate peak hourly usage, multiply by 24
- Add 30% buffer
- Load test with realistic traffic patterns

### Pitfall #3: Confusing "Available" vs. "Limit"

**Mistake**:
Reading `EnergyLimit` and assuming that's available right now

**Reality**:
```
EnergyLimit: 300,000 (maximum, when fully recovered)
EnergyUsed: 250,000 (consumed, recovering over 24h)
Available: EnergyLimit - (EnergyUsed after decay)
```

**API Trap**:
```javascript
// TronGrid API response
{
  "EnergyLimit": 300000,    // Maximum capacity
  "EnergyUsed": 250000,     // Used within 24h window
  "freeNetLimit": 600,      // Maximum free bandwidth
  "freeNetUsed": 200        // Used free bandwidth
}

// WRONG calculation:
const available = response.EnergyLimit - response.EnergyUsed;
// = 300000 - 250000 = 50000 (might be incorrect if recovery happened!)

// CORRECT calculation:
// Must account for time-based decay since last use
const lastConsumeTime = response.latest_consume_time_for_energy;
const now = Date.now();
const decayedUsage = calculateDecay(response.EnergyUsed, lastConsumeTime, now);
const available = response.EnergyLimit - decayedUsage;
```

**Fix**:
- Always fetch `latest_consume_time_for_energy` and `latest_consume_time`
- Apply decay formula before calculating available resources
- Don't cache resource availability for more than 1 minute

### Pitfall #4: Not Testing with Energy Factor

**Mistake**:
Estimating energy cost from Nile testnet, deploying to mainnet, and getting 20-50% higher costs

**Reality**:
- **Testnet**: energy_factor = 0 (no penalty)
- **Mainnet**: energy_factor = 0-100 (depends on contract popularity)
- USDT: energy_factor ≈ 20 (+20% cost)
- Popular DEXs: energy_factor ≈ 30-50 (+30-50% cost)

**Example**:
```
Function energy estimate (testnet): 45,000
Actual cost (mainnet with 20% factor): 45,000 × 1.2 = 54,000
Difference: 9,000 energy = 3.78 TRX if burned
```

**Fix**:
- Always multiply estimates by 1.2-1.5 for safety
- Monitor actual mainnet consumption for first week
- Adjust frozen TRX if needed
- Track energy_factor changes (can increase over time)

### Pitfall #5: Forgetting About Failed Transactions

**Mistake**:
"Failed transactions don't cost anything, right?"

**Reality**:
- **Bandwidth**: ALWAYS consumed (transaction exists on-chain even if failed)
- **Energy**: Consumed up to the point of failure
- **Fees**: May be charged even if transaction reverts

**Example**:
```
User calls contract with insufficient energy:
1. Transaction submitted (bandwidth consumed)
2. VM starts execution (energy consumed)
3. Energy runs out at 80% completion
4. Transaction reverts
5. Result: User paid 80% energy + 100% bandwidth, got nothing
```

**Fix**:
- Always estimate resources BEFORE submission
- Validate inputs off-chain first
- Set reasonable fee limits
- Implement circuit breakers to prevent retry loops

---

## Quick Reference Card

### Core Constants
```
Block Time: 3 seconds
Recovery Window: 24 hours (86,400,000 ms)
Free Bandwidth: 600 bytes per account per day
Energy Fee: 420 sun per unit (if burning)
Bandwidth Fee: 10 sun per byte (if burning)
```

### Resource Formulas
```
Available = Limit - (Usage × decay_ratio)
decay_ratio = (24h - time_elapsed) / 24h

Bandwidth Limit = (Frozen TRX ÷ Total Network Weight) × Total Network Limit
Energy Limit = (Frozen TRX ÷ Total Energy Weight) × Total Energy Limit
```

### Key CLI Commands
```bash
# Get account resources
tronbox trx:getAccountResources <address>

# Get account info
tronbox trx:getAccount <address>

# Freeze TRX for resources
tronbox trx:freezeBalance <amount> <resource> <address>

# Unfreeze TRX
tronbox trx:unfreezeBalance <resource> <address>
```

### Decision Tree
```
Need resources?
├─ Casual user (< 10 tx/day)
│  └─ Use free 600 bandwidth
├─ Small dApp (< 1000 tx/day)
│  └─ Freeze 50,000-100,000 TRX
├─ Medium dApp (< 10,000 tx/day)
│  └─ Freeze 500,000-1,000,000 TRX
└─ High-volume dApp
   └─ Freeze millions + delegation system
```

---

## Summary

You've now mastered the fundamentals of TRON resources:

1. **Three resource types**: Bandwidth (data), Energy (computation), Tron Power (governance)
2. **Recovery mechanism**: 24-hour linear decay, NOT instant refill
3. **Economic model**: Freeze TRX for "free" recoverable resources, or burn TRX per use
4. **Production reality**: Free tier is insufficient for any real application

**Key Takeaway**: TRON resources are like a refillable battery with a 24-hour charge time. Plan for peak usage, not average, and always keep a buffer.

In Chapter 2, we'll dive deep into the resource calculation formulas, showing you exactly how to predict your resource limits based on network state and your frozen TRX.

---

## Further Reading

### TRON Official Documentation
- Resource Model: https://developers.tron.network/docs/resource-model
- Stake 2.0: https://github.com/tronprotocol/tips/blob/master/tip-467.md

### Source Code
- ResourceProcessor.java: `/chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java`
- BandwidthProcessor.java: `/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java`
- EnergyProcessor.java: `/chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java`

### Tools
- TronScan Resource Calculator: https://tronscan.org/#/tools/resource-calculator
- TronGrid API: https://api.trongrid.io
- TronWeb Library: https://github.com/tronprotocol/tronweb

---

**Next Chapter**: Resource Calculation Deep Dive - Master the formulas that govern your resource limits and costs.
