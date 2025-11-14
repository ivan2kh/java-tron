# Chapter 6: Recovery Mechanisms

> **Source**: Based on ResourceProcessor.java recovery algorithms

## 6.1 24-Hour Linear Recovery Model

### 6.1.1 Core Recovery Formula

TRON resources recover linearly over a 24-hour window:

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 47-64)

```
remaining_usage(t) = last_usage × (1 - elapsed_time / window_size)

Where:
- last_usage: Usage at last consumption
- elapsed_time: Time since last consumption (in blocks)
- window_size: 28,800 blocks (24 hours at 3 seconds/block)
```

### 6.1.2 Recovery Timeline

```
Block-based Timeline:
Time 0:    Usage = 1,000 bandwidth (100% used)
Block 7200 (6h):   Usage = 750 (75% used, 25% recovered)
Block 14400 (12h): Usage = 500 (50% used, 50% recovered)
Block 21600 (18h): Usage = 250 (25% used, 75% recovered)
Block 28800 (24h): Usage = 0 (0% used, 100% recovered)
```

**Graphical Representation**:

```
Usage
1000│●
    │ ╲
 750│   ●
    │     ╲
 500│       ●
    │         ╲
 250│           ●
    │             ╲
   0│_______________●______ Blocks
    0    7200  14400  21600  28800
    (0h)  (6h)  (12h)  (18h)  (24h)
```

### 6.1.3 Mathematical Derivation

**Decay Function**:

$$
\text{decay}(t) = 1 - \frac{t}{\text{window\_size}}
$$

**Properties**:
- At $t = 0$: $\text{decay} = 1$ (no recovery)
- At $t = \frac{\text{window}}{2}$: $\text{decay} = 0.5$ (50% recovery)
- At $t \geq \text{window}$: $\text{decay} = 0$ (full recovery)

**Remaining Usage**:

$$
\text{remaining}(t) = \text{initial} \times \text{decay}(t)
$$

**Available Resources**:

$$
\text{available}(t) = \text{limit} - \text{remaining}(t)
$$

### 6.1.4 Implementation Analysis

**Source Code**:

```java
protected long increase(long lastUsage, long usage, long lastTime, long now, long windowSize) {
    // Convert to average usage (with precision scaling)
    long averageLastUsage = divideCeil(lastUsage * precision, windowSize);
    long averageUsage = divideCeil(usage * precision, windowSize);

    if (lastTime != now) {
        assert now > lastTime;

        if (lastTime + windowSize > now) {
            // Within recovery window
            long delta = now - lastTime;
            double decay = (windowSize - delta) / (double) windowSize;
            averageLastUsage = round(averageLastUsage * decay, this.disableJavaLangMath());
        } else {
            // Beyond recovery window - fully recovered
            averageLastUsage = 0;
        }
    }

    // Add new consumption
    averageLastUsage += averageUsage;

    // Convert back from average
    return getUsage(averageLastUsage, windowSize);
}

private long divideCeil(long numerator, long denominator) {
    return (numerator / denominator) + ((numerator % denominator) > 0 ? 1 : 0);
}

private long getUsage(long usage, long windowSize) {
    return usage * windowSize / precision;
}
```

**Key Insights**:
1. Uses **precision scaling** (10^6) to avoid floating-point errors
2. **Ceiling division** ensures conservative resource estimates
3. **Three cases**:
   - Same block: No recovery
   - Within window: Partial recovery
   - Beyond window: Full recovery

## 6.2 Multiple Consumption Cycles

### 6.2.1 Superposition Principle

When multiple consumptions occur, each decays independently:

**Formula**:

$$
\text{total}(t) = \sum_{i} \text{usage}_i \times \left(1 - \frac{t - t_i}{\text{window}}\right)^+
$$

Where $(x)^+ = \max(x, 0)$

**Example**:

```
Bandwidth limit: 10,000

Consumption 1 (Block 0): 3,000 bandwidth
Consumption 2 (Block 7,200): 2,000 bandwidth

At Block 14,400:
- From consumption 1: 3,000 × (1 - 14,400/28,800) = 1,500
- From consumption 2: 2,000 × (1 - 7,200/28,800) = 1,500
- Total usage: 3,000
- Available: 10,000 - 3,000 = 7,000
```

### 6.2.2 Continuous Usage Pattern

**Scenario**: User consumes 500 bandwidth every 6 hours

```
Block 0:     Consume 500 → Usage = 500
Block 7,200:
  - Recovery: 500 × 0.75 = 375
  - Consume: 500
  - Total: 375 + 500 = 875

Block 14,400:
  - Recovery from Block 0: 500 × 0.50 = 250
  - Recovery from Block 7,200: 500 × 0.75 = 375
  - Total from recovery: 625
  - Consume: 500
  - Total: 625 + 500 = 1,125

Block 21,600:
  - Recovery from Block 0: 500 × 0.25 = 125
  - Recovery from Block 7,200: 500 × 0.50 = 250
  - Recovery from Block 14,400: 500 × 0.75 = 375
  - Total from recovery: 750
  - Consume: 500
  - Total: 750 + 500 = 1,250

Equilibrium:
After sufficient time, usage stabilizes based on consumption rate.
If consuming 500 every 6 hours, average usage ≈ 1,250 - 1,500
```

### 6.2.3 Burst vs Sustained Usage

**Burst Pattern**: Large usage, then idle

```
Block 0: Consume 5,000 (half of 10,000 limit)
Block 7,200: Usage = 3,750 (25% recovered)
Block 14,400: Usage = 2,500 (50% recovered)
Block 21,600: Usage = 1,250 (75% recovered)
Block 28,800: Usage = 0 (100% recovered)

Available at Block 14,400: 10,000 - 2,500 = 7,500
```

**Sustained Pattern**: Regular usage

```
Every 3 hours (2,400 blocks): Consume 1,000

Block 0: 1,000
Block 2,400: 917 + 1,000 = 1,917
Block 4,800: 1,583 + 1,000 = 2,583
Block 7,200: 2,188 + 1,000 = 3,188
...
Stabilizes around 3,500 - 4,000 usage
```

## 6.3 Recovery During Resource Changes

### 6.3.1 Recovery During Unfreeze

When unfreezing, limits decrease but recovery continues:

**Example**:

```
Initial State:
- Frozen: 100,000 TRX
- Bandwidth limit: 43,200
- Bandwidth used: 21,600 (50% of limit)
- Last consumption: Block 0

Block 14,400 (12 hours later):
- Before unfreeze:
  * Recovery: 21,600 × 0.5 = 10,800
  * Available: 43,200 - 10,800 = 32,400

- Unfreeze 50,000 TRX:
  * New limit: 21,600 (50% reduction)
  * Usage remains: 10,800
  * Available: 21,600 - 10,800 = 10,800

Result: User still has resources available, but reduced proportionally
```

**Critical Case**: Usage exceeds new limit

```
Initial:
- Limit: 43,200
- Used: 32,400 (75%)
- Recovered to: 16,200 at Block 14,400

Unfreeze 75,000 TRX:
- New limit: 10,800
- Usage: 16,200 (EXCEEDS new limit!)
- Available: 0 (usage > limit)

User must wait for further recovery before using resources
```

### 6.3.2 Recovery During Delegation

**Owner Perspective**:

```
Before Delegation:
- Own frozen: 100,000 TRX
- Limit: 43,200 bandwidth
- Used: 10,000
- Available: 33,200

Delegate 50,000 TRX worth (21,600 bandwidth):
- New limit: 21,600 (own resources only)
- Used: 10,000 (unchanged)
- Available: 11,600

Recovery continues normally on the 10,000 usage
```

**Receiver Perspective**:

```
Before Delegation:
- Own: 0
- Acquired: 0
- Limit: 0

Receive Delegation (21,600 bandwidth):
- Own: 0
- Acquired: 21,600
- Total limit: 21,600
- Used: 0
- Available: 21,600

Receiver can immediately use resources
```

### 6.3.3 Recovery During Undelegation

**Complex Scenario**: Window size recalculation

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 193-203)

```java
long newOwnerWindowSize = divideCeil(
    ownerUsage * remainOwnerWindowSizeV2 + transferUsage * remainReceiverWindowSizeV2,
    newOwnerUsage
);
```

**Example**:

```
Owner:
- Usage: 1,000 bandwidth
- Window remaining: 28,800 blocks (full 24h)

Receiver (receiving undelegation):
- Usage contribution to owner: 500 bandwidth
- Window remaining: 14,400 blocks (50% recovered)

New owner state:
new_usage = 1,000 + 500 = 1,500
new_window = (1,000 × 28,800 + 500 × 14,400) / 1,500
           = (28,800,000 + 7,200,000) / 1,500
           = 24,000 blocks (~20 hours)

Owner inherits proportionally weighted recovery window
```

**Implications**:
- Owner's recovery is affected by receiver's usage pattern
- If receiver used resources recently, owner's recovery slows
- Window size is weighted average of both recovery states

## 6.4 Edge Cases and Special Scenarios

### 6.4.1 Zero Usage Edge Case

```java
if (newOwnerUsage == 0) {
    // No usage - reset to clean state
    owner.setNewWindowSize(resourceCode, this.windowSize);
    owner.setUsage(resourceCode, 0);
    owner.setLatestTime(resourceCode, now);
    return;
}
```

**Scenario**: All usage fully recovered before new consumption

```
Last usage: 1,000
Last time: Block 0
Current time: Block 30,000 (beyond 24h window)

Recovery calculation:
elapsed = 30,000 (exceeds 28,800)
averageLastUsage = 0 (fully recovered)

New consumption: 500
Result: Usage = 0 + 500 = 500 (clean slate)
```

### 6.4.2 Same-Block Consumption

```java
if (lastTime != now) {
    // Apply recovery
} else {
    // Same block - no recovery
    averageLastUsage += averageUsage;
}
```

**Scenario**: Multiple operations in same block

```
Block 1000:
- Operation 1: Use 100 bandwidth
- Operation 2: Use 200 bandwidth (same block)

Total usage: 100 + 200 = 300
No recovery between operations (same block)
```

### 6.4.3 Precision Edge Cases

**Rounding Effects**:

```
Usage: 1 bandwidth
Window: 28,800 blocks
Precision: 1,000,000

averageUsage = ceil((1 × 1,000,000) / 28,800)
             = ceil(34.72...)
             = 35

After half window:
decay = 0.5
averageUsage = round(35 × 0.5) = 18

final_usage = (18 × 28,800) / 1,000,000
            = 518,400 / 1,000,000
            = 0 (integer division)

Very small usages may round to zero faster than expected
```

### 6.4.4 Maximum Window Size

**V2 Enhancement**: Window size precision

```java
// V2 uses higher precision for window size
accountCapsule.setNewWindowSizeV2(resourceCode, this.windowSize * WINDOW_SIZE_PRECISION);

// WINDOW_SIZE_PRECISION = 1,000,000
// Allows fractional window sizes for more accurate recovery tracking
```

## 6.5 Recovery Monitoring and Prediction

### 6.5.1 Calculate Current Available Resources

```javascript
class ResourceRecoveryCalculator {
    constructor(windowSize = 28800, precision = 1000000) {
        this.windowSize = windowSize;
        this.precision = precision;
    }

    calculateAvailable(limit, lastUsage, lastTime, currentTime) {
        const elapsed = currentTime - lastTime;

        let currentUsage;
        if (elapsed >= this.windowSize) {
            // Fully recovered
            currentUsage = 0;
        } else {
            // Partial recovery
            const decay = (this.windowSize - elapsed) / this.windowSize;
            currentUsage = Math.floor(lastUsage * decay);
        }

        return {
            limit: limit,
            used: currentUsage,
            available: Math.max(0, limit - currentUsage),
            percentUsed: limit > 0 ? (currentUsage / limit) * 100 : 0,
            percentRecovered: lastUsage > 0 ? ((lastUsage - currentUsage) / lastUsage) * 100 : 100
        };
    }

    predictRecoveryTime(currentUsage, targetAvailable, limit) {
        if (currentUsage <= limit - targetAvailable) {
            return 0;  // Already have enough
        }

        const usageToRecover = currentUsage - (limit - targetAvailable);
        const recoveryRate = currentUsage / this.windowSize;
        const blocksNeeded = Math.ceil(usageToRecover / recoveryRate);

        return {
            blocks: blocksNeeded,
            seconds: blocksNeeded * 3,
            hours: (blocksNeeded * 3) / 3600
        };
    }

    getRecoveryTimeline(currentUsage, intervals = 8) {
        const timeline = [];
        const step = this.windowSize / intervals;

        for (let i = 0; i <= intervals; i++) {
            const blocks = i * step;
            const decay = Math.max(0, 1 - blocks / this.windowSize);
            const usage = Math.floor(currentUsage * decay);

            timeline.push({
                block: blocks,
                hours: (blocks * 3) / 3600,
                usage: usage,
                percentRecovered: ((currentUsage - usage) / currentUsage) * 100
            });
        }

        return timeline;
    }
}
```

**Usage Example**:

```javascript
const calculator = new ResourceRecoveryCalculator();

// Current state
const limit = 43200;
const lastUsage = 30000;
const lastTime = 1000;
const currentTime = 15400;  // 14,400 blocks later (12 hours)

const status = calculator.calculateAvailable(limit, lastUsage, lastTime, currentTime);
console.log(status);
// {
//   limit: 43200,
//   used: 15000,
//   available: 28200,
//   percentUsed: 34.72,
//   percentRecovered: 50.00
// }

// Predict when we'll have 40,000 available
const prediction = calculator.predictRecoveryTime(15000, 40000, 43200);
console.log(prediction);
// {
//   blocks: 10800,
//   seconds: 32400,
//   hours: 9
// }

// Get full timeline
const timeline = calculator.getRecoveryTimeline(30000);
timeline.forEach(point => {
    console.log(`${point.hours.toFixed(1)}h: ${point.usage} used (${point.percentRecovered.toFixed(1)}% recovered)`);
});
// 0.0h: 30000 used (0.0% recovered)
// 3.0h: 22500 used (25.0% recovered)
// 6.0h: 15000 used (50.0% recovered)
// 9.0h: 7500 used (75.0% recovered)
// 12.0h: 0 used (100.0% recovered)
```

### 6.5.2 Real-time Recovery Tracking

```javascript
class ResourceMonitor {
    constructor(account, calculator) {
        this.account = account;
        this.calculator = calculator;
        this.updateInterval = 3000;  // 3 seconds (1 block)
    }

    start() {
        this.intervalId = setInterval(() => {
            this.update();
        }, this.updateInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    update() {
        const currentBlock = this.estimateCurrentBlock();

        // Calculate bandwidth recovery
        const bandwidth = this.calculator.calculateAvailable(
            this.account.bandwidthLimit,
            this.account.netUsage,
            this.account.latestConsumeTime,
            currentBlock
        );

        // Calculate energy recovery
        const energy = this.calculator.calculateAvailable(
            this.account.energyLimit,
            this.account.energyUsage,
            this.account.latestConsumeTimeForEnergy,
            currentBlock
        );

        this.onUpdate({
            bandwidth,
            energy,
            block: currentBlock,
            timestamp: Date.now()
        });
    }

    estimateCurrentBlock() {
        // Estimate block based on time elapsed
        const genesisTime = 1529891468000;  // TRON genesis timestamp
        const blockInterval = 3000;  // 3 seconds
        return Math.floor((Date.now() - genesisTime) / blockInterval);
    }

    onUpdate(status) {
        // Override this method to handle updates
        console.log('Resource Status:', status);
    }
}
```

## 6.6 Recovery Optimization Strategies

### 6.6.1 Timing Batch Operations

**Strategy**: Schedule operations when resources are recovered

```javascript
async function waitForResources(account, requiredBandwidth, requiredEnergy) {
    const calculator = new ResourceRecoveryCalculator();

    while (true) {
        const currentBlock = estimateCurrentBlock();

        const bandwidth = calculator.calculateAvailable(
            account.bandwidthLimit,
            account.netUsage,
            account.latestConsumeTime,
            currentBlock
        );

        const energy = calculator.calculateAvailable(
            account.energyLimit,
            account.energyUsage,
            account.latestConsumeTimeForEnergy,
            currentBlock
        );

        if (bandwidth.available >= requiredBandwidth &&
            energy.available >= requiredEnergy) {
            return true;  // Resources available
        }

        // Wait one block
        await sleep(3000);
    }
}

// Usage
await waitForResources(account, 1000, 50000);
await executeBatchTransactions();
```

### 6.6.2 Staggered Usage Pattern

**Strategy**: Distribute usage over time to maintain availability

```javascript
// ❌ Bad: Use all resources at once
async function processAll(items) {
    for (const item of items) {
        await processItem(item);  // Uses 5,000 energy each
    }
    // All 100,000 energy consumed in 1 block
    // Must wait 24h for full recovery
}

// ✅ Good: Stagger over time
async function processStaggered(items) {
    for (const item of items) {
        await processItem(item);

        // Wait for partial recovery
        await sleep(3000);  // 1 block = 1/28800 recovery

        // Or wait until specific threshold
        await waitForResources(account, 0, 10000);
    }
    // Maintains availability throughout
}
```

### 6.6.3 Resource Pool Management

**Strategy**: Maintain minimum available resources

```javascript
class ResourcePool {
    constructor(account, minBandwidth = 5000, minEnergy = 50000) {
        this.account = account;
        this.minBandwidth = minBandwidth;
        this.minEnergy = minEnergy;
        this.queue = [];
    }

    async execute(operation, bandwidthCost, energyCost) {
        // Check if operation would breach minimum
        const available = this.getCurrentAvailable();

        if (available.bandwidth - bandwidthCost < this.minBandwidth ||
            available.energy - energyCost < this.minEnergy) {
            // Queue for later
            this.queue.push({ operation, bandwidthCost, energyCost });
            return { queued: true };
        }

        // Execute immediately
        const result = await operation();
        this.account.netUsage += bandwidthCost;
        this.account.energyUsage += energyCost;

        // Process queue if possible
        this.processQueue();

        return { executed: true, result };
    }

    async processQueue() {
        while (this.queue.length > 0) {
            const available = this.getCurrentAvailable();
            const next = this.queue[0];

            if (available.bandwidth - next.bandwidthCost >= this.minBandwidth &&
                available.energy - next.energyCost >= this.minEnergy) {
                this.queue.shift();
                await next.operation();
            } else {
                break;
            }
        }
    }

    getCurrentAvailable() {
        const calculator = new ResourceRecoveryCalculator();
        const currentBlock = estimateCurrentBlock();

        return {
            bandwidth: calculator.calculateAvailable(
                this.account.bandwidthLimit,
                this.account.netUsage,
                this.account.latestConsumeTime,
                currentBlock
            ).available,
            energy: calculator.calculateAvailable(
                this.account.energyLimit,
                this.account.energyUsage,
                this.account.latestConsumeTimeForEnergy,
                currentBlock
            ).available
        };
    }
}
```

## 6.7 Summary

### Key Takeaways

1. **Linear Recovery**: Resources recover uniformly over 24 hours
2. **Block-based**: Recovery calculated in 3-second blocks, not real time
3. **Continuous**: Recovery happens every block automatically
4. **Independent**: Each resource type recovers separately
5. **Superposition**: Multiple consumptions decay independently
6. **Window Adjustment**: Delegation/undelegation affects recovery windows

### Recovery Characteristics

| Aspect | Value |
|--------|-------|
| Window Size | 28,800 blocks (24 hours) |
| Recovery Rate | 1/28,800 per block |
| Minimum Unit | 1 block (3 seconds) |
| Full Recovery | 24 hours after last use |
| 50% Recovery | 12 hours after last use |
| Calculation | Linear decay function |

### Best Practices

✅ Monitor current usage with recovery calculator
✅ Predict when resources will be available
✅ Schedule operations during recovery periods
✅ Maintain minimum resource buffer
✅ Stagger usage to maintain availability
✅ Use real-time tracking for critical applications

### Common Patterns

**Burst Usage**: Large consumption, then wait for recovery
**Sustained Usage**: Regular consumption with steady-state usage
**Staggered Usage**: Distributed consumption maintaining availability
**Pooled Resources**: Multiple accounts sharing resource pool

---

**Next Chapter**: Chapter 7 explores network parameters and governance, including committee-controlled parameters, proposal systems, and parameter evolution history.

**References**:
- java-tron source: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java`
- Mathematical analysis: Linear decay models
- Production strategies: Resource pool management patterns
