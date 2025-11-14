# Chapter 2: Resource Calculation Deep Dive

> *"In God we trust. All others must bring data—and source code."*

---

## Bizarre Fact: The Math That Could Save Your dApp $10,000 Per Month

In March 2024, a DeFi protocol on TRON was burning through 500 TRX per day in energy fees. That's $50/day, or $1,500/month at $0.10 per TRX.

Their transaction volume: 1,200 contract calls per day, averaging 50,000 energy each.

**The calculation error:**
```javascript
// Their (wrong) calculation:
const dailyEnergy = 1200 * 50000 = 60,000,000 energy
const requiredTRX = 60,000,000 / 300  // Assumed 1 TRX → 300 energy
                  = 200,000 TRX to freeze

// They froze: 200,000 TRX
// Actual energy gained: 180,000 units/day (not 60M!)
```

**What they got wrong:**
1. Confused "energy per unit TRX" with "energy per day"
2. Didn't account for network weights in the formula
3. Used outdated Total Energy Limit from 2023

**The correct calculation:**
```javascript
// Network state (March 2024):
const totalEnergyWeight = 65,000,000,000 TRX
const totalEnergyLimit = 180,000,000,000 units/day

// Their frozen: 200,000 TRX
const myEnergyLimit = (200000 / 65000000000) * 180000000000
                    = 0.00000307692 * 180000000000
                    = 553,846 energy/day

// But they needed: 60,000,000 energy/day
// Actually required: 60000000 / 553846 * 200000 = 21,680,000 TRX
```

**Reality check:** They needed to freeze 21.6 MILLION TRX, not 200,000.

**Their solution:**
- Optimized contracts: reduced average energy from 50k to 28k
- Daily need: 1200 × 28,000 = 33,600,000 energy/day
- Required stake: ~12,133,000 TRX
- Result: Froze 15M TRX (with buffer), saved $1,500/month in burn fees

**The moral:** Resource calculation is not intuitive. You must understand the formulas.

By the end of this chapter, you'll master the exact formulas that govern TRON resources—and never make a $10,000/month mistake.

---

## 2.1 Bandwidth Limit Formula

The bandwidth limit formula determines how many bytes of transaction data you can submit per day based on your frozen TRX.

### The Formula

**Source**: `/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java:432-460`

```java
public long calculateGlobalNetLimit(AccountCapsule accountCapsule) {
    long frozeBalance = accountCapsule.getAllFrozenBalanceForBandwidth();
    if (dynamicPropertiesStore.supportUnfreezeDelay()) {
        return calculateGlobalNetLimitV2(frozeBalance);
    }
    if (frozeBalance < TRX_PRECISION) {
        return 0;
    }
    long netWeight = frozeBalance / TRX_PRECISION;
    long totalNetLimit = chainBaseManager.getDynamicPropertiesStore().getTotalNetLimit();
    long totalNetWeight = chainBaseManager.getDynamicPropertiesStore().getTotalNetWeight();
    if (totalNetWeight == 0) {
        return 0;
    }
    return (long) (netWeight * ((double) totalNetLimit / totalNetWeight));
}

public long calculateGlobalNetLimitV2(long frozeBalance) {
    double netWeight = (double) frozeBalance / TRX_PRECISION;
    long totalNetLimit = dynamicPropertiesStore.getTotalNetLimit();
    long totalNetWeight = dynamicPropertiesStore.getTotalNetWeight();
    if (totalNetWeight == 0) {
        return 0;
    }
    return (long) (netWeight * ((double) totalNetLimit / totalNetWeight));
}
```

### Mathematical Derivation

**Step 1: Convert frozen balance to weight**
```
Your Weight = Frozen Balance (in sun) ÷ TRX_PRECISION
            = Frozen Balance (in sun) ÷ 1,000,000
            = Frozen Balance (in TRX)
```

**Step 2: Calculate your share of network bandwidth**
```
Your Bandwidth Limit = Your Weight × (Total Network Limit ÷ Total Network Weight)
```

**Complete Formula:**
```
BandwidthLimit = (FrozenTRX / TotalNetWeight) × TotalNetLimit
```

Where:
- `FrozenTRX`: Your frozen TRX for bandwidth (in TRX, not sun)
- `TotalNetWeight`: Sum of ALL frozen TRX for bandwidth across the network (in TRX)
- `TotalNetLimit`: Network-wide bandwidth cap (bytes per day)

### Network State (November 2025)

You can query current values via TronGrid API:

```bash
curl https://api.trongrid.io/wallet/getchainparameters
```

**Typical Values** (approximate):
```
TotalNetLimit: 43,200,000,000 bytes/day (43.2 GB)
TotalNetWeight: 15,000,000,000 TRX (15 billion TRX frozen network-wide)
```

**Why these values?**
- **43.2 GB/day**: Network capacity chosen to support ~150 million transactions/day at 300 bytes each
- **15B TRX**: Total frozen by all accounts for bandwidth (dynamic, changes constantly)

### Worked Example 1: Small Staker

**Your stake:**
- Frozen: 10,000 TRX for BANDWIDTH

**Network state:**
- TotalNetLimit: 43,200,000,000 bytes
- TotalNetWeight: 15,000,000,000 TRX

**Calculation:**
```
Your Bandwidth = (10,000 / 15,000,000,000) × 43,200,000,000
               = 0.000000666667 × 43,200,000,000
               = 28,800 bytes per day
```

**Transactions per day:**
- Simple transfer (250 bytes): 28,800 / 250 = 115 tx/day
- Contract call (350 bytes): 28,800 / 350 = 82 tx/day
- Complex transaction (500 bytes): 28,800 / 500 = 57 tx/day

### Worked Example 2: Medium dApp

**Your stake:**
- Frozen: 500,000 TRX for BANDWIDTH

**Calculation:**
```
Your Bandwidth = (500,000 / 15,000,000,000) × 43,200,000,000
               = 0.0000333333 × 43,200,000,000
               = 1,440,000 bytes per day
```

**Transactions per day:**
- At 300 bytes average: 1,440,000 / 300 = 4,800 tx/day
- At 400 bytes average: 1,440,000 / 400 = 3,600 tx/day

### Worked Example 3: High-Volume Exchange

**Your stake:**
- Frozen: 50,000,000 TRX for BANDWIDTH

**Calculation:**
```
Your Bandwidth = (50,000,000 / 15,000,000,000) × 43,200,000,000
               = 0.00333333 × 43,200,000,000
               = 144,000,000 bytes per day (144 MB)
```

**Transactions per day:**
- At 250 bytes average: 144,000,000 / 250 = 576,000 tx/day
- **That's 6.67 transactions per second sustained**

### Edge Cases and Precision

**Edge Case 1: Frozen balance less than 1 TRX**

```java
// Source: BandwidthProcessor.java:437-439
if (frozeBalance < TRX_PRECISION) {
    return 0;
}
```

**Implication:** You must freeze at least 1 TRX (1,000,000 sun) to get any bandwidth.

**Edge Case 2: Total network weight is zero**

```java
// Source: BandwidthProcessor.java:446-448
if (totalNetWeight == 0) {
    return 0;
}
```

**Implication:** Impossible in practice (genesis accounts have frozen TRX), but code handles it gracefully.

**Edge Case 3: Integer overflow**

The formula uses `(long)` casting after floating-point multiplication:

```java
return (long) (netWeight * ((double) totalNetLimit / totalNetWeight));
```

**Risk:** For extremely large values, floating-point precision loss can occur.

**Maximum safe frozen amount:**
- Max long value: 2^63 - 1 = 9,223,372,036,854,775,807
- With current network, no risk (even 1 trillion TRX is safe)

### Dynamic Network Weights

**Critical insight:** `TotalNetWeight` changes CONSTANTLY as users freeze/unfreeze TRX.

**Impact on your bandwidth:**

Scenario: You freeze 100,000 TRX and don't touch it.

**Day 1:**
- TotalNetWeight: 15,000,000,000 TRX
- Your bandwidth: (100,000 / 15,000,000,000) × 43,200,000,000 = 288,000 bytes/day

**Day 30** (network growth, more users stake):
- TotalNetWeight: 18,000,000,000 TRX (+20%)
- Your bandwidth: (100,000 / 18,000,000,000) × 43,200,000,000 = 240,000 bytes/day
- **You lost 16.7% capacity without changing anything!**

**Day 60** (market crash, users unstake):
- TotalNetWeight: 12,000,000,000 TRX (-20% from day 1)
- Your bandwidth: (100,000 / 12,000,000,000) × 43,200,000,000 = 360,000 bytes/day
- **You gained 25% capacity!**

**Production implication:**
- Never hardcode expected bandwidth
- Query `TotalNetWeight` at least daily
- Recalculate limits dynamically
- Keep 30% buffer for network weight fluctuations

### Delegated Bandwidth

**Important:** Your bandwidth limit includes RECEIVED delegations but excludes GIVEN delegations.

**Formula with delegation:**
```
Your Total Bandwidth = (OwnFrozen + ReceivedDelegation - GivenDelegation) / TotalNetWeight × TotalNetLimit
```

**Source**: `AccountCapsule.getAllFrozenBalanceForBandwidth()` includes delegations.

**Example:**
- Own frozen: 100,000 TRX
- Received delegation: 50,000 TRX
- Given delegation: 30,000 TRX
- Effective frozen: 100,000 + 50,000 - 30,000 = 120,000 TRX

**Calculation:**
```
Bandwidth = (120,000 / 15,000,000,000) × 43,200,000,000
          = 345,600 bytes/day
```

---

## 2.2 Energy Limit Formula

The energy limit formula is ALMOST identical to bandwidth, with one critical difference: **adaptive limit**.

### The Formula

**Source**: `/chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java:141-169`

```java
public long calculateGlobalEnergyLimit(AccountCapsule accountCapsule) {
    long frozeBalance = accountCapsule.getAllFrozenBalanceForEnergy();
    if (dynamicPropertiesStore.supportUnfreezeDelay()) {
        return calculateGlobalEnergyLimitV2(frozeBalance);
    }
    if (frozeBalance < TRX_PRECISION) {
        return 0;
    }

    long energyWeight = frozeBalance / TRX_PRECISION;
    long totalEnergyLimit = dynamicPropertiesStore.getTotalEnergyCurrentLimit();  // ADAPTIVE!
    long totalEnergyWeight = dynamicPropertiesStore.getTotalEnergyWeight();
    if (dynamicPropertiesStore.allowNewReward() && totalEnergyWeight <= 0) {
        return 0;
    } else {
        assert totalEnergyWeight > 0;
    }
    return (long) (energyWeight * ((double) totalEnergyLimit / totalEnergyWeight));
}
```

### Mathematical Formula

```
EnergyLimit = (FrozenTRX / TotalEnergyWeight) × TotalEnergyCurrentLimit
```

Where:
- `FrozenTRX`: Your frozen TRX for energy (in TRX)
- `TotalEnergyWeight`: Sum of ALL frozen TRX for energy (in TRX)
- `TotalEnergyCurrentLimit`: **ADAPTIVE** network energy limit (changes every minute!)

### The Adaptive Limit Complication

**Key Difference from Bandwidth:**
- Bandwidth: `TotalNetLimit` is FIXED (43,200,000,000 bytes)
- Energy: `TotalEnergyCurrentLimit` is ADAPTIVE (adjusts based on usage)

**Current vs. Target Limits:**
```
TotalEnergyTargetLimit: 180,000,000,000 (target, set by committee)
TotalEnergyCurrentLimit: varies (90B to 500B+, adapts to demand)
```

**Why adaptive?**
- Prevents congestion during high demand
- Reduces waste during low demand
- Smooths resource allocation over time

**Algorithm** (source: EnergyProcessor.java:64-89):
```java
if (averageUsage > targetLimit) {
    // High usage: contract limit (reduce by 1% per minute)
    newLimit = currentLimit * 99 / 100;
} else {
    // Low usage: expand limit (increase by 0.1% per minute)
    newLimit = currentLimit * 1000 / 999;
}
```

We'll cover this in detail in Chapter 9. For now, know that `TotalEnergyCurrentLimit` fluctuates ±50% from target.

### Network State (November 2025)

**Typical Values:**
```
TotalEnergyTargetLimit: 180,000,000,000 units/day
TotalEnergyCurrentLimit: 150,000,000,000 to 220,000,000,000 (varies)
TotalEnergyWeight: 60,000,000,000 TRX
```

### Worked Example 1: Basic Energy Calculation

**Your stake:**
- Frozen: 100,000 TRX for ENERGY

**Network state:**
- TotalEnergyCurrentLimit: 180,000,000,000 units
- TotalEnergyWeight: 60,000,000,000 TRX

**Calculation:**
```
Your Energy = (100,000 / 60,000,000,000) × 180,000,000,000
            = 0.00000166667 × 180,000,000,000
            = 300,000 energy per day
```

**Transactions per day:**
- USDT transfer (20k energy with factor): 300,000 / 20,000 = 15 tx/day
- Simple contract call (30k energy): 300,000 / 30,000 = 10 tx/day
- Complex DEX swap (80k energy): 300,000 / 80,000 = 3.75 tx/day

### Worked Example 2: During Network Congestion

**Same stake:** 100,000 TRX

**Network state during congestion:**
- TotalEnergyCurrentLimit: 220,000,000,000 (+22% due to adaptive expansion)
- TotalEnergyWeight: 60,000,000,000 TRX

**Calculation:**
```
Your Energy = (100,000 / 60,000,000,000) × 220,000,000,000
            = 366,667 energy per day
```

**Result:** You get 22% MORE energy during high demand (network expanded capacity).

### Worked Example 3: During Low Activity

**Same stake:** 100,000 TRX

**Network state during low activity:**
- TotalEnergyCurrentLimit: 150,000,000,000 (-16.7% due to adaptive contraction)
- TotalEnergyWeight: 60,000,000,000 TRX

**Calculation:**
```
Your Energy = (100,000 / 60,000,000,000) × 150,000,000,000
            = 250,000 energy per day
```

**Result:** You get 16.7% LESS energy during low demand (network contracted capacity).

### Critical Production Consideration

**Never hardcode energy estimates!**

**Bad code:**
```javascript
// WRONG: Assumes fixed energy limit
const ENERGY_PER_TRX = 3;  // Seen on forums, outdated advice
const myEnergy = frozenTRX * ENERGY_PER_TRX;
```

**Good code:**
```javascript
// CORRECT: Query real-time network state
const chainParams = await tronWeb.trx.getChainParameters();
const totalEnergyLimit = chainParams.find(p => p.key === 'getTotalEnergyCurrentLimit').value;
const totalEnergyWeight = chainParams.find(p => p.key === 'getTotalEnergyWeight').value;

const myEnergy = (frozenTRX / totalEnergyWeight) * totalEnergyLimit;
```

---

## 2.3 Converting Resources to TRX

When you don't have frozen resources, you must burn TRX. Here are the exact costs.

### Bandwidth Fee Formula

**Source**: `/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java:182`

```java
long fee = chainBaseManager.getDynamicPropertiesStore().getTransactionFee() * bytes;
```

**Formula:**
```
Bandwidth Fee (sun) = Transaction Size (bytes) × Transaction Fee (sun/byte)
```

**Default Values:**
```
Transaction Fee: 10 sun per byte
```

**Example Calculations:**
```
250-byte TRX transfer:
  Fee = 250 × 10 = 2,500 sun = 0.0025 TRX

350-byte contract call:
  Fee = 350 × 10 = 3,500 sun = 0.0035 TRX

500-byte complex transaction:
  Fee = 500 × 10 = 5,000 sun = 0.005 TRX
```

**At $0.10 per TRX:**
- 250-byte tx: $0.00025 (negligible)
- 1,000 tx/day: $0.25/day = $7.50/month

**Break-even analysis:**

To get 1,000 tx/day via freezing:
```
Required bandwidth: 1,000 × 250 bytes = 250,000 bytes/day
Required TRX: (250,000 / 43,200,000,000) × 15,000,000,000 = 86,805 TRX

Value at $0.10: $8,680.50

Monthly burn cost: $7.50
Time to break-even: $8,680.50 / $7.50 = 1,157 months (96 years!)
```

**Conclusion:** For bandwidth, burning is almost always cheaper UNLESS you need 10,000+ tx/day.

### Energy Fee Formula

**Source**: Default in DynamicPropertiesStore

```java
long energyFee = 420;  // sun per energy unit
```

**Formula:**
```
Energy Fee (sun) = Energy Required × Energy Fee × (1 + Energy Factor / 100)
```

**Default Values:**
```
Energy Fee: 420 sun per energy unit
Energy Factor: 0-100 (contract-specific)
```

**Example Calculations:**

**New contract (energy_factor = 0):**
```
50,000 energy call:
  Base fee = 50,000 × 420 = 21,000,000 sun = 21 TRX
  At $0.10: $2.10 per call
```

**USDT contract (energy_factor ≈ 20):**
```
14,000 energy transfer:
  Actual energy = 14,000 × 1.20 = 16,800
  Fee = 16,800 × 420 = 7,056,000 sun = 7.056 TRX
  At $0.10: $0.71 per transfer
```

**Popular DEX (energy_factor ≈ 40):**
```
80,000 energy swap:
  Actual energy = 80,000 × 1.40 = 112,000
  Fee = 112,000 × 420 = 47,040,000 sun = 47.04 TRX
  At $0.10: $4.70 per swap
```

### Break-Even Analysis: Freeze vs. Burn

**Scenario:** Your dApp needs 300,000 energy per day.

**Option 1: Burn TRX**
```
Daily energy: 300,000 units
Daily cost: 300,000 × 420 = 126,000,000 sun = 126 TRX
Monthly cost: 126 × 30 = 3,780 TRX
At $0.10: $378/month
Annual cost: $4,536
```

**Option 2: Freeze TRX**
```
Required frozen TRX: (300,000 / 180,000,000,000) × 60,000,000,000 = 100,000 TRX
Value at $0.10: $10,000
Ongoing cost: $0 (can unfreeze after 14 days)
```

**Break-even:**
```
Capital cost: $10,000
Monthly burn savings: $378
Break-even time: $10,000 / $378 = 26.5 months

BUT: After 14 days, you can unfreeze and get your $10,000 back!
Effective cost: $0 (just opportunity cost of locked capital)
```

**Opportunity Cost Comparison:**

If you can earn X% APY on your TRX in DeFi:
```
Daily burn cost: $378/month = $12.60/day
Daily opportunity cost of freezing: $10,000 × (X% / 365)

Break-even APY:
  $12.60 = $10,000 × (X / 365)
  X = ($12.60 × 365) / $10,000
  X = 46%

Conclusion: If you can earn MORE than 46% APY, burning is cheaper.
            Otherwise, freeze.
```

**Realistic APY scenarios:**
- Stable staking: 5-10% APY → **Freeze is 4-9x cheaper**
- DeFi farming: 20-30% APY → **Freeze is 1.5-2.3x cheaper**
- High-risk farming: 50%+ APY → **Burning might be cheaper**

**Production recommendation:** Almost always freeze for high-frequency operations.

---

## 2.4 Network Weight Dynamics

Understanding how network weights change is crucial for capacity planning.

### What Affects Network Weights

**TotalNetWeight increases when:**
1. Users freeze TRX for BANDWIDTH
2. Stake V1 → V2 migrations for bandwidth
3. New accounts stake for bandwidth

**TotalNetWeight decreases when:**
1. Users unfreeze bandwidth (after 14-day delay)
2. Delegations expire and aren't renewed
3. Accounts become inactive

**TotalEnergyWeight** follows the same pattern for ENERGY staking.

### Historical Trends

**Analyzing on-chain data** (approximate):

```
Year    | TotalNetWeight  | TotalEnergyWeight | Trend
--------|-----------------|-------------------|--------
2020    | 8,000,000,000   | 25,000,000,000    | Growth
2021    | 12,000,000,000  | 40,000,000,000    | Bull run
2022    | 18,000,000,000  | 55,000,000,000    | Peak
2023    | 14,000,000,000  | 50,000,000,000    | Correction
2024    | 15,000,000,000  | 60,000,000,000    | Recovery
2025    | 15,000,000,000  | 60,000,000,000    | Stable
```

**Seasonal patterns:**
- Bull markets: Network weights INCREASE (users stake more)
- Bear markets: Network weights DECREASE (users unstake)
- New product launches: Temporary spikes in energy staking

### Impact on Your Resources

**Case Study: The 2022 Bull Run**

**Your stake:** 500,000 TRX frozen for energy (unchanged)

**January 2022:**
```
TotalEnergyWeight: 40,000,000,000
TotalEnergyLimit: 120,000,000,000
Your energy: (500,000 / 40,000,000,000) × 120,000,000,000 = 1,500,000 units/day
```

**June 2022** (peak bull run):
```
TotalEnergyWeight: 55,000,000,000 (+37.5%)
TotalEnergyLimit: 150,000,000,000 (+25%)
Your energy: (500,000 / 55,000,000,000) × 150,000,000,000 = 1,363,636 units/day
```

**Change:** You lost 9% capacity despite network limit increasing 25%!

**Why?** Network weight grew faster than network limit expanded.

### Predicting Resource Changes

**Formula for predicting impact:**
```
New Resource Limit = Old Limit × (Old Weight / New Weight) × (New Limit / Old Limit)
```

**Example:** Network weight increases 20%, network limit stays same:
```
Impact = 1.0 × (100% / 120%) × (100% / 100%)
       = 0.833
       = -16.7% loss in resources
```

**Example:** Network weight increases 20%, network limit increases 10%:
```
Impact = 1.0 × (100% / 120%) × (110% / 100%)
       = 0.917
       = -8.3% loss in resources
```

**Example:** Network weight decreases 15%, network limit stays same:
```
Impact = 1.0 × (100% / 85%) × (100% / 100%)
       = 1.176
       = +17.6% gain in resources
```

### Production Strategies

**Strategy 1: Over-provisioning**
```
Required capacity: 1,000,000 energy/day
Freeze for: 1,300,000 energy/day (30% buffer)
Rationale: Protects against 23% network weight increase
```

**Strategy 2: Dynamic Adjustment**
```javascript
// Monitor network weights weekly
const monitorWeights = async () => {
  const current = await getNetworkWeights();
  const change = (current.totalEnergyWeight - baseline.totalEnergyWeight) / baseline.totalEnergyWeight;

  if (change > 0.10) {  // 10% increase
    alert("Network weight increased 10%, consider staking more TRX");
  }

  if (change < -0.10) {  // 10% decrease
    alert("Network weight decreased 10%, you have excess capacity");
  }
};
```

**Strategy 3: Delegation Hedging**
```
Own stake: 70% of needed capacity
Delegated: 30% from providers
Rationale: Can adjust delegation quickly if network weights change
```

### Real-Time Monitoring

**Essential API calls:**

```javascript
// Get current network parameters
const getNetworkState = async () => {
  const params = await tronWeb.trx.getChainParameters();

  return {
    totalNetLimit: findParam(params, 'getTotalNetLimit'),
    totalNetWeight: findParam(params, 'getTotalNetWeight'),
    totalEnergyLimit: findParam(params, 'getTotalEnergyCurrentLimit'),
    totalEnergyWeight: findParam(params, 'getTotalEnergyWeight'),
    energyFee: findParam(params, 'getEnergyFee'),
    transactionFee: findParam(params, 'getTransactionFee')
  };
};

// Calculate your current limits
const calculateMyLimits = async (frozenBandwidth, frozenEnergy) => {
  const state = await getNetworkState();

  const bandwidthLimit = (frozenBandwidth / state.totalNetWeight) * state.totalNetLimit;
  const energyLimit = (frozenEnergy / state.totalEnergyWeight) * state.totalEnergyLimit;

  return { bandwidthLimit, energyLimit };
};

// Monitor changes
let lastState = await getNetworkState();

setInterval(async () => {
  const newState = await getNetworkState();

  const energyWeightChange = (newState.totalEnergyWeight - lastState.totalEnergyWeight)
                            / lastState.totalEnergyWeight;

  if (Math.abs(energyWeightChange) > 0.05) {  // 5% change
    console.log(`Network energy weight changed by ${(energyWeightChange * 100).toFixed(2)}%`);
    // Recalculate your limits
    const newLimits = await calculateMyLimits(myFrozenBandwidth, myFrozenEnergy);
    console.log("New limits:", newLimits);
  }

  lastState = newState;
}, 3600000);  // Check hourly
```

---

## Code Laboratory

### Exercise 2.1: Resource Calculator Library

**Objective:** Build a comprehensive resource calculator that accounts for all variables

**Starter Code:**

```javascript
class TronResourceCalculator {
  constructor(tronWeb) {
    this.tronWeb = tronWeb;
    this.networkState = null;
  }

  async updateNetworkState() {
    // TODO: Fetch and cache network parameters
    // Hint: Use tronWeb.trx.getChainParameters()
  }

  calculateBandwidthLimit(frozenTRX) {
    // TODO: Implement bandwidth limit calculation
    // Use this.networkState.totalNetLimit and totalNetWeight
  }

  calculateEnergyLimit(frozenTRX) {
    // TODO: Implement energy limit calculation
    // Remember to use TotalEnergyCurrentLimit (adaptive!)
  }

  calculateAvailableResources(limit, usage, lastConsumeTime) {
    // TODO: Apply 24-hour decay formula
    // Hint: Use formula from Chapter 1
  }

  estimateCostToBurn(energyRequired, energyFactor = 0) {
    // TODO: Calculate TRX cost if burning instead of using frozen
  }

  calculateBreakEven(dailyEnergy, apyAlternative) {
    // TODO: Calculate if freezing or burning is cheaper
    // Consider opportunity cost of locked capital
  }
}
```

**Solution:**

```javascript
class TronResourceCalculator {
  constructor(tronWeb) {
    this.tronWeb = tronWeb;
    this.networkState = null;
    this.TRX_PRECISION = 1000000;
    this.WINDOW_SIZE_MS = 24 * 60 * 60 * 1000;
  }

  async updateNetworkState() {
    const params = await this.tronWeb.trx.getChainParameters();

    const findParam = (key) => {
      const param = params.find(p => p.key === key);
      return param ? parseInt(param.value) : null;
    };

    this.networkState = {
      totalNetLimit: findParam('getTotalNetLimit'),
      totalNetWeight: findParam('getTotalNetWeight'),
      totalEnergyCurrentLimit: findParam('getTotalEnergyCurrentLimit'),
      totalEnergyTargetLimit: findParam('getTotalEnergyTargetLimit'),
      totalEnergyWeight: findParam('getTotalEnergyWeight'),
      energyFee: findParam('getEnergyFee') || 420,
      transactionFee: findParam('getTransactionFee') || 10,
      lastUpdate: Date.now()
    };

    return this.networkState;
  }

  calculateBandwidthLimit(frozenTRX) {
    if (!this.networkState) {
      throw new Error("Network state not loaded. Call updateNetworkState() first.");
    }

    if (frozenTRX < 1) {
      return 0;  // Minimum 1 TRX required
    }

    const { totalNetLimit, totalNetWeight } = this.networkState;

    if (totalNetWeight === 0) {
      return 0;
    }

    return Math.floor((frozenTRX / totalNetWeight) * totalNetLimit);
  }

  calculateEnergyLimit(frozenTRX) {
    if (!this.networkState) {
      throw new Error("Network state not loaded. Call updateNetworkState() first.");
    }

    if (frozenTRX < 1) {
      return 0;
    }

    const { totalEnergyCurrentLimit, totalEnergyWeight } = this.networkState;

    if (totalEnergyWeight === 0) {
      return 0;
    }

    return Math.floor((frozenTRX / totalEnergyWeight) * totalEnergyCurrentLimit);
  }

  calculateAvailableResources(limit, usage, lastConsumeTime) {
    const now = Date.now();
    const delta = now - lastConsumeTime;

    if (delta >= this.WINDOW_SIZE_MS) {
      // Fully recovered
      return limit;
    }

    const decayRatio = (this.WINDOW_SIZE_MS - delta) / this.WINDOW_SIZE_MS;
    const currentUsage = Math.floor(usage * decayRatio);

    return Math.max(0, limit - currentUsage);
  }

  estimateCostToBurn(energyRequired, energyFactor = 0) {
    if (!this.networkState) {
      throw new Error("Network state not loaded.");
    }

    const actualEnergy = energyRequired * (100 + energyFactor) / 100;
    const costInSun = actualEnergy * this.networkState.energyFee;
    const costInTRX = costInSun / this.TRX_PRECISION;

    return {
      energyRequired,
      energyFactor,
      actualEnergy,
      costInSun,
      costInTRX
    };
  }

  calculateBreakEven(dailyEnergy, apyAlternative = 0) {
    if (!this.networkState) {
      throw new Error("Network state not loaded.");
    }

    // Cost to burn
    const dailyBurnCost = (dailyEnergy * this.networkState.energyFee) / this.TRX_PRECISION;
    const monthlyBurnCost = dailyBurnCost * 30;
    const annualBurnCost = dailyBurnCost * 365;

    // Cost to freeze
    const requiredFrozen = this.calculateRequiredStake(dailyEnergy, 'energy');
    const opportunityCost = requiredFrozen * apyAlternative;

    // Break-even analysis
    const freezingCheaper = opportunityCost < annualBurnCost;
    const savings = annualBurnCost - opportunityCost;

    return {
      dailyBurnCost,
      monthlyBurnCost,
      annualBurnCost,
      requiredFrozen,
      opportunityCost,
      apyAlternative,
      freezingCheaper,
      annualSavings: savings,
      recommendation: freezingCheaper ? 'FREEZE' : 'BURN'
    };
  }

  calculateRequiredStake(dailyResource, resourceType) {
    if (!this.networkState) {
      throw new Error("Network state not loaded.");
    }

    if (resourceType === 'energy') {
      const { totalEnergyCurrentLimit, totalEnergyWeight } = this.networkState;
      return Math.ceil((dailyResource * totalEnergyWeight) / totalEnergyCurrentLimit);
    } else if (resourceType === 'bandwidth') {
      const { totalNetLimit, totalNetWeight } = this.networkState;
      return Math.ceil((dailyResource * totalNetWeight) / totalNetLimit);
    } else {
      throw new Error("Invalid resource type. Use 'energy' or 'bandwidth'.");
    }
  }

  async estimateTransactionCost(transaction) {
    // Estimate bandwidth cost
    const txSize = JSON.stringify(transaction).length;  // Rough estimate
    const bandwidthCost = txSize * this.networkState.transactionFee;

    // Energy cost depends on contract execution (can't estimate without simulation)
    return {
      estimatedSize: txSize,
      bandwidthCost,
      note: "Energy cost requires contract simulation"
    };
  }
}

// Usage example
const calculator = new TronResourceCalculator(tronWeb);
await calculator.updateNetworkState();

// Calculate limits
const myBandwidth = calculator.calculateBandwidthLimit(10000);
const myEnergy = calculator.calculateEnergyLimit(100000);

console.log(`With 10,000 TRX frozen for bandwidth: ${myBandwidth.toLocaleString()} bytes/day`);
console.log(`With 100,000 TRX frozen for energy: ${myEnergy.toLocaleString()} units/day`);

// Break-even analysis
const analysis = calculator.calculateBreakEven(300000, 0.20);  // 300k energy/day, 20% APY alternative
console.log(`Recommendation: ${analysis.recommendation}`);
console.log(`Annual savings: ${analysis.annualSavings.toFixed(2)} TRX`);
```

### Exercise 2.2: Network Weight Monitor

**Objective:** Build a monitoring service that alerts when network weights change significantly

**Features:**
- Track network weights every hour
- Alert when 5%+ change detected
- Recalculate user's resource limits
- Log historical data for trend analysis

**Challenge:** Implement exponential moving average to smooth out short-term fluctuations

### Exercise 2.3: Resource Forecasting Tool

**Objective:** Predict future resource availability based on historical network weight trends

**Requirements:**
1. Collect 30 days of network weight data
2. Calculate trend (linear regression)
3. Project weights 7/14/30 days into future
4. Estimate impact on user's resources

**Bonus:** Use machine learning to detect seasonal patterns

---

## Production Checklist

### Deployment Phase
- [ ] Calculate required frozen TRX using CURRENT network weights (not outdated data)
- [ ] Add 30% buffer for network weight fluctuations
- [ ] Verify calculations with actual testnet measurements
- [ ] Document network state at deployment time
- [ ] Set up network weight monitoring

### Monitoring Infrastructure
- [ ] Query network parameters every hour minimum
- [ ] Track TotalNetWeight and TotalEnergyWeight changes
- [ ] Recalculate user resource limits dynamically
- [ ] Alert when network weights change >5% in 24 hours
- [ ] Log all network parameter changes

### Capacity Planning
- [ ] Review frozen TRX allocation monthly
- [ ] Adjust stakes based on network weight trends
- [ ] Monitor resource utilization (should stay <80% of limit)
- [ ] Plan for seasonal traffic patterns
- [ ] Test capacity during peak usage simulation

### Cost Optimization
- [ ] Compare freeze vs. burn costs quarterly
- [ ] Consider opportunity cost of frozen capital
- [ ] Evaluate delegation options
- [ ] Optimize contract code to reduce energy usage
- [ ] Batch operations where possible

---

## Common Pitfalls

### Pitfall #1: Using Stale Network Weight Data

**Mistake:**
```javascript
// Calculated once at deployment
const ENERGY_LIMIT = 300000;  // Hardcoded!
```

**Impact:** Network weights change daily. After 30 days, your calculation could be 20% off.

**Fix:**
```javascript
// Fetch fresh data
const calculator = new TronResourceCalculator(tronWeb);
await calculator.updateNetworkState();  // Call before each critical calculation
const energyLimit = calculator.calculateEnergyLimit(myFrozenTRX);
```

### Pitfall #2: Confusing Current vs. Target Energy Limit

**Mistake:**
Using `TotalEnergyTargetLimit` instead of `TotalEnergyCurrentLimit`

**Reality:**
- Target: 180,000,000,000 (committee-set goal)
- Current: 150,000,000,000 to 220,000,000,000 (adaptive actual)

**Fix:** Always use `TotalEnergyCurrentLimit` for calculations.

### Pitfall #3: Not Accounting for Energy Factor

**Mistake:**
```javascript
const energyCost = 50000 * 420;  // Assumes energy_factor = 0
```

**Reality:** Popular contracts have 15-50% penalty

**Fix:**
```javascript
const energyFactor = await getEnergyFactor(contractAddress);  // Query from chain
const actualEnergy = 50000 * (100 + energyFactor) / 100;
const energyCost = actualEnergy * 420;
```

### Pitfall #4: Integer Overflow in Large Calculations

**Mistake:**
```javascript
const bandwidth = (frozenTRX * totalNetLimit) / totalNetWeight;  // Overflow risk!
```

**Fix:**
```javascript
// Use BigInt for large numbers
const bandwidth = (BigInt(frozenTRX) * BigInt(totalNetLimit)) / BigInt(totalNetWeight);
// Or ensure division happens first
const bandwidth = frozenTRX / totalNetWeight * totalNetLimit;
```

### Pitfall #5: Forgetting About Delegations

**Mistake:** Only counting your own frozen TRX

**Reality:** Your limit includes received delegations, excludes given delegations

**Fix:**
```javascript
const ownFrozen = 100000;
const receivedDelegation = 50000;
const givenDelegation = 30000;
const effectiveFrozen = ownFrozen + receivedDelegation - givenDelegation;

const energyLimit = calculator.calculateEnergyLimit(effectiveFrozen);
```

---

## Quick Reference Card

### Bandwidth Limit Formula
```
BandwidthLimit = (FrozenTRX / TotalNetWeight) × TotalNetLimit

Typical values:
- TotalNetLimit: 43,200,000,000 bytes
- TotalNetWeight: 15,000,000,000 TRX
- Example: 10,000 TRX → 28,800 bytes/day
```

### Energy Limit Formula
```
EnergyLimit = (FrozenTRX / TotalEnergyWeight) × TotalEnergyCurrentLimit

Typical values:
- TotalEnergyCurrentLimit: 150B-220B (adaptive!)
- TotalEnergyWeight: 60,000,000,000 TRX
- Example: 100,000 TRX → 250,000-367,000 energy/day
```

### Cost Formulas
```
Bandwidth Fee = ByteSize × 10 sun
Energy Fee = EnergyUsed × (1 + EnergyFactor/100) × 420 sun
```

### Required Stake Formula
```
For Energy:
RequiredTRX = (DailyEnergy × TotalEnergyWeight) / TotalEnergyCurrentLimit

For Bandwidth:
RequiredTRX = (DailyBytes × TotalNetWeight) / TotalNetLimit
```

### Break-Even APY
```
FreezingIsCheaper if: OpportunityCost < BurnCost
OpportunityCost = FrozenTRX × APY
BurnCost = DailyEnergy × 420 × 365 / 1,000,000
```

---

## Summary

You've now mastered the mathematics of TRON resources:

1. **Bandwidth formula**: Proportional share of 43.2 GB network limit
2. **Energy formula**: Proportional share of 150-220B adaptive limit
3. **Network dynamics**: Weights change constantly, affecting your limits
4. **Cost analysis**: Freezing almost always cheaper than burning
5. **Precision matters**: Use real-time data, account for all variables

**Critical Takeaway:** Never hardcode resource calculations. Network weights and adaptive limits change constantly. Query fresh data and recalculate dynamically.

In Chapter 3, we'll explore Stake 2.0 implementation—the system that governs how you freeze, unfreeze, and manage your TRX to obtain these resources.

---

## Further Reading

- EnergyProcessor.java adaptive algorithm: Chapter 9 (Network Economics)
- Energy_factor calculation details: Chapter 5 (Energy Cost Analysis)
- Delegation impact on limits: Chapter 4 (Resource Delegation)

**Next Chapter:** Stake 2.0 Implementation - Master the 14-day unfreeze mechanism and resource type selection
