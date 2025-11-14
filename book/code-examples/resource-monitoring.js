/**
 * Resource Monitoring - Complete Implementation
 *
 * This file contains production-ready code for monitoring TRON resource usage.
 * Combines examples from Chapter 7.
 *
 * Topics covered:
 * - Real-time resource monitoring
 * - Metric collection and aggregation
 * - Alert detection and notification
 * - Dashboard data provision
 */

const TronWeb = require('tronweb');

/**
 * ResourceMonitor - Main monitoring class
 *
 * Collects resource metrics from TRON accounts and contracts.
 * Designed to be polled every 30-60 seconds for real-time monitoring.
 */
class ResourceMonitor {
    constructor(tronWeb, accountAddress) {
        this.tronWeb = tronWeb;
        this.accountAddress = accountAddress;
        this.history = [];
        this.maxHistorySize = 1000; // Keep last 1000 samples
    }

    /**
     * Collect current resource metrics
     * Returns snapshot of current resource state
     */
    async collect() {
        const [account, resources] = await Promise.all([
            this.tronWeb.trx.getAccount(this.accountAddress),
            this.tronWeb.trx.getAccountResources(this.accountAddress)
        ]);

        const metrics = {
            timestamp: Date.now(),

            // Energy metrics
            energyLimit: resources.EnergyLimit || 0,
            energyUsed: resources.EnergyUsed || 0,
            energyAvailable: (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0),

            // Bandwidth metrics
            bandwidthLimit: resources.NetLimit || 0,
            bandwidthUsed: resources.NetUsed || 0,
            bandwidthAvailable: (resources.NetLimit || 0) - (resources.NetUsed || 0),

            // Balance
            balance: account.balance || 0,

            // Frozen resources (Stake 2.0)
            frozenEnergy: this.getFrozenV2ForEnergy(account),
            frozenBandwidth: this.getFrozenV2ForBandwidth(account)
        };

        // Calculate utilization percentages
        metrics.energyUtilization = metrics.energyLimit > 0
            ? (metrics.energyUsed / metrics.energyLimit * 100)
            : 0;
        metrics.bandwidthUtilization = metrics.bandwidthLimit > 0
            ? (metrics.bandwidthUsed / metrics.bandwidthLimit * 100)
            : 0;

        // Store in history
        this.history.push(metrics);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        return metrics;
    }

    /**
     * Get statistics over time window
     */
    getStatistics(windowMinutes = 60) {
        const cutoff = Date.now() - (windowMinutes * 60 * 1000);
        const windowData = this.history.filter(m => m.timestamp >= cutoff);

        if (windowData.length === 0) return null;

        const energyUsages = windowData.map(m => m.energyUsed);
        const bandwidthUsages = windowData.map(m => m.bandwidthUsed);

        return {
            energyPeak: Math.max(...energyUsages),
            energyAverage: energyUsages.reduce((a, b) => a + b, 0) / energyUsages.length,
            bandwidthPeak: Math.max(...bandwidthUsages),
            bandwidthAverage: bandwidthUsages.reduce((a, b) => a + b, 0) / bandwidthUsages.length,
            sampleCount: windowData.length
        };
    }

    getFrozenV2ForEnergy(account) {
        const frozen = account.frozenV2 || [];
        const energyFrozen = frozen.find(f => f.type === 'ENERGY');
        return energyFrozen ? energyFrozen.amount : 0;
    }

    getFrozenV2ForBandwidth(account) {
        const frozen = account.frozenV2 || [];
        const bandwidthFrozen = frozen.find(f => f.type === 'BANDWIDTH');
        return bandwidthFrozen ? bandwidthFrozen.amount : 0;
    }
}

/**
 * AlertManager - Detects and fires alerts based on thresholds
 */
class AlertManager {
    constructor(monitor, thresholds = {}) {
        this.monitor = monitor;
        this.thresholds = {
            energyWarning: thresholds.energyWarning || 80,
            energyCritical: thresholds.energyCritical || 95,
            bandwidthWarning: thresholds.bandwidthWarning || 80,
            bandwidthCritical: thresholds.bandwidthCritical || 95,
            balanceWarning: thresholds.balanceWarning || 1000 * 1e6, // 1000 TRX
            balanceCritical: thresholds.balanceCritical || 100 * 1e6   // 100 TRX
        };
        this.lastAlerts = {};
        this.cooldownMs = 5 * 60 * 1000; // 5 minutes between duplicate alerts
    }

    async check() {
        const metrics = await this.monitor.collect();
        const alerts = [];

        // Energy alerts
        if (metrics.energyUtilization >= this.thresholds.energyCritical) {
            alerts.push({
                type: 'energy',
                severity: 'critical',
                message: `Energy utilization critical`,
                metrics
            });
        } else if (metrics.energyUtilization >= this.thresholds.energyWarning) {
            alerts.push({
                type: 'energy',
                severity: 'warning',
                message: `Energy utilization elevated`,
                metrics
            });
        }

        // Bandwidth alerts
        if (metrics.bandwidthUtilization >= this.thresholds.bandwidthCritical) {
            alerts.push({
                type: 'bandwidth',
                severity: 'critical',
                message: `Bandwidth utilization critical`,
                metrics
            });
        }

        // Balance alerts
        if (metrics.balance <= this.thresholds.balanceCritical) {
            alerts.push({
                type: 'balance',
                severity: 'critical',
                message: `Balance critically low`,
                metrics
            });
        }

        // Fire alerts (with cooldown)
        for (const alert of alerts) {
            this.fireAlert(alert);
        }

        return alerts;
    }

    fireAlert(alert) {
        const key = `${alert.type}_${alert.severity}`;
        const lastFired = this.lastAlerts[key];

        // Check cooldown
        if (lastFired && (Date.now() - lastFired < this.cooldownMs)) {
            return; // Skip, in cooldown
        }

        // Fire alert - replace with your notification system
        console.log(`[ALERT ${alert.severity.toUpperCase()}] ${alert.message}`);

        // Production: integrate with notification services
        // await this.sendToSlack(alert);
        // await this.sendToEmail(alert);
        // await this.sendToPagerDuty(alert);

        this.lastAlerts[key] = Date.now();
    }
}

// Usage example
async function main() {
    const tronWeb = new TronWeb({
        fullHost: 'https://api.trongrid.io'
    });

    const monitor = new ResourceMonitor(tronWeb, 'TYourAddressHere');
    const alertManager = new AlertManager(monitor, {
        energyWarning: 75,
        energyCritical: 90
    });

    // Poll every 30 seconds
    setInterval(async () => {
        await alertManager.check();
    }, 30000);
}

module.exports = {
    ResourceMonitor,
    AlertManager
};
