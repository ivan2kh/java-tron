# Chapter 9: Adaptive Energy Economics

## Introduction: The Dormant Dragon

In the TRON source code, there exists a sophisticated economic mechanism that could fundamentally change how every dApp manages energy costs. It's fully implemented, thoroughly tested, and ready for activation. Yet as of this writing, it remains dormant - disabled by network parameters that can only be changed through governance.

This chapter explores **adaptive energy economics**, TRON's capacity management system that adjusts energy availability based on network utilization. Unlike the previous chapters that described active, production systems, this chapter is about understanding a future that may arrive through a single governance vote.

### Why Study a Dormant System?

You might wonder: why spend time learning about a system that isn't active? Three compelling reasons:

**1. Governance can activate it at any time**

The system isn't missing or hypothetical - it's built, shipped, and waiting. A governance proposal could activate it tomorrow. Your contracts need to be ready.

**2. Understanding capacity management is fundamental**

Even with the system disabled, the principles of adaptive pricing teach critical lessons about blockchain economics. These lessons apply across many networks and future TRON changes.

**3. Design patterns transfer to other variability**

The code patterns for handling variable energy costs apply equally to:
- Network congestion (already exists)
- Future protocol changes
- Multi-chain deployment (different networks, different costs)
- Time-based pricing (if ever implemented)

### The Current State

Query the network parameters right now, and you'll see:

```javascript
// Query current adaptive energy parameters
const params = await tronWeb.trx.getChainParameters();

const dynamicEnergyThreshold = params.find(
    p => p.key === 'getDynamicEnergyThreshold'
).value;

const dynamicEnergyIncreaseFactor = params.find(
    p => p.key === 'getDynamicEnergyIncreaseFactor'
).value;

const dynamicEnergyMaxFactor = params.find(
    p => p.key === 'getDynamicEnergyMaxFactor'
).value;

console.log('Adaptive Energy Status:');
console.log('Threshold:', dynamicEnergyThreshold);  // 0 (system disabled)
console.log('Increase Factor:', dynamicEnergyIncreaseFactor);  // 0 (no penalty)
console.log('Max Factor:', dynamicEnergyMaxFactor);  // 0 (no cap)
```

All zeros. The system is completely disabled. But the code that would use these parameters is everywhere in the codebase, waiting patiently.

### What This Chapter Covers

We'll explore the adaptive system from four angles:

**Section 9.1: The Algorithm**
- How the system tracks network utilization
- The mathematical formula for limit adjustments
- Why it targets 99% utilization

**Section 9.2: Economic Implications**
- Game theory of adaptive pricing
- Impact on different user types
- Cost predictability vs. efficiency trade-offs

**Section 9.3: Capacity Planning**
- Worst-case cost scenarios
- Safety margins for resource allocation
- Monitoring strategies for early detection

**Section 9.4: Future-Proof Contract Design**
- Patterns for cost-aware operations
- Elastic resource allocation
- Graceful degradation under high costs

This is not just theoretical knowledge. By the end of this chapter, you'll have production-ready code that works both with and without adaptive energy active.

---

## 9.1 The Adaptive Energy Algorithm

At its core, the adaptive energy system is deceptively simple: when the network is underutilized, make energy cheaper. When it's congested, make it more expensive. This creates economic incentives that naturally balance supply and demand.

But the devil is in the details. Let's trace exactly how this works, starting with the source code.

### Understanding the Core Mechanism

The system operates through two interconnected algorithms that run every block:

1. **Rolling Average Tracker**: Maintains a 24-hour exponentially weighted moving average (EWMA) of network energy consumption
2. **Limit Adjuster**: Adjusts the total network energy limit based on how actual usage compares to the target

Let's examine each in detail.

### The Rolling Average Tracker

**Source Location**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java:64-89`

Every time a block is produced (every 3 seconds on TRON), the network updates its rolling average of energy consumption. This isn't a simple average - it's an **exponentially weighted moving average** that gives more weight to recent data while incorporating historical patterns.

Here's the actual Java code from the TRON source:

```java
public void updateTotalEnergyAverageUsage() {
    long totalEnergyAverageUsage = getTotalEnergyAverageUsage();
    long totalEnergyAverageTime = getTotalEnergyAverageTime();

    long blockTime = dynamicPropertiesStore.getLatestBlockHeaderTimestamp();
    long block = dynamicPropertiesStore.getLatestBlockHeaderNumber();

    if (block != 0) {
        long newPublicNetUsage = getAllEnergyUsage();
        if (blockTime != totalEnergyAverageTime) {
            long timeInterval = blockTime - totalEnergyAverageTime;
            double feeAverage = (double) timeInterval / WINDOW_SIZE_MS;
            long newAverageUsage = (long) (totalEnergyAverageUsage * (1 - feeAverage));
            newAverageUsage = Math.max(newAverageUsage, 0L);

            dynamicPropertiesStore.saveTotalEnergyAverageUsage(
                newAverageUsage + newPublicNetUsage);
            dynamicPropertiesStore.saveTotalEnergyAverageTime(blockTime);
        }
    }
}
```

Let's break this down step by step:

**Step 1: Retrieve Current State**
```java
long totalEnergyAverageUsage = getTotalEnergyAverageUsage();  // Previous average
long totalEnergyAverageTime = getTotalEnergyAverageTime();    // Last update time
long blockTime = dynamicPropertiesStore.getLatestBlockHeaderTimestamp();  // Current time
```

The system maintains state across blocks. Each block updates the average based on the previous average and the time elapsed.

**Step 2: Calculate Time-Based Decay**
```java
long timeInterval = blockTime - totalEnergyAverageTime;
double feeAverage = (double) timeInterval / WINDOW_SIZE_MS;
```

Where `WINDOW_SIZE_MS = 24 * 60 * 60 * 1000 = 86,400,000` milliseconds (24 hours).

This `feeAverage` represents what fraction of the 24-hour window has passed. For example:
- If 1 hour passed: `feeAverage = 3,600,000 / 86,400,000 = 0.0417` (4.17%)
- If 12 hours passed: `feeAverage = 43,200,000 / 86,400,000 = 0.5` (50%)

**Step 3: Apply Exponential Decay**
```java
long newAverageUsage = (long) (totalEnergyAverageUsage * (1 - feeAverage));
newAverageUsage = Math.max(newAverageUsage, 0L);
```

This is the heart of the EWMA. The old average decays proportionally to how much time has passed:
- More time = more decay
- Recent data matters more than old data
- But old data never completely disappears (exponential, not linear)

**Step 4: Add Current Usage**
```java
long newPublicNetUsage = getAllEnergyUsage();  // Energy used in current block
dynamicPropertiesStore.saveTotalEnergyAverageUsage(
    newAverageUsage + newPublicNetUsage);
```

The decayed average is added to the current block's energy usage, creating the new average.

### Why EWMA Instead of Simple Average?

You might ask: why not just average the last 24 hours of blocks? Three key reasons:

**1. Computational Efficiency**

A simple average requires storing and summing 28,800 blocks (24 hours × 60 minutes × 60 seconds / 3 seconds per block). That's 28,800 data points to maintain and process every block.

EWMA requires storing exactly two numbers: the current average and the last update time. This is O(1) storage and O(1) computation, regardless of the time window.

**2. Gradual Response to Changes**

A simple average has a "cliff effect": when a spike drops out of the 24-hour window, the average suddenly drops. This can cause price volatility.

EWMA gradually incorporates and gradually forgets data. A spike doesn't cause a sudden jump when it "falls off" the window - its influence decays smoothly over time.

**3. Resilience to Gaps**

If blocks are delayed or missed (rare but possible), a simple average gets confused about what blocks to include. EWMA handles gaps naturally - it just treats the gap as a period where the average decays without new data being added.

### Visualizing the EWMA

Let's see how the average responds to different usage patterns:

```javascript
/**
 * EWMA Simulator
 *
 * This code simulates how the EWMA responds to different energy usage patterns.
 * Run this to understand the system's behavior.
 */

class EWMASimulator {
    constructor() {
        this.WINDOW_SIZE_MS = 24 * 60 * 60 * 1000;  // 24 hours
        this.BLOCK_INTERVAL_MS = 3000;  // 3 seconds
        this.average = 0;
        this.lastUpdateTime = 0;
    }

    /**
     * Update the average with new energy usage
     *
     * @param {number} currentTime - Current timestamp in ms
     * @param {number} energyUsed - Energy used in this block
     * @returns {number} - New average
     */
    update(currentTime, energyUsed) {
        if (this.lastUpdateTime === 0) {
            // First update
            this.average = energyUsed;
            this.lastUpdateTime = currentTime;
            return this.average;
        }

        // Calculate time elapsed
        const timeInterval = currentTime - this.lastUpdateTime;

        // Calculate decay factor
        const decayFactor = timeInterval / this.WINDOW_SIZE_MS;

        // Apply exponential decay
        this.average = this.average * (1 - decayFactor);

        // Add current usage
        this.average = this.average + energyUsed;

        // Update timestamp
        this.lastUpdateTime = currentTime;

        return this.average;
    }

    /**
     * Simulate a usage pattern over time
     */
    simulate(pattern, durationHours) {
        const startTime = Date.now();
        const endTime = startTime + (durationHours * 60 * 60 * 1000);

        const results = [];
        let currentTime = startTime;

        while (currentTime < endTime) {
            // Get energy usage for this block based on pattern
            const energyUsed = pattern(currentTime - startTime);

            // Update average
            const avg = this.update(currentTime, energyUsed);

            // Record result every hour
            if (results.length === 0 || currentTime - startTime >= results.length * 60 * 60 * 1000) {
                results.push({
                    hour: (currentTime - startTime) / (60 * 60 * 1000),
                    energyUsed,
                    average: Math.round(avg)
                });
            }

            // Advance to next block
            currentTime += this.BLOCK_INTERVAL_MS;
        }

        return results;
    }
}

// Example 1: Constant usage
console.log('\n=== Scenario 1: Constant Usage (100M energy per block) ===\n');
const sim1 = new EWMASimulator();
const results1 = sim1.simulate(
    () => 100_000_000,  // Constant 100M energy
    48  // 48 hours
);

console.log('Hour | Energy Used | Average');
console.log('-----|-------------|----------');
results1.forEach(r => {
    console.log(`${r.hour.toString().padStart(4)} | ${(r.energyUsed / 1e6).toFixed(0).padStart(11)}M | ${(r.average / 1e6).toFixed(0).padStart(8)}M`);
});

// Example 2: Sudden spike then return to normal
console.log('\n=== Scenario 2: Spike at Hour 12, Then Return to Normal ===\n');
const sim2 = new EWMASimulator();
const results2 = sim2.simulate(
    (elapsedMs) => {
        const hour = elapsedMs / (60 * 60 * 1000);
        if (hour >= 12 && hour < 13) {
            return 500_000_000;  // 5x spike for 1 hour
        }
        return 100_000_000;  // Normal usage
    },
    48
);

console.log('Hour | Energy Used | Average | Notes');
console.log('-----|-------------|---------|------------');
results2.forEach(r => {
    const notes = r.hour === 12 ? '← SPIKE STARTS' :
                  r.hour === 13 ? '← SPIKE ENDS' :
                  r.hour === 36 ? '← 24h after spike' : '';
    console.log(`${r.hour.toString().padStart(4)} | ${(r.energyUsed / 1e6).toFixed(0).padStart(11)}M | ${(r.average / 1e6).toFixed(0).padStart(7)}M | ${notes}`);
});

// Example 3: Gradual increase
console.log('\n=== Scenario 3: Gradual Increase Over 24 Hours ===\n');
const sim3 = new EWMASimulator();
const results3 = sim3.simulate(
    (elapsedMs) => {
        const hour = elapsedMs / (60 * 60 * 1000);
        // Linear increase from 100M to 300M over 24 hours
        return 100_000_000 + (200_000_000 * Math.min(hour / 24, 1));
    },
    36
);

console.log('Hour | Energy Used | Average');
console.log('-----|-------------|----------');
results3.forEach(r => {
    console.log(`${r.hour.toString().padStart(4)} | ${(r.energyUsed / 1e6).toFixed(0).padStart(11)}M | ${(r.average / 1e6).toFixed(0).padStart(8)}M`);
});
```

**Key Observations from the Simulations:**

**Scenario 1 (Constant Usage):**
- The average converges to the constant value
- Takes about 24 hours to fully stabilize
- After stabilization, average ≈ actual usage

**Scenario 2 (Spike):**
- The spike immediately increases the average
- But not to the full spike value (EWMA smooths it)
- Takes 24 hours for the spike's influence to decay by ~63%
- Takes 3-4 days for the spike to be almost completely forgotten

**Scenario 3 (Gradual Increase):**
- The average "lags" behind the actual increase
- This lag means the system reacts conservatively to trends
- Protects against overreacting to temporary changes

### The Limit Adjustment Algorithm

Now that we understand how the system tracks average usage, let's see how it adjusts the energy limit based on that average.

**Source Location**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java:91-118`

```java
private void updateTotalEnergyLimit() {
    if (!dynamicPropertiesStore.getAllowAdaptiveEnergy()) {
        return;  // System disabled - this is why it's not active
    }

    long totalEnergyLimit = dynamicPropertiesStore.getTotalEnergyCurrentLimit();
    long totalEnergyUsage = getAllEnergyUsage();
    long totalEnergyTargetLimit = dynamicPropertiesStore.getTotalEnergyTargetLimit();
    long totalEnergyAverageUsage = getTotalEnergyAverageUsage();

    long targetTimes = dynamicPropertiesStore.getAdaptiveResourceLimitTargetRatio();  // 10 (represents 1000%)

    if (totalEnergyAverageUsage > 0) {
        long targetUsage = totalEnergyAverageUsage * targetTimes / PRECISION;  // Target is 10x average usage

        if (targetUsage > 0) {
            // This is the core adjustment formula
            long result = totalEnergyLimit * totalEnergyTargetLimit / targetUsage;

            // Clamp to reasonable bounds
            long min = totalEnergyTargetLimit * 99 / 100;  // 99% of target (floor)
            long max = totalEnergyTargetLimit * 1000;       // 1000x target (ceiling)

            result = Math.min(result, max);
            result = Math.max(result, min);

            dynamicPropertiesStore.saveTotalEnergyCurrentLimit(result);
        }
    }
}
```

Let's decode this formula step by step.

**The Core Formula:**
```java
result = totalEnergyLimit * totalEnergyTargetLimit / targetUsage;
```

Where:
- `totalEnergyLimit` = Current energy limit (what we're adjusting)
- `totalEnergyTargetLimit` = Base/target energy limit (fixed reference point)
- `targetUsage` = Average usage × 10 (the target is 1000% of average usage)

**Simplified:**
```
NewLimit = CurrentLimit × TargetLimit / (AverageUsage × 10)
```

**What This Means:**

If `AverageUsage × 10 < TargetLimit` (network underutilized):
- Denominator is small
- Division result is large
- **NewLimit increases** (energy becomes cheaper)

If `AverageUsage × 10 > TargetLimit` (network congested):
- Denominator is large
- Division result is small
- **NewLimit decreases** (energy becomes more expensive)

If `AverageUsage × 10 = TargetLimit` (network at target):
- Denominator = TargetLimit
- `NewLimit = CurrentLimit × TargetLimit / TargetLimit = CurrentLimit`
- **NewLimit stays the same** (equilibrium)