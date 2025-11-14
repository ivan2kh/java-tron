/**
 * Energy Profiler - Transaction Analysis Tool
 *
 * Analyzes TRON transaction receipts to break down energy costs and provide optimization recommendations.
 * From Chapter 5 - Energy Cost Analysis
 *
 * Topics covered:
 * - Transaction receipt parsing
 * - Energy cost breakdown (base + penalty)
 * - Creator vs. caller payment distribution
 * - Energy factor detection
 * - Cost calculation and recommendations
 */

const TronWeb = require('tronweb');

/**
 * TronEnergyProfiler
 *
 * Analyzes transaction energy usage and provides detailed breakdown.
 * Use this to understand where energy is being spent and identify optimization opportunities.
 */
class TronEnergyProfiler {
    constructor(tronWeb) {
        this.tronWeb = tronWeb;
    }

    /**
     * Analyze a transaction's energy usage
     * @param {string} txid - Transaction ID to analyze
     * @returns {Object} Detailed energy analysis
     */
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

    /**
     * Get current TRX price
     * Override this to integrate with your price oracle
     */
    async getTRXPrice() {
        // In production, fetch from price oracle
        // Example: CoinGecko API, Binance API, etc.
        return 0.10;  // $0.10 per TRX (placeholder)
    }

    /**
     * Print formatted analysis to console
     */
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

    /**
     * Analyze multiple transactions and return aggregate statistics
     */
    async analyzeBatch(txids) {
        const analyses = [];

        for (const txid of txids) {
            try {
                const analysis = await this.analyzeTransaction(txid);
                analyses.push(analysis);
            } catch (error) {
                console.error(`Failed to analyze ${txid}:`, error.message);
            }
        }

        // Calculate aggregate statistics
        const stats = {
            count: analyses.length,
            totalEnergy: analyses.reduce((sum, a) => sum + a.energyUsageTotal, 0),
            avgEnergy: 0,
            totalCostTRX: analyses.reduce((sum, a) => sum + a.costTRX, 0),
            avgCostTRX: 0,
            withPenalty: analyses.filter(a => a.energyPenaltyTotal > 0).length,
            avgEnergyFactor: 0
        };

        if (stats.count > 0) {
            stats.avgEnergy = stats.totalEnergy / stats.count;
            stats.avgCostTRX = stats.totalCostTRX / stats.count;

            const factorsSum = analyses.reduce((sum, a) => sum + a.energyFactor, 0);
            stats.avgEnergyFactor = factorsSum / stats.count;
        }

        return {
            analyses,
            stats
        };
    }

    /**
     * Print batch statistics
     */
    printBatchStats(result) {
        const { analyses, stats } = result;

        console.log('\n=== Batch Analysis Results ===');
        console.log(`Transactions analyzed: ${stats.count}`);
        console.log('');
        console.log('Energy Usage:');
        console.log(`  Total: ${stats.totalEnergy.toLocaleString()}`);
        console.log(`  Average: ${Math.round(stats.avgEnergy).toLocaleString()}`);
        console.log(`  With penalty: ${stats.withPenalty} (${((stats.withPenalty / stats.count) * 100).toFixed(1)}%)`);
        console.log(`  Avg energy factor: ${Math.round(stats.avgEnergyFactor)}`);
        console.log('');
        console.log('Costs:');
        console.log(`  Total: ${stats.totalCostTRX.toFixed(4)} TRX`);
        console.log(`  Average: ${stats.avgCostTRX.toFixed(4)} TRX`);

        // Identify most expensive transactions
        const sorted = [...analyses].sort((a, b) => b.energyUsageTotal - a.energyUsageTotal);
        console.log('');
        console.log('Top 5 Most Expensive:');
        sorted.slice(0, 5).forEach((a, i) => {
            console.log(`  ${i + 1}. ${a.txid.substring(0, 16)}... - ${a.energyUsageTotal.toLocaleString()} energy`);
        });
    }
}

// Usage examples
async function exampleSingleTransaction() {
    const tronWeb = new TronWeb({
        fullHost: 'https://api.trongrid.io'
    });

    const profiler = new TronEnergyProfiler(tronWeb);

    // Analyze a single transaction
    const analysis = await profiler.analyzeTransaction('your_tx_id_here');
    profiler.printAnalysis(analysis);
}

async function exampleBatchAnalysis() {
    const tronWeb = new TronWeb({
        fullHost: 'https://api.trongrid.io'
    });

    const profiler = new TronEnergyProfiler(tronWeb);

    // Analyze multiple transactions
    const txids = [
        'tx_id_1',
        'tx_id_2',
        'tx_id_3'
    ];

    const result = await profiler.analyzeBatch(txids);
    profiler.printBatchStats(result);
}

// Export
module.exports = {
    TronEnergyProfiler
};
