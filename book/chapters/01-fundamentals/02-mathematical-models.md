# Chapter 2: Mathematical Models and Formulas

> **Source**: Direct analysis of java-tron ResourceProcessor.java, BandwidthProcessor.java, and EnergyProcessor.java

## 2.1 Introduction to TRON Resource Mathematics

TRON's resource management system is built on precise mathematical models that govern how resources are allocated, consumed, and recovered. This chapter provides rigorous mathematical analysis of these models, complete with proofs, derivations, and source code references.

### 2.1.1 Core Mathematical Concepts

1. **Precision Arithmetic**: Avoid floating-point errors with integer math
2. **Linear Decay Functions**: Time-based resource recovery
3. **Proportional Allocation**: Weight-based resource distribution
4. **Window-based Tracking**: 24-hour rolling recovery windows

## 2.2 Fundamental Constants

**Source**: `common/src/main/java/org/tron/core/config/Parameter.java`

```java
public class ChainConstant {
    // Temporal constants
    public static final long BLOCK_PRODUCED_INTERVAL = 3000;  // 3 seconds per block
    public static final long WINDOW_SIZE_MS = 86400000;       // 24 hours in milliseconds

    // Precision constants
    public static final long TRX_PRECISION = 1000000;         // 1 TRX = 10^6 sun
    public static final long PRECISION = 1000000;             // General calculation precision

    // Resource constants
    public static final long FREE_NET_LIMIT = 5000;           // Free bandwidth per account

    // Unfreeze constants
    public static final long UNFREEZE_DELAY = 1209600000L;    // 14 days in milliseconds
    public static final long DELEGATE_PERIOD = 2592000000L;   // 30 days in milliseconds
}
```

### 2.2.1 Derived Constants

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 34-37)

```java
// Window size in blocks (not milliseconds)
this.windowSize = ChainConstant.WINDOW_SIZE_MS / BLOCK_PRODUCED_INTERVAL;
// = 86,400,000 ms / 3,000 ms
// = 28,800 blocks

// Average window for adaptive scaling
this.averageWindowSize = AdaptiveResourceLimitConstants.PERIODS_MS / BLOCK_PRODUCED_INTERVAL;
// = 63,000 ms / 3,000 ms
// = 21 blocks
```

**Why Block-based Windows?**

Block times can vary slightly due to network conditions. Using block counts instead of timestamps provides:
1. Consistent resource recovery regardless of minor timestamp variations
2. Predictable behavior for testing and validation
3. Alignment with blockchain state transitions

## 2.3 Resource Allocation Formula

### 2.3.1 General Allocation Model

For both BANDWIDTH and ENERGY, resources are allocated proportionally based on frozen TRX:

$$
\text{resource\_limit} = \frac{\text{frozen\_balance}}{\text{TRX\_PRECISION}} \times \frac{\text{total\_resource\_limit}}{\text{total\_resource\_weight}}
$$

**Where**:
- $\text{frozen\_balance}$: User's frozen TRX (in sun, where 1 TRX = $10^6$ sun)
- $\text{TRX\_PRECISION} = 10^6$: Conversion factor from sun to TRX
- $\text{total\_resource\_limit}$: Network-wide resource limit
- $\text{total\_resource\_weight}$: Sum of all users' frozen TRX for this resource type

### 2.3.2 Bandwidth Allocation Formula

**Source**: `chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java` (Lines 141-150)

```java
public long calculateGlobalNetLimit(AccountCapsule accountCapsule) {
    long frozeBalance = accountCapsule.getAllFrozenBalanceForBandwidth();
    if (frozeBalance < TRX_PRECISION) {
        return 0;
    }

    long netWeight = frozeBalance / TRX_PRECISION;
    long totalNetLimit = dynamicPropertiesStore.getTotalNetLimit();
    long totalNetWeight = dynamicPropertiesStore.getTotalNetWeight();

    if (totalNetWeight == 0) {
        return 0;
    }

    return (netWeight * totalNetLimit) / totalNetWeight;
}
```

**Mathematical Expression**:

$$
\text{bandwidth\_limit} = \left\lfloor \frac{\text{net\_weight} \times \text{total\_net\_limit}}{\text{total\_net\_weight}} \right\rfloor
$$

**Where**:

$$
\text{net\_weight} = \left\lfloor \frac{\text{frozen\_balance}}{10^6} \right\rfloor
$$

**Properties**:

1. **Linearity**: Doubling frozen balance doubles bandwidth (if total weight unchanged)
2. **Zero Threshold**: Must freeze at least 1 TRX (1,000,000 sun) to get resources
3. **Network Dependency**: Individual limits inversely proportional to total network weight
4. **Integer Division**: Floor division ensures no fractional bandwidth units

### 2.3.3 Energy Allocation Formula

**Source**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java` (Lines 141-150)

```java
public long calculateGlobalEnergyLimit(AccountCapsule accountCapsule) {
    long frozeBalance = accountCapsule.getAllFrozenBalanceForEnergy();
    if (frozeBalance < TRX_PRECISION) {
        return 0;
    }

    long energyWeight = frozeBalance / TRX_PRECISION;
    long totalEnergyCurrentLimit = dynamicPropertiesStore.getTotalEnergyCurrentLimit();
    long totalEnergyWeight = dynamicPropertiesStore.getTotalEnergyWeight();

    if (totalEnergyWeight == 0) {
        return 0;
    }

    return (energyWeight * totalEnergyCurrentLimit) / totalEnergyWeight;
}
```

**Mathematical Expression**:

$$
\text{energy\_limit} = \left\lfloor \frac{\text{energy\_weight} \times \text{total\_energy\_current\_limit}}{\text{total\_energy\_weight}} \right\rfloor
$$

**Key Difference from Bandwidth**: Uses `total_energy_current_limit` (adaptive) instead of static `total_energy_limit`.

### 2.3.4 Example Calculations

**Example 1: Bandwidth Calculation**

Given:
- User frozen: 10,000 TRX = 10,000,000,000 sun
- Total network weight: 10,000,000,000 TRX
- Total net limit: 43,200,000,000 bytes

Solution:
$$
\begin{align*}
\text{net\_weight} &= \frac{10,000,000,000}{1,000,000} = 10,000 \text{ TRX} \\
\text{bandwidth\_limit} &= \frac{10,000 \times 43,200,000,000}{10,000,000,000} \\
&= \frac{432,000,000,000,000}{10,000,000,000} \\
&= 43,200 \text{ bytes}
\end{align*}
$$

**Interpretation**: User gets 43,200 bytes of bandwidth every 24 hours.

**Example 2: Energy Calculation with Adaptive Limit**

Given:
- User frozen: 100,000 TRX = 100,000,000,000 sun
- Total network weight: 10,000,000,000 TRX
- Total energy current limit: 216,000,000,000 energy (120% of base due to adaptation)

Solution:
$$
\begin{align*}
\text{energy\_weight} &= \frac{100,000,000,000}{1,000,000} = 100,000 \text{ TRX} \\
\text{energy\_limit} &= \frac{100,000 \times 216,000,000,000}{10,000,000,000} \\
&= \frac{21,600,000,000,000,000}{10,000,000,000} \\
&= 2,160,000 \text{ energy}
\end{align*}
$$

**Note**: If base limit were used (180B), result would be 1,800,000 energy. Adaptive scaling provides 20% more.

## 2.4 Linear Recovery Model

### 2.4.1 Core Recovery Algorithm

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 47-64)

The recovery algorithm implements a linear decay function:

```java
protected long increase(long lastUsage, long usage, long lastTime, long now, long windowSize) {
    long averageLastUsage = divideCeil(lastUsage * precision, windowSize);
    long averageUsage = divideCeil(usage * precision, windowSize);

    if (lastTime != now) {
        assert now > lastTime;
        if (lastTime + windowSize > now) {
            long delta = now - lastTime;
            double decay = (windowSize - delta) / (double) windowSize;
            averageLastUsage = round(averageLastUsage * decay,
                this.disableJavaLangMath());
        } else {
            averageLastUsage = 0;
        }
    }
    averageLastUsage += averageUsage;
    return getUsage(averageLastUsage, windowSize);
}
```

**Mathematical Model**:

$$
\text{new\_usage} = \begin{cases}
\text{current\_usage} & \text{if } \Delta t = 0 \\
0 + \text{current\_usage} & \text{if } \Delta t \geq \text{window\_size} \\
\left\lfloor \text{last\_usage} \times \frac{\text{window\_size} - \Delta t}{\text{window\_size}} \right\rfloor + \text{current\_usage} & \text{otherwise}
\end{cases}
$$

**Where**:
- $\Delta t = \text{now} - \text{last\_time}$: Time elapsed since last consumption (in blocks)
- $\text{window\_size} = 28,800$ blocks (24 hours)

### 2.4.2 Decay Function Derivation

The decay factor is:

$$
\text{decay} = \frac{\text{window\_size} - \Delta t}{\text{window\_size}} = 1 - \frac{\Delta t}{\text{window\_size}}
$$

**Properties**:

1. **Initial State** ($\Delta t = 0$):
   $$\text{decay} = 1 \implies \text{no recovery yet}$$

2. **Halfway Through Window** ($\Delta t = 14,400$ blocks):
   $$\text{decay} = \frac{28,800 - 14,400}{28,800} = 0.5 \implies \text{50\% recovered}$$

3. **Full Window Elapsed** ($\Delta t \geq 28,800$ blocks):
   $$\text{decay} = 0 \implies \text{100\% recovered}$$

**Graphical Representation**:

```
Usage
  │
100%│●
    │ ╲
    │   ╲
 50%│     ●
    │       ╲
    │         ╲
  0%│___________●______ Time
    0    12h    24h
```

The decay is **linear**, not exponential:
- Exponential decay: $\text{usage}(t) = \text{initial} \times e^{-\lambda t}$
- TRON linear decay: $\text{usage}(t) = \text{initial} \times (1 - t / \text{window})$

### 2.4.3 Precision Arithmetic

To avoid floating-point errors, TRON uses integer arithmetic with precision scaling:

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 48-49)

```java
long averageLastUsage = divideCeil(lastUsage * precision, windowSize);
// precision = 1,000,000
```

**Mathematical Transformation**:

$$
\text{average\_usage} = \left\lceil \frac{\text{usage} \times 10^6}{\text{window\_size}} \right\rceil
$$

**Example**:

```
lastUsage = 1000 bytes
windowSize = 28,800 blocks
precision = 1,000,000

averageLastUsage = ceil((1000 × 1,000,000) / 28,800)
                 = ceil(34,722.222...)
                 = 34,723

After decay (50% recovered):
decay = 0.5
decayedUsage = round(34,723 × 0.5) = 17,362

Convert back:
newUsage = (17,362 × 28,800) / 1,000,000
         = 500 bytes (approximately)
```

**Ceiling Division Function**:

```java
private long divideCeil(long numerator, long denominator) {
    return (numerator / denominator) + ((numerator % denominator) > 0 ? 1 : 0);
}
```

This ensures:
$$
\text{divideCeil}(a, b) = \left\lceil \frac{a}{b} \right\rceil
$$

### 2.4.4 Multiple Consumption Cycles

For multiple consumptions within the window:

**Scenario**: User consumes resources twice

1. **First consumption** (at $t_0$):
   ```
   usage₁ = 1000 bytes
   total_usage = 1000 bytes
   ```

2. **Second consumption** (at $t_1 = t_0 + 12$ hours):
   ```
   Δt = 14,400 blocks (12 hours)
   decay = (28,800 - 14,400) / 28,800 = 0.5
   decayed_usage₁ = 1000 × 0.5 = 500 bytes

   usage₂ = 500 bytes (new consumption)
   total_usage = 500 + 500 = 1000 bytes
   ```

**General Formula for $n$ consumptions**:

$$
\text{total\_usage}(t) = \sum_{i=1}^{n} \text{usage}_i \times \left(1 - \frac{t - t_i}{\text{window\_size}}\right)^+
$$

Where $(x)^+ = \max(x, 0)$ ensures non-negative values.

## 2.5 Adaptive Energy Scaling Model

### 2.5.1 Adaptive Mechanism Overview

TRON's energy system can dynamically adjust total network energy based on demand. This prevents network congestion during high usage periods.

**Source**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java` (Lines 64-89)

```java
public void updateAdaptiveTotalEnergyLimit() {
    long totalEnergyAverageUsage = dynamicPropertiesStore.getTotalEnergyAverageUsage();
    long targetTotalEnergyLimit = dynamicPropertiesStore.getTotalEnergyTargetLimit();
    long totalEnergyCurrentLimit = dynamicPropertiesStore.getTotalEnergyCurrentLimit();
    long totalEnergyLimit = dynamicPropertiesStore.getTotalEnergyLimit();

    long result;
    if (totalEnergyAverageUsage > targetTotalEnergyLimit) {
        // Contract: usage exceeds target
        result = totalEnergyCurrentLimit * AdaptiveResourceLimitConstants.CONTRACT_RATE_NUMERATOR
            / AdaptiveResourceLimitConstants.CONTRACT_RATE_DENOMINATOR;
    } else {
        // Expand: usage below target
        result = totalEnergyCurrentLimit * AdaptiveResourceLimitConstants.EXPAND_RATE_NUMERATOR
            / AdaptiveResourceLimitConstants.EXPAND_RATE_DENOMINATOR;
    }

    // Apply bounds
    result = min(max(result, totalEnergyLimit, this.disableJavaLangMath()),
        totalEnergyLimit * dynamicPropertiesStore.getAdaptiveResourceLimitMultiplier(),
        this.disableJavaLangMath());

    dynamicPropertiesStore.saveTotalEnergyCurrentLimit(result);
}
```

**Constants**:

```java
public class AdaptiveResourceLimitConstants {
    public static final int CONTRACT_RATE_NUMERATOR = 99;
    public static final int CONTRACT_RATE_DENOMINATOR = 100;
    // Contract rate = 99/100 = 0.99 (1% reduction)

    public static final int EXPAND_RATE_NUMERATOR = 1000;
    public static final int EXPAND_RATE_DENOMINATOR = 999;
    // Expand rate = 1000/999 ≈ 1.001 (0.1% increase)
}
```

### 2.5.2 Adaptive Formula

$$
\text{new\_limit} = \begin{cases}
\text{current\_limit} \times 0.99 & \text{if } \text{avg\_usage} > \text{target} \\
\text{current\_limit} \times 1.001 & \text{if } \text{avg\_usage} \leq \text{target}
\end{cases}
$$

**With Bounds**:

$$
\text{final\_limit} = \min\left(\max(\text{new\_limit}, \text{base\_limit}), \text{base\_limit} \times \text{multiplier}\right)
$$

**Where**:
- $\text{base\_limit} = 180,000,000,000$ energy (default)
- $\text{multiplier} = 10$ (default, allows up to 10× expansion)
- $\text{target} = 90,000,000,000$ energy (50% of base, default)

### 2.5.3 Average Usage Calculation

**Source**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java` (Lines 50-62)

```java
public void updateTotalEnergyAverageUsage() {
    long now = getHeadSlot();
    long blockEnergyUsage = dynamicPropertiesStore.getBlockEnergyUsage();
    long totalEnergyAverageUsage = dynamicPropertiesStore.getTotalEnergyAverageUsage();
    long totalEnergyAverageTime = dynamicPropertiesStore.getTotalEnergyAverageTime();

    long newPublicEnergyAverageUsage = increase(totalEnergyAverageUsage, blockEnergyUsage,
        totalEnergyAverageTime, now, averageWindowSize);

    dynamicPropertiesStore.saveTotalEnergyAverageUsage(newPublicEnergyAverageUsage);
    dynamicPropertiesStore.saveTotalEnergyAverageTime(now);
}
```

**Formula**:

$$
\text{avg\_usage}(t) = \frac{\sum_{i=0}^{20} \text{block\_energy}(t-i)}{21}
$$

Uses a 21-block rolling average (63 seconds = 21 blocks × 3 seconds).

### 2.5.4 Adaptive Behavior Analysis

**Scenario 1: High Network Usage**

```
Initial: current_limit = 180B, target = 90B
Block average usage = 100B (exceeds target)

Iteration 1: new_limit = 180B × 0.99 = 178.2B
Iteration 2: new_limit = 178.2B × 0.99 = 176.42B
Iteration 3: new_limit = 176.42B × 0.99 = 174.65B
...
After 100 iterations: ~66.12B (36.7% of original)
```

**Scenario 2: Low Network Usage**

```
Initial: current_limit = 180B, target = 90B
Block average usage = 50B (below target)

Iteration 1: new_limit = 180B × 1.001 = 180.18B
Iteration 2: new_limit = 180.18B × 1.001 = 180.36B
Iteration 3: new_limit = 180.36B × 1.001 = 180.54B
...
After 1000 iterations: ~488.67B (271.5% of original)
Max allowed: 180B × 10 = 1800B
```

**Convergence Analysis**:

Contraction (usage > target):
$$
L_n = L_0 \times (0.99)^n
$$

Expansion (usage < target):
$$
L_n = L_0 \times (1.001)^n
$$

**Stability**: The system is stable if:
1. Contraction rate (1% per cycle) > Expansion rate (0.1% per cycle)
2. Bounds prevent runaway expansion

### 2.5.5 Economic Implications

**For Users**:
- High usage periods → Lower per-user limits → Higher TRX burning (if resources exhausted)
- Low usage periods → Higher per-user limits → Lower costs

**For Network**:
- Automatic load balancing
- Prevents congestion during peaks
- Incentivizes resource freezing during high-usage periods

## 2.6 Weight-Based Allocation Model

### 2.6.1 Global Weight Tracking

**Source**: `chainbase/src/main/java/org/tron/core/store/DynamicPropertiesStore.java`

```java
// Bandwidth weights
public long getTotalNetWeight();
public void addTotalNetWeight(long weight);
public void addTotalNetWeight(long weight);

// Energy weights
public long getTotalEnergyWeight();
public void addTotalEnergyWeight(long weight);

// TRON Power weights
public long getTotalTronPowerWeight();
public void addTotalTronPowerWeight(long weight);
```

**Weight Update Formula**:

When user freezes $F$ TRX:
$$
\text{new\_weight} = \text{old\_weight} + \left\lfloor \frac{F}{10^6} \right\rfloor
$$

When user unfreezes $U$ TRX:
$$
\text{new\_weight} = \text{old\_weight} - \left\lfloor \frac{U}{10^6} \right\rfloor
$$

### 2.6.2 Resource Limit Dynamics

Given user's frozen amount $F_u$ and total network weight $W$:

$$
\text{user\_limit}(F_u, W) = \left\lfloor \frac{F_u / 10^6}{W} \times L \right\rfloor
$$

Where $L$ is total network resource limit.

**Partial Derivatives**:

1. **Effect of increasing user freeze**:
   $$\frac{\partial \text{user\_limit}}{\partial F_u} = \frac{L}{10^6 \times W} > 0$$

   Increasing freeze increases user limit (positive).

2. **Effect of network weight increase**:
   $$\frac{\partial \text{user\_limit}}{\partial W} = -\frac{F_u \times L}{10^6 \times W^2} < 0$$

   More network freezing decreases individual limits (negative).

**Example: Network Growth Impact**

User freezes 100,000 TRX when network weight is 10B TRX:

$$
\text{initial\_limit} = \frac{100,000}{10,000,000,000} \times 180,000,000,000 = 1,800,000 \text{ energy}
$$

Network grows to 20B TRX frozen:

$$
\text{new\_limit} = \frac{100,000}{20,000,000,000} \times 180,000,000,000 = 900,000 \text{ energy}
$$

**50% reduction in user limit** despite no change in user's frozen amount!

## 2.7 Delegation Resource Calculation

### 2.7.1 Proportional Consumption Model

When user A delegates resources to user B, and B consumes them, the usage must be tracked proportionally.

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 141-203)

**Scenario**:
- Owner has own frozen: $F_o$
- Owner delegated to receiver: $F_d$
- Receiver uses: $U_r$ resources

**Owner's Reclaimed Usage**:

$$
\text{owner\_usage} = \frac{U_r \times F_d}{F_o + F_d}
$$

**Proof**:

Total available to receiver = $F_o + F_d$

Proportion from delegation = $\frac{F_d}{F_o + F_d}$

Usage from delegation = $U_r \times \frac{F_d}{F_o + F_d}$

When undelegating, this usage returns to owner.

**Example**:

```
Owner frozen: 50,000 TRX (own) + 50,000 TRX (delegated) = 100,000 TRX total
Receiver uses: 10,000 energy

owner_usage = (10,000 × 50,000) / 100,000 = 5,000 energy

When owner undelegates:
- Receiver loses 50,000 worth of limits
- Owner gains back resources but inherits 5,000 usage (50% of consumption)
```

### 2.7.2 Window Size Combination

**Source**: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java` (Lines 193-198)

When undelegating, owner must combine window sizes:

```java
long newOwnerWindowSize = divideCeil(
    ownerUsage * remainOwnerWindowSizeV2 + transferUsage * remainReceiverWindowSizeV2,
    newOwnerUsage
);
```

**Formula**:

$$
\text{new\_window\_size} = \left\lceil \frac{\text{owner\_usage} \times \text{owner\_window} + \text{transfer\_usage} \times \text{receiver\_window}}{\text{owner\_usage} + \text{transfer\_usage}} \right\rceil
$$

**Interpretation**: Weighted average of recovery windows.

**Example**:

```
Owner usage: 1,000 energy, window: 28,800 blocks (full 24h)
Receiver usage: 500 energy, window: 14,400 blocks (50% recovered)

new_window = ceil((1,000 × 28,800 + 500 × 14,400) / 1,500)
          = ceil((28,800,000 + 7,200,000) / 1,500)
          = ceil(24,000)
          = 24,000 blocks

Result: Owner's new recovery window is 24,000 blocks (~20 hours)
```

## 2.8 Transaction Fee Calculation

### 2.8.1 Bandwidth Fee

**Source**: `chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java`

When insufficient bandwidth, fallback to fee:

$$
\text{fee} = \text{bytes} \times \text{transaction\_fee\_rate}
$$

**Default**: 10 sun/byte

**Example**:

```
Transaction size: 270 bytes
Fee = 270 × 10 = 2,700 sun = 0.0027 TRX
```

### 2.8.2 Energy Fee

**Source**: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java`

When insufficient energy:

$$
\text{fee} = \text{energy} \times \text{energy\_fee\_rate}
$$

**Default**: 420 sun/energy (dynamic, can change)

**Example**:

```
Contract execution: 14,000 energy
Fee = 14,000 × 420 = 5,880,000 sun = 5.88 TRX
```

### 2.8.3 Dynamic Energy Factor

For high-traffic contracts, energy costs can increase:

$$
\text{adjusted\_energy} = \text{base\_energy} \times \left(1 + \frac{\text{factor}}{10000}\right)
$$

**Where**:
- $\text{factor} \in [0, 34000]$ (0× to 3.4× increase)
- Factor based on contract usage statistics

**Example**:

```
Base energy: 14,000
Factor: 10000 (1.0× increase)

adjusted_energy = 14,000 × (1 + 10000/10000)
                = 14,000 × 2
                = 28,000 energy
```

## 2.9 Computational Complexity Analysis

### 2.9.1 Resource Calculation Complexity

**Bandwidth Limit Calculation**:
```
Time: O(1) - constant time operations
Space: O(1) - no additional memory
```

**Energy Limit Calculation**:
```
Time: O(1) - constant time operations
Space: O(1) - no additional memory
```

**Resource Recovery**:
```
Time: O(1) - fixed number of operations
Space: O(1) - in-place update
```

### 2.9.2 Precision Analysis

**Integer Overflow Protection**:

Maximum frozen balance: $2^{63} - 1$ sun ≈ $9.22 \times 10^{18}$ sun

Maximum resource limit: $2^{63} - 1$ units

Multiplication $\text{weight} \times \text{limit}$:
- Max weight: $\approx 9.22 \times 10^{12}$ TRX
- Max limit: $\approx 9.22 \times 10^{18}$
- Product: $\approx 8.49 \times 10^{31}$ (exceeds 64-bit!)

**Mitigation**: Division performed immediately after multiplication:

```java
return (netWeight * totalNetLimit) / totalNetWeight;
```

Order of operations ensures intermediate result stays within bounds when `totalNetWeight > 0`.

**Proof**:

$$
\frac{\text{weight} \times \text{limit}}{\text{total\_weight}} \leq \text{limit}
$$

Since $\text{weight} \leq \text{total\_weight}$, the result is always ≤ limit.

### 2.9.3 Rounding Error Analysis

**Ceiling Division Error**:

$$
\text{divideCeil}(a, b) - \frac{a}{b} < 1
$$

Maximum error: less than 1 unit per operation.

For 1000 operations: maximum cumulative error ≈ 1000 units.

**Significance**: For energy (millions of units), error is negligible (< 0.1%).

## 2.10 Summary of Key Formulas

### Resource Allocation

$$
\text{resource\_limit} = \left\lfloor \frac{\text{frozen\_balance} / 10^6}{\text{total\_weight}} \times \text{total\_limit} \right\rfloor
$$

### Linear Recovery

$$
\text{new\_usage} = \left\lfloor \text{last\_usage} \times \left(1 - \frac{\Delta t}{\text{window\_size}}\right) \right\rfloor + \text{current\_usage}
$$

### Adaptive Energy Scaling

$$
\text{new\_limit} = \begin{cases}
\text{current} \times 0.99 & \text{if usage > target} \\
\text{current} \times 1.001 & \text{if usage ≤ target}
\end{cases}
$$

### Delegation Proportional Usage

$$
\text{owner\_reclaimed\_usage} = \frac{\text{receiver\_usage} \times \text{delegated\_amount}}{\text{total\_receiver\_resources}}
$$

### Fee Calculation

$$
\begin{align*}
\text{bandwidth\_fee} &= \text{bytes} \times 10 \text{ sun} \\
\text{energy\_fee} &= \text{energy} \times 420 \text{ sun}
\end{align*}
$$

## Next Chapter

Chapter 3 will explore the freeze/unfreeze mechanics in depth, covering the complete state machine, transaction structures, and implementation details of all resource operation contracts.

---

**References**:
- java-tron source: `chainbase/src/main/java/org/tron/core/db/ResourceProcessor.java`
- java-tron source: `chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java`
- java-tron source: `chainbase/src/main/java/org/tron/core/db/EnergyProcessor.java`
- java-tron source: `common/src/main/java/org/tron/core/config/Parameter.java`
- Numerical Analysis: "Introduction to Numerical Analysis" by J. Stoer and R. Bulirsch
