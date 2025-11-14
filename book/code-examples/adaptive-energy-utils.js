/**
 * Adaptive Energy Economics - Utilities and Simulators
 *
 * Tools for understanding and working with TRON's adaptive energy system.
 * Combines examples from Chapter 9.
 *
 * Topics covered:
 * - EWMA (Exponentially Weighted Moving Average) simulation
 * - Worst-case/best-case cost analysis
 * - Capacity planning calculators
 * - Cost-aware transaction management
 */

const TronWeb = require('tronweb');

/**
 * EWMASimulator
 *
 * Simulates how the Exponentially Weighted Moving Average
 * responds to different energy usage patterns.
 */
class EWMASimulator {
    constructor() {
        this.WINDOW_SIZE_MS = 24 * 60 * 60 * 1000;  // 24 hours
        this.BLOCK_INTERVAL_MS = 3000;  // 3 seconds
        this.average = 0;
        this.lastUpdateTime = 0;
    }

    update(currentTime, energyUsed) {
        if (this.lastUpdateTime === 0) {
            this.average = energyUsed;
            this.lastUpdateTime = currentTime;
            return this.average;
        }

        const timeInterval = currentTime - this.lastUpdateTime;
        const decayFactor = timeInterval / this.WINDOW_SIZE_MS;

        this.average = this.average * (1 - decayFactor);
        this.average = this.average + energyUsed;

        this.lastUpdateTime = currentTime;
        return this.average;
    }

    /**
     * Simulate a usage pattern over time
     * @param pattern - Function that takes elapsedMs and returns energy usage
     * @param durationHours - How long to simulate
     */
    simulate(pattern, durationHours) {
        const startTime = Date.now();
        const endTime = startTime + (durationHours * 60 * 60 * 1000);

        const results = [];
        let currentTime = startTime;

        while (currentTime < endTime) {
            const energyUsed = pattern(currentTime - startTime);
            const avg = this.update(currentTime, energyUsed);

            // Record result every hour
            if (results.length === 0 || currentTime - startTime >= results.length * 60 * 60 * 1000) {
                results.push({
                    hour: (currentTime - startTime) / (60 * 60 * 1000),
                    energyUsed,
                    average: Math.round(avg)
                });
            }

            currentTime += this.BLOCK_INTERVAL_MS;
        }

        return results;
    }
}

/**
 * AdaptiveEnergyCostCalculator
 *
 * Calculates worst-case and best-case energy costs
 * under adaptive pricing.
 */
class AdaptiveEnergyCostCalculator {
    constructor() {
        this.baseLimit = 90_000_000_000;  // 90B base energy limit
        this.targetTimes = 10;  // Target is 10x average usage
    }

    /**
     * Calculate worst-case (sustained high utilization)
     */
    calculateWorstCase(sustainedUtilization = 0.99, adjustmentSteps = 1000) {
        let currentLimit = this.baseLimit;

        for (let step = 0; step < adjustmentSteps; step++) {
            const averageUsage = currentLimit * sustainedUtilization;
            const targetUsage = averageUsage * this.targetTimes;

            let newLimit = currentLimit * this.baseLimit / targetUsage;

            // Apply bounds
            const minLimit = this.baseLimit * 0.99;
            const maxLimit = this.baseLimit * 1000;
            newLimit = Math.max(Math.min(newLimit, maxLimit), minLimit);

            currentLimit = newLimit;
        }

        const costMultiplier = this.baseLimit / currentLimit;

        return {
            finalLimit: currentLimit,
            costMultiplier,
            maxCostIncrease: ((costMultiplier - 1) * 100).toFixed(2) + '%'
        };
    }

    /**
     * Calculate best-case (sustained low utilization)
     */
    calculateBestCase(sustainedUtilization = 0.05, adjustmentSteps = 1000) {
        let currentLimit = this.baseLimit;

        for (let step = 0; step < adjustmentSteps; step++) {
            const averageUsage = currentLimit * sustainedUtilization;
            const targetUsage = averageUsage * this.targetTimes;

            let newLimit = currentLimit * this.baseLimit / targetUsage;

            const minLimit = this.baseLimit * 0.99;
            const maxLimit = this.baseLimit * 1000;
            newLimit = Math.max(Math.min(newLimit, maxLimit), minLimit);

            currentLimit = newLimit;
        }

        const costMultiplier = this.baseLimit / currentLimit;

        return {
            finalLimit: currentLimit,
            costMultiplier,
            costReduction: ((1 - costMultiplier) * 100).toFixed(2) + '%'
        };
    }

    /**
     * Calculate required frozen TRX with safety margins
     */
    calculateRequiredFrozenTRX(peakDailyEnergyUsage) {
        const safetyMultipliers = {
            adaptiveAdjustment: 1.02,   // Max 1% cost increase
            trafficSpikes: 1.3,          // 30% traffic spikes
            measurementError: 1.1,       // 10% estimation error
            generalBuffer: 1.2           // General safety
        };

        const totalMultiplier = Object.values(safetyMultipliers)
            .reduce((a, b) => a * b, 1);

        const requiredEnergy = peakDailyEnergyUsage * totalMultiplier;

        // Assume ~1,000 energy per TRX frozen
        const energyPerTRX = 1000;
        const requiredTRX = Math.ceil(requiredEnergy / energyPerTRX);

        return {
            peakUsage: peakDailyEnergyUsage,
            safetyMargin: totalMultiplier.toFixed(2),
            requiredEnergy,
            requiredTRX
        };
    }
}

/**
 * CostAwareTransactionQueue
 *
 * Queues transactions and executes them when energy costs are favorable.
 */
class CostAwareTransactionQueue {
    constructor(contractAddress, costThreshold = 1.3) {
        this.contractAddress = contractAddress;
        this.queue = [];
        this.costThreshold = costThreshold;
        this.baselineCost = null;
        this.processing = false;
    }

    /**
     * Add transaction to queue
     */
    enqueue(transaction) {
        this.queue.push({
            ...transaction,
            enqueuedAt: Date.now(),
            priority: transaction.priority || 'normal'
        });

        console.log(`Transaction queued. Queue size: ${this.queue.length}`);
    }

    /**
     * Check current energy cost
     */
    async getCurrentEnergyCost(tronWeb) {
        const params = await tronWeb.trx.getChainParameters();

        const currentLimit = params.find(
            p => p.key === 'getTotalEnergyCurrentLimit'
        )?.value || 90_000_000_000;

        const baseLimit = params.find(
            p => p.key === 'getTotalEnergyTargetLimit'
        )?.value || 90_000_000_000;

        const multiplier = baseLimit / currentLimit;

        return {
            currentLimit,
            baseLimit,
            multiplier
        };
    }

    /**
     * Process queue when costs are acceptable
     */
    async tryProcess(tronWeb) {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        try {
            const cost = await this.getCurrentEnergyCost(tronWeb);

            if (this.baselineCost === null) {
                this.baselineCost = cost.multiplier;
            }

            const relativeCost = cost.multiplier / this.baselineCost;

            console.log(`Current cost: ${cost.multiplier.toFixed(2)}x base`);

            if (relativeCost <= this.costThreshold) {
                console.log(`Cost acceptable, processing queue...`);
                await this.processQueue(tronWeb);
            } else {
                console.log(`Cost too high, waiting...`);
                await this.processHighPriority(tronWeb);
            }

        } catch (error) {
            console.error('Error processing queue:', error);
        } finally {
            this.processing = false;
        }
    }

    async processQueue(tronWeb) {
        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, 10);
            console.log(`Processing batch of ${batch.length} transactions`);

            // Execute batch (implementation depends on your contract)
            // await this.executeBatch(tronWeb, batch);
        }
    }

    async processHighPriority(tronWeb) {
        const highPriority = this.queue.filter(tx => tx.priority === 'high');

        console.log(`Processing ${highPriority.length} high-priority transactions`);

        for (const tx of highPriority) {
            // Execute high-priority transaction
            const index = this.queue.indexOf(tx);
            if (index > -1) {
                this.queue.splice(index, 1);
            }
        }
    }
}

// Usage examples
async function exampleEWMASimulation() {
    console.log('=== EWMA Simulation: Constant Usage ===\n');

    const sim = new EWMASimulator();
    const results = sim.simulate(
        () => 100_000_000,  // Constant 100M energy
        48  // 48 hours
    );

    console.log('Hour | Energy Used | Average');
    results.forEach(r => {
        console.log(`${r.hour.toString().padStart(4)} | ${(r.energyUsed / 1e6).toFixed(0)}M | ${(r.average / 1e6).toFixed(0)}M`);
    });
}

async function exampleCostCalculation() {
    console.log('\n=== Cost Analysis ===\n');

    const calc = new AdaptiveEnergyCostCalculator();

    const worstCase = calc.calculateWorstCase();
    console.log('Worst Case (99% utilization):');
    console.log(`  Max cost increase: ${worstCase.maxCostIncrease}`);

    const bestCase = calc.calculateBestCase();
    console.log('\nBest Case (5% utilization):');
    console.log(`  Cost reduction: ${bestCase.costReduction}`);

    const planning = calc.calculateRequiredFrozenTRX(10_000_000);
    console.log('\nCapacity Planning (10M daily energy):');
    console.log(`  Safety margin: ${planning.safetyMargin}x`);
    console.log(`  Required TRX: ${planning.requiredTRX}`);
}

// Export
module.exports = {
    EWMASimulator,
    AdaptiveEnergyCostCalculator,
    CostAwareTransactionQueue
};
