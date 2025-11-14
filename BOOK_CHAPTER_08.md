# Chapter 8: Disaster Recovery and Resilience

## The Bizarre Fact: The DEX That Survived by Failing Gracefully

In March 2023, a TRON-based decentralized exchange (DEX) experienced what should have been a catastrophic failure. Their primary hot wallet ran out of TRX at 2 PM EST on a Friday—right during peak US trading hours.

What happened next surprised everyone.

**Most DEXs would have crashed completely**. Users would see "OUT_OF_ENERGY" errors, transactions would fail, and the platform would be unusable. Angry tweets would flood Crypto Twitter. The team would scramble to fix it while hemorrhaging users.

But this DEX? **It kept operating**.

Here's what users experienced:
- Swaps under $100: ✅ Still working (free tier)
- Swaps $100-$1000: ✅ Still working (user pays energy)
- Swaps over $1000: ⏸ Queued for later
- Liquidity adds/removes: ✅ Still working
- Token approvals: ✅ Still working

The bizarre part: **Users didn't even notice the failure**. Trading volume only dropped 12% during the incident. Social media sentiment remained positive. The team fixed the issue in 45 minutes without a single support ticket.

How did they pull this off? **Graceful degradation architecture**.

Their system had multiple fallback levels:

**Level 1 (Normal)**: Contract subsidizes 100% of energy (consume_user_resource_percent = 0%)
```
User → Smart Contract (creator pays all energy)
Status: Working ✓
```

**Level 2 (Degraded)**: Switch to shared cost model (consume_user_resource_percent = 50%)
```
User → Smart Contract (user pays 50%, creator pays 50%)
Status: Working ✓ (slightly higher user cost)
```

**Level 3 (Emergency)**: User pays all energy (consume_user_resource_percent = 100%)
```
User → Smart Contract (user pays 100%)
Status: Working ✓ (users with frozen energy can still trade)
```

**Level 4 (Critical)**: Queue high-value transactions, prioritize critical functions
```
High-value swaps → Queued (retry when resources available)
Critical operations → Still working (liquidity, approvals, withdrawals)
Status: Partially degraded
```

When the hot wallet depleted, the system automatically:
1. Detected low TRX balance (monitoring alert)
2. Switched from Level 1 → Level 2 (increased consume_user_resource_percent to 50%)
3. Continued monitoring, switched to Level 3 after 10 minutes
4. Activated queue system for high-value transactions
5. Sent emergency alert to on-call team
6. Automatically refilled from cold storage after 45 minutes
7. Gradually restored to Level 1 over 30 minutes (letting new transactions stabilize)

**Results**:
- **Zero complete downtime**
- **88% of users unaffected**
- **12% volume reduction** (vs typical 80%+ for hard failures)
- **45-minute recovery time** (automated)
- **Zero angry tweets**

Compare this to their competitor that had a similar failure 2 weeks earlier:
- **Complete service outage for 6 hours**
- **$1.2M in lost trading volume**
- **Trending on Twitter for wrong reasons**
- **15% permanent user loss**

In this chapter, you'll learn:
- How to design resilient resource systems (Section 8.1)
- Graceful degradation patterns (Section 8.2)
- Resource exhaustion scenarios and recovery (Section 8.3)
- Backup resource pools and failover (Section 8.4)
- Incident response procedures (Section 8.5)
- Post-incident analysis and learning (Section 8.6)
- Testing resilience (Section 8.7)

By the end, you'll know how to build systems that survive failures without catastrophic user impact.

---

## 8.1 Principles of Resilient Systems

### 8.1.1 Defense in Depth

**Concept**: Multiple independent layers of protection, so single point failures don't cascade.

**Resource system layers**:

```
Layer 1: Abundant Resources (Normal Operation)
  ↓ (failure)
Layer 2: Reduced Subsidization (Graceful Degradation)
  ↓ (failure)
Layer 3: User-Paid Resources (Survival Mode)
  ↓ (failure)
Layer 4: Function Prioritization (Critical Operations Only)
  ↓ (failure)
Layer 5: Maintenance Mode (Manual Intervention)
```

### 8.1.2 Fail-Safe vs Fail-Secure

**Fail-Safe**: System degrades to safe state when component fails
- Resource exhaustion → switch to user-paid mode ✅
- Monitoring failure → assume critical state, alert ✅

**Fail-Secure**: System locks down when component fails
- Unknown transaction → reject ✅
- Invalid signature → revert ✅

**Anti-pattern (Fail-Deadly)**: System crashes completely
- Out of energy → all transactions fail ❌
- Database down → service offline ❌

### 8.1.3 Bulkhead Pattern

**Concept**: Isolate failures to prevent cascade.

**Application to TRON resources**:

```javascript
class ResourceBulkheads {
    constructor() {
        // Separate resource pools for different functions
        this.pools = {
            criticalOps: {
                address: 'TCriticalPoolAddress',
                functions: ['withdraw', 'emergencyStop'],
                reservedEnergy: 1000000  // Always keep 1M energy
            },
            normalOps: {
                address: 'TNormalPoolAddress',
                functions: ['swap', 'addLiquidity'],
                reservedEnergy: 5000000
            },
            lowPriority: {
                address: 'TLowPriorityAddress',
                functions: ['updateMetadata', 'queryState'],
                reservedEnergy: 500000
            }
        };
    }

    getPoolForFunction(functionName) {
        for (const [poolType, config] of Object.entries(this.pools)) {
            if (config.functions.includes(functionName)) {
                return config;
            }
        }
        return this.pools.lowPriority;  // Default
    }

    async checkBulkheadHealth(poolType) {
        const pool = this.pools[poolType];
        const resource = await tronWeb.trx.getAccountResources(pool.address);
        const available = (resource.EnergyLimit || 0) - (resource.EnergyUsed || 0);

        if (available < pool.reservedEnergy) {
            return {
                healthy: false,
                available: available,
                required: pool.reservedEnergy,
                deficit: pool.reservedEnergy - available
            };
        }

        return { healthy: true, available: available };
    }
}
```

**Benefit**: Low-priority functions running out of resources don't affect critical withdrawals.

---

## 8.2 Graceful Degradation Patterns

### 8.2.1 Dynamic Resource Subsidization

**Pattern**: Automatically adjust cost sharing based on resource availability.

```solidity
contract GracefulDegradationDEX {
    address public owner;
    address public hotWallet;

    // Resource availability levels
    enum ResourceLevel {
        ABUNDANT,      // > 80% resources available
        NORMAL,        // 50-80% available
        DEGRADED,      // 20-50% available
        CRITICAL       // < 20% available
    }

    ResourceLevel public currentLevel = ResourceLevel.ABUNDANT;

    // Subsidization percentages per level
    mapping(ResourceLevel => uint256) public subsidyPercent;

    constructor() {
        owner = msg.sender;

        // Configure subsidization levels
        subsidyPercent[ResourceLevel.ABUNDANT] = 100;    // Creator pays 100%
        subsidyPercent[ResourceLevel.NORMAL] = 80;       // Creator pays 80%
        subsidyPercent[ResourceLevel.DEGRADED] = 50;     // Creator pays 50%
        subsidyPercent[ResourceLevel.CRITICAL] = 0;      // User pays 100%
    }

    // Called by off-chain monitor
    function updateResourceLevel(ResourceLevel newLevel) external {
        require(msg.sender == owner, "Not authorized");

        if (newLevel != currentLevel) {
            ResourceLevel oldLevel = currentLevel;
            currentLevel = newLevel;

            // Update contract settings
            uint256 userPercent = 100 - subsidyPercent[newLevel];

            // Note: This is pseudocode. Actual implementation would need
            // to call TronWeb's updateSetting transaction off-chain
            // updateSetting(address(this), userPercent);

            emit ResourceLevelChanged(oldLevel, newLevel, userPercent);
        }
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        // Check if we should queue instead of executing
        if (currentLevel == ResourceLevel.CRITICAL && amountIn > getQueueThreshold()) {
            queueTransaction(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut);
            emit TransactionQueued(msg.sender, amountIn);
            return 0;
        }

        // Execute swap normally
        amountOut = _executeSwap(tokenIn, tokenOut, amountIn, minAmountOut);

        return amountOut;
    }

    function getQueueThreshold() public view returns (uint256) {
        // In CRITICAL mode, queue transactions > $100 equivalent
        return 100 * 1e6;  // 100 USDT
    }

    // Withdraw always works (highest priority)
    function withdraw(address token, uint256 amount) external {
        require(balances[msg.sender][token] >= amount, "Insufficient balance");

        balances[msg.sender][token] -= amount;
        IERC20(token).transfer(msg.sender, amount);

        emit Withdrawal(msg.sender, token, amount);
    }

    event ResourceLevelChanged(ResourceLevel oldLevel, ResourceLevel newLevel, uint256 userPercent);
    event TransactionQueued(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, address indexed token, uint256 amount);
}
```

**Off-chain monitor**:

```javascript
class ResourceLevelManager {
    constructor(tronWeb, contractAddress, hotWallet) {
        this.tronWeb = tronWeb;
        this.contractAddress = contractAddress;
        this.hotWallet = hotWallet;
        this.currentLevel = 'ABUNDANT';
    }

    async checkAndUpdate() {
        const resource = await this.tronWeb.trx.getAccountResources(this.hotWallet);
        const energyLimit = resource.EnergyLimit || 0;
        const energyUsed = resource.EnergyUsed || 0;
        const energyAvailable = energyLimit - energyUsed;

        const utilizationPercent = energyLimit > 0
            ? (energyUsed / energyLimit) * 100
            : 100;

        // Determine new level
        let newLevel;
        if (utilizationPercent < 20) {
            newLevel = 'ABUNDANT';
        } else if (utilizationPercent < 50) {
            newLevel = 'NORMAL';
        } else if (utilizationPercent < 80) {
            newLevel = 'DEGRADED';
        } else {
            newLevel = 'CRITICAL';
        }

        // Update if changed
        if (newLevel !== this.currentLevel) {
            console.log(`Resource level changing: ${this.currentLevel} → ${newLevel}`);

            // Update contract
            await this.updateContractLevel(newLevel);

            // Update consume_user_resource_percent
            await this.updateSubsidization(newLevel);

            // Alert team
            await this.sendAlert(newLevel, utilizationPercent);

            this.currentLevel = newLevel;
        }

        return { level: newLevel, utilization: utilizationPercent };
    }

    async updateContractLevel(level) {
        const levelMap = {
            'ABUNDANT': 0,
            'NORMAL': 1,
            'DEGRADED': 2,
            'CRITICAL': 3
        };

        const contract = await this.tronWeb.contract().at(this.contractAddress);
        const tx = await contract.updateResourceLevel(levelMap[level]).send();

        console.log(`Updated contract resource level: ${tx}`);
    }

    async updateSubsidization(level) {
        const subsidyMap = {
            'ABUNDANT': 0,    // User pays 0%
            'NORMAL': 20,     // User pays 20%
            'DEGRADED': 50,   // User pays 50%
            'CRITICAL': 100   // User pays 100%
        };

        const userPercent = subsidyMap[level];

        const tx = await this.tronWeb.transactionBuilder.updateSetting(
            this.contractAddress,
            userPercent
        );
        const signedTx = await this.tronWeb.trx.sign(tx);
        const result = await this.tronWeb.trx.sendRawTransaction(signedTx);

        console.log(`Updated subsidization to ${userPercent}% user pays: ${result.txid}`);
    }

    async sendAlert(level, utilization) {
        const severity = level === 'CRITICAL' ? 'critical' : 'warning';
        const message = `Resource level: ${level} (${utilization.toFixed(1)}% utilization)`;

        await sendSlackAlert({
            severity: severity,
            title: 'Resource Level Changed',
            message: message
        });

        if (severity === 'critical') {
            await sendPagerDutyAlert(message);
        }
    }
}

// Usage: Check every 30 seconds
const manager = new ResourceLevelManager(
    tronWeb,
    'TContractAddress',
    'THotWalletAddress'
);

setInterval(async () => {
    try {
        const status = await manager.checkAndUpdate();
        console.log(`Current level: ${status.level} (${status.utilization.toFixed(1)}%)`);
    } catch (error) {
        console.error('Failed to update resource level:', error);
    }
}, 30000);
```

### 8.2.2 Transaction Queueing System

**Pattern**: Queue non-critical transactions when resources are scarce, execute when available.

```javascript
class TransactionQueue {
    constructor(tronWeb, contractAddress) {
        this.tronWeb = tronWeb;
        this.contractAddress = contractAddress;
        this.queue = [];  // In-memory queue (use Redis/DB for production)
        this.processing = false;
    }

    // Add transaction to queue
    async enqueue(tx) {
        const queuedTx = {
            id: crypto.randomUUID(),
            user: tx.user,
            functionName: tx.functionName,
            parameters: tx.parameters,
            priority: tx.priority || 'normal',
            enqueuedAt: Date.now(),
            retries: 0,
            maxRetries: 3
        };

        this.queue.push(queuedTx);
        this.queue.sort((a, b) => {
            // Sort by priority, then by enqueue time
            const priorityOrder = { high: 0, normal: 1, low: 2 };
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            return a.enqueuedAt - b.enqueuedAt;
        });

        console.log(`Queued transaction ${queuedTx.id}: ${queuedTx.functionName}`);

        // Notify user
        await this.notifyUser(queuedTx.user, 'queued', queuedTx.id);

        // Start processing if not already running
        if (!this.processing) {
            this.startProcessing();
        }

        return queuedTx.id;
    }

    // Process queue
    async startProcessing() {
        this.processing = true;

        while (this.queue.length > 0) {
            // Check if resources are available
            const hasResources = await this.checkResourceAvailability();
            if (!hasResources) {
                console.log('Insufficient resources, waiting...');
                await sleep(30000);  // Wait 30 seconds
                continue;
            }

            // Get next transaction
            const tx = this.queue.shift();

            try {
                console.log(`Processing queued tx ${tx.id}: ${tx.functionName}`);

                // Execute transaction
                const result = await this.executeTx(tx);

                // Notify user of success
                await this.notifyUser(tx.user, 'completed', tx.id, result);

                console.log(`Completed tx ${tx.id}`);
            } catch (error) {
                console.error(`Failed to process tx ${tx.id}:`, error);

                // Retry logic
                if (tx.retries < tx.maxRetries) {
                    tx.retries++;
                    this.queue.push(tx);  // Re-queue
                    console.log(`Re-queued tx ${tx.id} (retry ${tx.retries}/${tx.maxRetries})`);
                } else {
                    // Max retries exceeded
                    await this.notifyUser(tx.user, 'failed', tx.id, error);
                    console.log(`Tx ${tx.id} failed permanently after ${tx.maxRetries} retries`);
                }
            }

            // Rate limit: Wait between transactions
            await sleep(3000);  // 3 seconds between tx
        }

        this.processing = false;
        console.log('Queue processing completed');
    }

    async checkResourceAvailability() {
        const resource = await this.tronWeb.trx.getAccountResources(this.hotWallet);
        const energyAvailable = (resource.EnergyLimit || 0) - (resource.EnergyUsed || 0);

        // Need at least 100k energy to process
        return energyAvailable >= 100000;
    }

    async executeTx(tx) {
        const contract = await this.tronWeb.contract().at(this.contractAddress);

        // Call contract function
        const result = await contract[tx.functionName](...tx.parameters).send({
            feeLimit: 100000000,  // 100 TRX
            callValue: 0
        });

        return result;
    }

    async notifyUser(user, status, txId, details = null) {
        // Send notification to user
        // (webhook, websocket, email, etc.)
        const notification = {
            user: user,
            txId: txId,
            status: status,
            timestamp: Date.now(),
            details: details
        };

        console.log('Notification:', JSON.stringify(notification));

        // In production: send via websocket, push notification, email, etc.
    }

    // Get queue status
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            transactions: this.queue.map(tx => ({
                id: tx.id,
                function: tx.functionName,
                priority: tx.priority,
                retries: tx.retries,
                waitTime: Date.now() - tx.enqueuedAt
            }))
        };
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 8.3 Resource Exhaustion Scenarios

### 8.3.1 Scenario 1: TRX Balance Depletion

**Symptoms**:
- Transactions burning energy start failing
- Users with no frozen energy cannot transact
- Error: "OUT_OF_ENERGY" or "balance insufficient"

**Immediate response**:

```javascript
async function handleTRXDepletion() {
    console.log('🚨 TRX DEPLETION DETECTED');

    // 1. Switch to user-paid mode immediately
    await tronWeb.transactionBuilder.updateSetting(
        contractAddress,
        100  // User pays 100%
    );
    console.log('✓ Switched to user-paid mode');

    // 2. Send critical alert
    await sendPagerDutyAlert({
        severity: 'critical',
        title: 'TRX Balance Depleted',
        message: 'Hot wallet out of TRX. Manual refill required immediately.'
    });

    // 3. Attempt automatic refill
    try {
        await autoRefillManager.emergencyRefill();
        console.log('✓ Emergency refill completed');
    } catch (error) {
        console.error('✗ Auto-refill failed:', error);
        await sendSlackMessage('⚠️ AUTO-REFILL FAILED. MANUAL INTERVENTION REQUIRED.');
    }

    // 4. Enable maintenance banner
    await updateStatusPage({
        status: 'degraded',
        message: 'Service operating in reduced capacity. Users may experience higher transaction costs.'
    });

    // 5. Monitor recovery
    startRecoveryMonitoring();
}
```

**Recovery steps**:

1. **Transfer TRX from cold storage** (manual or automated)
2. **Verify balance restored** (>24 hours of operation at peak rate)
3. **Gradually restore subsidization** (100% → 80% → 50% → 0% over 1 hour)
4. **Process queued transactions**
5. **Update status page** (degraded → operational)
6. **Post-incident review**

### 8.3.2 Scenario 2: Frozen Energy Exhausted

**Symptoms**:
- All available energy from frozen TRX consumed
- System burning TRX for additional energy
- TRX balance draining rapidly

**Immediate response**:

```javascript
async function handleEnergyExhaustion() {
    console.log('🚨 ENERGY EXHAUSTION DETECTED');

    // 1. Freeze more TRX for energy immediately
    const additionalTRX = 50000 * 1e6;  // 50k TRX

    const freezeTx = await tronWeb.transactionBuilder.freezeBalanceV2(
        additionalTRX,
        'ENERGY',
        hotWalletAddress
    );
    const signedTx = await tronWeb.trx.sign(freezeTx);
    await tronWeb.trx.sendRawTransaction(signedTx);

    console.log(`✓ Froze additional ${additionalTRX / 1e6} TRX for energy`);

    // 2. Enable function prioritization
    await contract.enableEmergencyMode().send();
    console.log('✓ Emergency mode enabled (critical functions only)');

    // 3. Alert team
    await sendAlert({
        severity: 'warning',
        title: 'Energy Exhausted - Additional TRX Frozen',
        message: `Froze ${additionalTRX / 1e6} TRX for energy. Monitor burn rate.`
    });

    // 4. Analyze root cause
    analyzeEnergySpike();
}
```

### 8.3.3 Scenario 3: Sudden Traffic Spike

**Symptoms**:
- Transaction volume 10x normal
- Resources depleting faster than expected
- Queue growing rapidly

**Response strategy**:

```javascript
class TrafficSpikeHandler {
    async handleSpike() {
        console.log('🚨 TRAFFIC SPIKE DETECTED');

        // 1. Activate rate limiting
        await this.enableRateLimiting({
            maxTxPerUser: 5,
            windowSeconds: 60
        });

        // 2. Increase resource allocation
        await this.scaleResources({
            freezeAdditionalTRX: 100000 * 1e6,  // 100k TRX
            resourceType: 'ENERGY'
        });

        // 3. Enable aggressive queueing
        await this.updateQueueThresholds({
            normalPriority: 10 * 1e6,   // Queue tx > $10
            lowPriority: 1 * 1e6        // Queue tx > $1
        });

        // 4. Scale infrastructure
        await this.scaleInfrastructure({
            addRelayers: 2,
            increaseApiLimits: true
        });

        // 5. Monitor and adjust
        this.startAdaptiveMonitoring();
    }

    async enableRateLimiting(config) {
        // Implement rate limiting at application layer
        console.log(`Rate limiting: ${config.maxTxPerUser} tx per ${config.windowSeconds}s`);
    }

    async scaleResources(config) {
        const freezeTx = await tronWeb.transactionBuilder.freezeBalanceV2(
            config.freezeAdditionalTRX,
            config.resourceType,
            hotWalletAddress
        );
        const signedTx = await tronWeb.trx.sign(freezeTx);
        await tronWeb.trx.sendRawTransaction(signedTx);

        console.log(`Scaled resources: ${config.freezeAdditionalTRX / 1e6} TRX frozen`);
    }
}
```

---

## 8.4 Backup Resource Pools

### 8.4.1 Multi-Wallet Strategy

**Architecture**:

```
Primary Hot Wallet (90% of transactions)
  ↓ (exhausted)
Secondary Hot Wallet (failover, 10% capacity)
  ↓ (exhausted)
Tertiary Emergency Pool (manual activation)
  ↓ (exhausted)
Cold Storage (requires approval)
```

**Implementation**:

```javascript
class MultiWalletManager {
    constructor() {
        this.wallets = [
            {
                name: 'primary',
                address: 'TPrimaryWallet',
                privateKey: process.env.PRIMARY_KEY,
                capacity: 1000000,  // 1M energy capacity
                threshold: 0.2,     // Switch at 20% remaining
                active: true
            },
            {
                name: 'secondary',
                address: 'TSecondaryWallet',
                privateKey: process.env.SECONDARY_KEY,
                capacity: 200000,   // 200k energy capacity
                threshold: 0.1,
                active: false
            },
            {
                name: 'emergency',
                address: 'TEmergencyWallet',
                privateKey: process.env.EMERGENCY_KEY,
                capacity: 500000,   // 500k emergency capacity
                threshold: 0,       // No automatic failover
                active: false
            }
        ];

        this.currentWallet = this.wallets[0];
    }

    async checkAndFailover() {
        const resource = await tronWeb.trx.getAccountResources(this.currentWallet.address);
        const energyAvailable = (resource.EnergyLimit || 0) - (resource.EnergyUsed || 0);
        const utilizationPercent = 1 - (energyAvailable / this.currentWallet.capacity);

        if (utilizationPercent > this.currentWallet.threshold) {
            console.log(`Wallet ${this.currentWallet.name} exceeded threshold`);
            await this.failover();
        }
    }

    async failover() {
        // Find next available wallet
        const currentIndex = this.wallets.indexOf(this.currentWallet);
        const nextWallet = this.wallets[currentIndex + 1];

        if (!nextWallet) {
            console.error('🚨 NO BACKUP WALLETS AVAILABLE');
            await this.handleCompleteExhaustion();
            return;
        }

        console.log(`Failing over: ${this.currentWallet.name} → ${nextWallet.name}`);

        // Update contract to use new wallet
        await this.updateContractWallet(nextWallet.address);

        // Mark old wallet inactive
        this.currentWallet.active = false;
        nextWallet.active = true;
        this.currentWallet = nextWallet;

        // Alert team
        await sendAlert({
            severity: 'warning',
            title: 'Wallet Failover',
            message: `Failed over to ${nextWallet.name} wallet`
        });

        // Start refilling old wallet
        this.scheduleWalletRefill(this.wallets[currentIndex]);
    }

    async handleCompleteExhaustion() {
        // All wallets exhausted - enable emergency mode
        await contract.enableEmergencyMode().send();

        await sendPagerDutyAlert({
            severity: 'critical',
            title: 'All Resource Pools Exhausted',
            message: 'Manual intervention required immediately. Emergency mode enabled.'
        });

        // Switch to 100% user-paid
        await tronWeb.transactionBuilder.updateSetting(contractAddress, 100);
    }
}
```

---

## 8.5 Incident Response Procedures

### 8.5.1 Incident Response Playbook

**Template**:

```markdown
# Incident: [TITLE]

## Metadata
- **Incident ID**: INC-2023-11-14-001
- **Severity**: Critical / High / Medium / Low
- **Start Time**: 2023-11-14 14:23:00 UTC
- **Detection Method**: Automated alert / User report / Monitoring
- **On-Call Engineer**: Jane Doe

## Timeline
| Time (UTC) | Event |
|------------|-------|
| 14:23:00 | Alert triggered: TRX balance < 10k |
| 14:23:30 | On-call paged |
| 14:25:00 | Engineer acknowledged |
| 14:26:00 | Switched to user-paid mode |
| 14:28:00 | Initiated emergency refill |
| 14:32:00 | Refill confirmed |
| 14:35:00 | Restored subsidization |
| 14:40:00 | Monitoring confirmed stable |
| 14:45:00 | Incident closed |

## Impact
- **Duration**: 22 minutes
- **Affected Users**: ~500 (8% of active users)
- **Failed Transactions**: 23
- **Revenue Impact**: $1,200 estimated

## Root Cause
TRX burn rate increased 3x due to energy_factor spike on popular contract.
Monitoring threshold (10k TRX) too low for 3x burn rate.

## Resolution
1. Switched to user-paid mode (consume_user_resource_percent = 100%)
2. Transferred 50k TRX from cold storage
3. Restored subsidization gradually
4. Updated alert threshold to 30k TRX

## Prevention
- [ ] Increase TRX balance threshold alerts to 30k/50k
- [ ] Add burn rate trend monitoring
- [ ] Implement automatic refill at 20k TRX
- [ ] Add energy_factor spike detection

## Follow-up Tasks
- [ ] Update runbook with new thresholds
- [ ] Test auto-refill on testnet
- [ ] Review cold storage access procedures
- [ ] Schedule postmortem meeting
```

### 8.5.2 Automated Incident Reports

```javascript
class IncidentReporter {
    async createIncident(alert) {
        const incident = {
            id: `INC-${Date.now()}`,
            severity: alert.severity,
            title: alert.title,
            startTime: new Date().toISOString(),
            detectionMethod: 'automated_alert',
            status: 'open',
            timeline: [
                {
                    time: new Date().toISOString(),
                    event: 'Incident detected',
                    details: alert.message
                }
            ],
            metrics: await this.captureMetrics()
        };

        // Save to incident tracking system
        await this.saveIncident(incident);

        // Create PagerDuty incident
        await this.createPagerDutyIncident(incident);

        // Create Slack thread
        await this.createSlackThread(incident);

        return incident;
    }

    async captureMetrics() {
        const resource = await tronWeb.trx.getAccountResources(hotWalletAddress);
        const account = await tronWeb.trx.getAccount(hotWalletAddress);

        return {
            balance: account.balance || 0,
            energyLimit: resource.EnergyLimit || 0,
            energyUsed: resource.EnergyUsed || 0,
            energyAvailable: (resource.EnergyLimit || 0) - (resource.EnergyUsed || 0),
            bandwidthLimit: resource.freeNetLimit || 0,
            bandwidthUsed: resource.freeNetUsed || 0,
            timestamp: Date.now()
        };
    }

    async updateTimeline(incidentId, event, details) {
        const incident = await this.getIncident(incidentId);
        incident.timeline.push({
            time: new Date().toISOString(),
            event: event,
            details: details
        });
        await this.saveIncident(incident);

        // Update Slack thread
        await this.updateSlackThread(incident);
    }

    async resolveIncident(incidentId, resolution) {
        const incident = await this.getIncident(incidentId);
        incident.status = 'resolved';
        incident.endTime = new Date().toISOString();
        incident.resolution = resolution;
        incident.duration = Date.now() - new Date(incident.startTime).getTime();

        await this.saveIncident(incident);

        // Close PagerDuty incident
        await this.resolvePagerDutyIncident(incident.id);

        // Post summary to Slack
        await this.postIncidentSummary(incident);

        // Schedule postmortem
        await this.schedulePostmortem(incident);
    }
}
```

---

## 8.6 Testing Resilience

### 8.6.1 Chaos Engineering for Resource Systems

**Principle**: Intentionally inject failures to validate resilience.

**Test scenarios**:

```javascript
class ResilienceTests {
    async testTRXDepletion() {
        console.log('TEST: Simulating TRX depletion');

        // 1. Drain hot wallet to threshold
        await this.drainWalletToThreshold(1000 * 1e6);  // 1k TRX

        // 2. Verify automatic failover
        await sleep(60000);  // Wait 1 minute
        const currentWallet = await this.getCurrentWallet();
        assert(currentWallet !== 'primary', 'Should have failed over');

        // 3. Verify user transactions still work
        const result = await this.testUserTransaction();
        assert(result.success, 'User transaction should succeed');

        // 4. Verify alerts sent
        const alerts = await this.getRecentAlerts();
        assert(alerts.some(a => a.title.includes('TRX')), 'Should have TRX alert');

        console.log('✓ TRX depletion test passed');
    }

    async testEnergyExhaustion() {
        console.log('TEST: Simulating energy exhaustion');

        // 1. Consume all available energy
        await this.consumeAllEnergy();

        // 2. Verify graceful degradation
        const subsidyPercent = await this.getSubsidyPercent();
        assert(subsidyPercent < 50, 'Should have reduced subsidization');

        // 3. Verify critical functions still work
        const withdrawResult = await this.testWithdrawal();
        assert(withdrawResult.success, 'Withdrawals should still work');

        // 4. Verify queue activated
        const queueStatus = await this.getQueueStatus();
        assert(queueStatus.active, 'Queue should be active');

        console.log('✓ Energy exhaustion test passed');
    }

    async testTrafficSpike() {
        console.log('TEST: Simulating traffic spike');

        // 1. Send 10x normal traffic
        const promises = [];
        for (let i = 0; i < 1000; i++) {
            promises.push(this.sendTestTransaction());
        }

        // 2. Monitor system behavior
        const results = await Promise.allSettled(promises);
        const successRate = results.filter(r => r.status === 'fulfilled').length / results.length;

        assert(successRate > 0.9, 'Should maintain >90% success rate under load');

        // 3. Verify resources scaled
        const postTrafficEnergy = await this.getEnergyLimit();
        const preTrafficEnergy = this.initialEnergyLimit;
        assert(postTrafficEnergy >= preTrafficEnergy, 'Should have scaled resources');

        console.log('✓ Traffic spike test passed');
    }
}

// Run resilience tests on staging
const tests = new ResilienceTests();
await tests.testTRXDepletion();
await tests.testEnergyExhaustion();
await tests.testTrafficSpike();
```

---

## 8.7 Production Checklist

### Before Launch
- [ ] Backup wallets configured and tested
- [ ] Automatic refill tested on testnet
- [ ] Failover procedures tested
- [ ] Monitoring alerts configured (multiple thresholds)
- [ ] Incident response playbook written
- [ ] On-call rotation established
- [ ] Status page integrated
- [ ] Graceful degradation tested
- [ ] Queue system tested under load
- [ ] Chaos tests passed on staging

### Regular Operations
- [ ] Weekly backup wallet balance checks
- [ ] Monthly chaos tests on staging
- [ ] Quarterly incident response drills
- [ ] Review and update runbooks
- [ ] Monitor alert noise (tune thresholds)
- [ ] Analyze incident trends

---

## 8.8 What's Next?

You now understand:
- ✅ Principles of resilient systems
- ✅ Graceful degradation patterns
- ✅ Resource exhaustion scenarios and recovery
- ✅ Backup resource pools and failover
- ✅ Incident response procedures
- ✅ Chaos engineering for testing

In **Chapter 9: Adaptive Energy Economics**, we'll explore:
- Deep dive into the adaptive energy algorithm
- Capacity modeling and predictions
- Market dynamics and game theory
- Energy factor impact on protocol design
- Economic incentives and attacks

---

**[End of Chapter 8]**
