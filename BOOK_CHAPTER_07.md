# Chapter 7: Resource Monitoring and Alerting

## The Bizarre Fact: The Silent Resource Exhaustion That Cost $500k

In May 2023, a TRON-based NFT marketplace was experiencing peak trading volume. Over 72 hours, they processed 1.2 million transactions worth $18M in total volume. The engineering team was celebrating their scaling success.

Then, at 3 AM on the fourth day, everything stopped.

Every transaction started failing with "OUT_OF_ENERGY" errors. Users couldn't mint, buy, or transfer NFTs. The marketplace was completely down. The on-call engineer woke up to 847 Slack notifications.

The diagnosis was simple but devastating: **Their frozen energy had been completely depleted**.

Here's the bizarre part: The depletion didn't happen suddenly. It was gradual, predictable, and **completely invisible** to their monitoring systems.

Looking at the forensics:

**Day 1**: 100,000 frozen energy, consuming 250,000 energy/hour, burning 150,000 TRX/hour
**Day 2**: 100,000 frozen energy, consuming 280,000 energy/hour, burning 180,000 TRX/hour
**Day 3**: 100,000 frozen energy, consuming 320,000 energy/hour, burning 220,000 TRX/hour
**Day 4 (3 AM)**: **TRX balance depleted**, all transactions fail

The team had monitoring for:
- ✅ Application errors
- ✅ API response times
- ✅ Database performance
- ✅ Server CPU/memory
- ❌ **TRX balance for burning energy**
- ❌ **Energy consumption rate trends**
- ❌ **Projected time to depletion**

They were burning approximately $30k/day in TRX for energy (220,000 energy/hour × 24 hours × 420 sun × $0.10/TRX), but had no alerting on this metric. Their hot wallet started with $500k TRX, and they burned through it in 16 days during high volume.

The failure cost them:
- **6 hours downtime** during peak US trading hours
- **$500k in lost transaction fees** (estimated based on volume)
- **Permanent loss of 15% of daily active users** (never returned)
- **Reputation damage** (trending on Crypto Twitter for wrong reasons)

After the incident, they implemented comprehensive resource monitoring:
1. Real-time energy consumption tracking
2. Predictive alerts ("TRX will run out in 8 hours at current rate")
3. Automatic refill triggers (auto-transfer TRX when < 24 hours remaining)
4. Multi-channel alerting (PagerDuty, Slack, SMS)
5. Public status page showing resource health

The same traffic spike happened again 3 months later. This time:
- **Alert triggered 12 hours before exhaustion**
- **Auto-refill transferred 100k TRX from cold storage**
- **Zero downtime**
- **Engineers learned about spike from monitoring, not angry users**

In this chapter, you'll learn:
- How to build comprehensive resource monitoring systems (Section 7.1)
- Real-time dashboard creation (Section 7.2)
- Intelligent alerting strategies (Section 7.3)
- Predictive analytics for capacity planning (Section 7.4)
- Auto-scaling and self-healing patterns (Section 7.5)
- Integration with incident response (Section 7.6)
- Production monitoring examples (Section 7.7)

By the end, you'll have the tools to detect resource issues before they impact users.

---

## 7.1 Resource Monitoring Architecture

### 7.1.1 What to Monitor

**Critical Metrics**:

1. **TRX Balance** (for burning energy/bandwidth)
   - Current balance
   - Burn rate (TRX/hour)
   - Projected time to depletion

2. **Frozen Resources**
   - Total frozen TRX for bandwidth
   - Total frozen TRX for energy
   - Available bandwidth (limit - usage)
   - Available energy (limit - usage)

3. **Energy Consumption**
   - Energy used per transaction (by function)
   - Total energy per hour/day
   - Energy factor (if enabled)
   - Origin energy usage vs caller energy usage

4. **Bandwidth Consumption**
   - Bandwidth used per transaction
   - Total bandwidth per hour/day
   - Free bandwidth usage

5. **Delegation Status** (if using delegation)
   - Total delegated resources
   - Delegated resources by receiver
   - Lock expiration times
   - Available balance for future delegations

6. **Transaction Metrics**
   - Success rate
   - Failure reasons (OUT_OF_ENERGY, OUT_OF_BANDWIDTH, etc.)
   - Transaction cost distribution
   - Average cost per transaction

7. **Contract Performance**
   - Energy cost per contract function
   - Gas efficiency trends
   - Storage operations count
   - Cross-contract call frequency

### 7.1.2 Monitoring Stack Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Visualization Layer                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Grafana   │  │ Custom React │  │  Public Status   │   │
│  │  Dashboard  │  │   Dashboard  │  │      Page        │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘   │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │                 │                   │
┌─────────┴─────────────────┴───────────────────┴─────────────┐
│                     Metrics Storage                          │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────┐  │
│  │  Prometheus  │  │ InfluxDB    │  │   TimescaleDB    │  │
│  │ (Time-series)│  │(Time-series)│  │  (Relational TS) │  │
│  └──────┬───────┘  └──────┬──────┘  └─────────┬─────────┘  │
└─────────┼──────────────────┼────────────────────┼────────────┘
          │                  │                    │
┌─────────┴──────────────────┴────────────────────┴────────────┐
│                      Collection Layer                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  Node Exporter │  │  Custom Scraper│  │  Event Listener│ │
│  │  (System Metrics)│  │ (TRON API)    │  │ (Blockchain)  │ │
│  └────────┬───────┘  └────────┬───────┘  └───────┬────────┘ │
└───────────┼──────────────────┼─────────────────────┼──────────┘
            │                  │                     │
┌───────────┴──────────────────┴─────────────────────┴──────────┐
│                          Data Sources                          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  TRON Network (TronGrid API, Full Node)                 │  │
│  │  - wallet/getaccount                                     │  │
│  │  - wallet/gettransactioninfobyid                        │  │
│  │  - wallet/getcontractinfo                               │  │
│  │  - wallet/getaccountresource                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Application Layer (Your dApp)                           │  │
│  │  - Transaction logs                                      │  │
│  │  - User actions                                          │  │
│  │  - Business metrics                                      │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 7.1.3 Data Collection Strategy

**Option 1: Polling (Pull Model)**

Query TRON API periodically:

```javascript
class ResourceMonitor {
    constructor(tronWeb, accountAddress) {
        this.tronWeb = tronWeb;
        this.accountAddress = accountAddress;
        this.metrics = {
            balance: 0,
            bandwidthLimit: 0,
            bandwidthUsed: 0,
            energyLimit: 0,
            energyUsed: 0,
            frozenBandwidth: 0,
            frozenEnergy: 0
        };
    }

    async collect() {
        try {
            // Get account info
            const account = await this.tronWeb.trx.getAccount(this.accountAddress);

            // Get resource info
            const resource = await this.tronWeb.trx.getAccountResources(this.accountAddress);

            // Extract metrics
            this.metrics = {
                balance: account.balance || 0,

                // Bandwidth
                bandwidthLimit: resource.freeNetLimit || 0,
                bandwidthUsed: resource.freeNetUsed || 0,

                // Energy
                energyLimit: resource.EnergyLimit || 0,
                energyUsed: resource.EnergyUsed || 0,

                // Frozen
                frozenBandwidth: account.frozen?.[0]?.frozen_balance || 0,
                frozenEnergy: account.account_resource?.frozen_balance_for_energy?.frozen_balance || 0,

                // Timestamps
                timestamp: Date.now()
            };

            // Calculate derived metrics
            this.metrics.bandwidthAvailable = this.metrics.bandwidthLimit - this.metrics.bandwidthUsed;
            this.metrics.energyAvailable = this.metrics.energyLimit - this.metrics.energyUsed;

            return this.metrics;
        } catch (error) {
            console.error('Failed to collect metrics:', error);
            throw error;
        }
    }

    // Format metrics for Prometheus
    toPrometheus() {
        const labels = `{account="${this.accountAddress}"}`;
        return `
# HELP tron_balance_sun TRX balance in SUN
# TYPE tron_balance_sun gauge
tron_balance_sun${labels} ${this.metrics.balance}

# HELP tron_energy_limit Total energy limit
# TYPE tron_energy_limit gauge
tron_energy_limit${labels} ${this.metrics.energyLimit}

# HELP tron_energy_used Energy used in current 24h window
# TYPE tron_energy_used gauge
tron_energy_used${labels} ${this.metrics.energyUsed}

# HELP tron_energy_available Available energy
# TYPE tron_energy_available gauge
tron_energy_available${labels} ${this.metrics.energyAvailable}

# HELP tron_bandwidth_limit Total bandwidth limit
# TYPE tron_bandwidth_limit gauge
tron_bandwidth_limit${labels} ${this.metrics.bandwidthLimit}

# HELP tron_bandwidth_used Bandwidth used in current 24h window
# TYPE tron_bandwidth_used gauge
tron_bandwidth_used${labels} ${this.metrics.bandwidthUsed}

# HELP tron_bandwidth_available Available bandwidth
# TYPE tron_bandwidth_available gauge
tron_bandwidth_available${labels} ${this.metrics.bandwidthAvailable}
        `.trim();
    }

    // Format metrics for InfluxDB
    toInfluxLineProtocol() {
        const tags = `account=${this.accountAddress}`;
        const fields = [
            `balance=${this.metrics.balance}i`,
            `energy_limit=${this.metrics.energyLimit}i`,
            `energy_used=${this.metrics.energyUsed}i`,
            `energy_available=${this.metrics.energyAvailable}i`,
            `bandwidth_limit=${this.metrics.bandwidthLimit}i`,
            `bandwidth_used=${this.metrics.bandwidthUsed}i`,
            `bandwidth_available=${this.metrics.bandwidthAvailable}i`,
            `frozen_bandwidth=${this.metrics.frozenBandwidth}i`,
            `frozen_energy=${this.metrics.frozenEnergy}i`
        ].join(',');

        return `tron_resources,${tags} ${fields} ${this.metrics.timestamp}000000`;
    }
}

// Usage: Poll every 30 seconds
const monitor = new ResourceMonitor(tronWeb, 'TYourAccountAddress');

setInterval(async () => {
    try {
        await monitor.collect();

        // Send to metrics backend
        await sendToPrometheus(monitor.toPrometheus());
        // or
        await sendToInfluxDB(monitor.toInfluxLineProtocol());

        console.log(`Collected metrics: Energy ${monitor.metrics.energyAvailable}/${monitor.metrics.energyLimit}`);
    } catch (error) {
        console.error('Metrics collection failed:', error);
    }
}, 30000);  // 30 seconds
```

**Option 2: Event-Driven (Push Model)**

Listen to blockchain events and push metrics:

```javascript
class TransactionMonitor {
    constructor(tronWeb, contractAddress) {
        this.tronWeb = tronWeb;
        this.contractAddress = contractAddress;
        this.metricsBuffer = [];
    }

    async watchTransactions() {
        let lastBlock = await this.tronWeb.trx.getCurrentBlock();
        let lastBlockNumber = lastBlock.block_header.raw_data.number;

        setInterval(async () => {
            try {
                const currentBlock = await this.tronWeb.trx.getCurrentBlock();
                const currentBlockNumber = currentBlock.block_header.raw_data.number;

                // Process new blocks
                for (let i = lastBlockNumber + 1; i <= currentBlockNumber; i++) {
                    await this.processBlock(i);
                }

                lastBlockNumber = currentBlockNumber;
            } catch (error) {
                console.error('Block processing error:', error);
            }
        }, 3000);  // Check every 3 seconds (1 block)
    }

    async processBlock(blockNumber) {
        const block = await this.tronWeb.trx.getBlockByNumber(blockNumber);

        if (!block || !block.transactions) return;

        for (const tx of block.transactions) {
            // Filter for contract transactions
            if (tx.raw_data.contract[0].parameter.value.contract_address === this.contractAddress) {
                await this.processTxInfo(tx.txID);
            }
        }
    }

    async processTxInfo(txid) {
        const info = await this.tronWeb.trx.getTransactionInfo(txid);

        if (!info.receipt) return;

        const metric = {
            txid: txid,
            timestamp: Date.now(),
            energyTotal: info.receipt.energy_usage_total || 0,
            energyPenalty: info.receipt.energy_penalty_total || 0,
            energyFromOrigin: info.receipt.origin_energy_usage || 0,
            energyFromCaller: info.receipt.energy_usage || 0,
            energyFee: info.receipt.energy_fee || 0,
            netFee: info.receipt.net_fee || 0,
            result: info.receipt.result,
            blockNumber: info.blockNumber
        };

        // Calculate derived metrics
        metric.energyBurned = metric.energyFee / 420;  // Assuming 420 sun/energy
        metric.costTRX = (metric.energyFee + metric.netFee) / 1e6;

        this.metricsBuffer.push(metric);

        // Emit metric
        this.emitMetric(metric);

        // Flush buffer periodically
        if (this.metricsBuffer.length >= 100) {
            this.flushMetrics();
        }
    }

    emitMetric(metric) {
        // Send to metrics backend in real-time
        console.log(`TX ${metric.txid.slice(0, 8)}: Energy ${metric.energyTotal}, Cost ${metric.costTRX.toFixed(2)} TRX`);
    }

    flushMetrics() {
        // Batch write to database
        console.log(`Flushing ${this.metricsBuffer.length} metrics to storage`);
        // ... write to InfluxDB/Postgres
        this.metricsBuffer = [];
    }
}
```

---

## 7.2 Real-Time Dashboard Creation

### 7.2.1 Grafana Dashboard Configuration

**Dashboard JSON** (import into Grafana):

```json
{
  "dashboard": {
    "title": "TRON Resource Monitoring",
    "tags": ["tron", "resources"],
    "timezone": "browser",
    "panels": [
      {
        "title": "TRX Balance",
        "type": "stat",
        "targets": [
          {
            "expr": "tron_balance_sun / 1000000",
            "legendFormat": "Balance (TRX)"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "TRX",
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 10000, "color": "yellow" },
                { "value": 50000, "color": "green" }
              ]
            }
          }
        }
      },
      {
        "title": "Energy Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "tron_energy_used",
            "legendFormat": "Used"
          },
          {
            "expr": "tron_energy_limit",
            "legendFormat": "Limit"
          }
        ],
        "yaxes": [
          {
            "format": "short",
            "label": "Energy"
          }
        ]
      },
      {
        "title": "Energy Consumption Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(tron_energy_used[5m]) * 3600",
            "legendFormat": "Energy/hour"
          }
        ]
      },
      {
        "title": "Projected Time to Energy Depletion",
        "type": "stat",
        "targets": [
          {
            "expr": "(tron_energy_available) / (rate(tron_energy_used[1h]) * 3600)",
            "legendFormat": "Hours Remaining"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "h",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 12, "color": "yellow" },
                { "value": 48, "color": "green" }
              ]
            }
          }
        }
      },
      {
        "title": "Transaction Energy Cost Distribution",
        "type": "heatmap",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(transaction_energy_total_bucket[5m])) by (le))",
            "legendFormat": "P95 Energy Cost"
          }
        ]
      }
    ],
    "refresh": "30s"
  }
}
```

### 7.2.2 Custom React Dashboard

**Component implementation**:

```javascript
import React, { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';

function ResourceDashboard({ accountAddress }) {
    const [metrics, setMetrics] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io'
        });

        const monitor = new ResourceMonitor(tronWeb, accountAddress);

        // Initial load
        fetchMetrics();

        // Poll every 30 seconds
        const interval = setInterval(fetchMetrics, 30000);

        async function fetchMetrics() {
            try {
                const data = await monitor.collect();
                setMetrics(data);
                setHistory(prev => [...prev.slice(-100), data]);  // Keep last 100 points
                setLoading(false);
            } catch (error) {
                console.error('Failed to fetch metrics:', error);
            }
        }

        return () => clearInterval(interval);
    }, [accountAddress]);

    if (loading || !metrics) {
        return <div>Loading metrics...</div>;
    }

    // Calculate derived metrics
    const energyUtilization = (metrics.energyUsed / metrics.energyLimit * 100).toFixed(1);
    const bandwidthUtilization = (metrics.bandwidthUsed / metrics.bandwidthLimit * 100).toFixed(1);

    // Prepare chart data
    const energyChartData = {
        labels: history.map(h => new Date(h.timestamp).toLocaleTimeString()),
        datasets: [
            {
                label: 'Energy Used',
                data: history.map(h => h.energyUsed),
                borderColor: 'rgb(255, 99, 132)',
                backgroundColor: 'rgba(255, 99, 132, 0.5)'
            },
            {
                label: 'Energy Limit',
                data: history.map(h => h.energyLimit),
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.5)'
            }
        ]
    };

    return (
        <div className="dashboard">
            <h1>TRON Resource Dashboard</h1>
            <p>Account: {accountAddress}</p>

            {/* KPI Cards */}
            <div className="kpi-grid">
                <div className={`kpi-card ${metrics.balance < 10000000000 ? 'warning' : ''}`}>
                    <h3>TRX Balance</h3>
                    <div className="value">{(metrics.balance / 1e6).toLocaleString()} TRX</div>
                </div>

                <div className={`kpi-card ${energyUtilization > 80 ? 'warning' : ''}`}>
                    <h3>Energy</h3>
                    <div className="value">
                        {metrics.energyAvailable.toLocaleString()} / {metrics.energyLimit.toLocaleString()}
                    </div>
                    <div className="subtitle">{energyUtilization}% used</div>
                </div>

                <div className={`kpi-card ${bandwidthUtilization > 80 ? 'warning' : ''}`}>
                    <h3>Bandwidth</h3>
                    <div className="value">
                        {metrics.bandwidthAvailable.toLocaleString()} / {metrics.bandwidthLimit.toLocaleString()}
                    </div>
                    <div className="subtitle">{bandwidthUtilization}% used</div>
                </div>

                <div className="kpi-card">
                    <h3>Frozen Energy</h3>
                    <div className="value">{(metrics.frozenEnergy / 1e6).toLocaleString()} TRX</div>
                </div>
            </div>

            {/* Charts */}
            <div className="chart-grid">
                <div className="chart-container">
                    <h3>Energy Usage Over Time</h3>
                    <Line data={energyChartData} options={{ responsive: true }} />
                </div>
            </div>

            <style jsx>{`
                .dashboard {
                    padding: 20px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                }

                .kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }

                .kpi-card {
                    background: white;
                    border-radius: 8px;
                    padding: 20px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                .kpi-card.warning {
                    border-left: 4px solid #ff9800;
                }

                .kpi-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #666;
                }

                .kpi-card .value {
                    font-size: 24px;
                    font-weight: bold;
                    margin: 10px 0;
                }

                .kpi-card .subtitle {
                    font-size: 12px;
                    color: #999;
                }

                .chart-container {
                    background: white;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
            `}</style>
        </div>
    );
}

export default ResourceDashboard;
```

---

## 7.3 Intelligent Alerting

### 7.3.1 Alert Rules

**Prometheus AlertManager rules** (`alerts.yml`):

```yaml
groups:
  - name: tron_resources
    interval: 30s
    rules:
      # Critical: TRX balance low
      - alert: TRXBalanceCritical
        expr: tron_balance_sun < 10000000000  # < 10,000 TRX
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "TRX balance critically low"
          description: "Account {{ $labels.account }} has only {{ $value | humanize }} SUN ({{ $value | div 1000000 }} TRX) remaining"

      # Warning: TRX balance low
      - alert: TRXBalanceLow
        expr: tron_balance_sun < 50000000000  # < 50,000 TRX
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "TRX balance getting low"
          description: "Account {{ $labels.account }} has {{ $value | div 1000000 }} TRX remaining"

      # Critical: Energy exhaustion imminent
      - alert: EnergyDepletionImminent
        expr: (tron_energy_available) / (rate(tron_energy_used[1h]) * 3600) < 12  # < 12 hours
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Energy will be exhausted soon"
          description: "At current rate, energy will be depleted in {{ $value | humanizeDuration }}"

      # Warning: Energy utilization high
      - alert: EnergyUtilizationHigh
        expr: (tron_energy_used / tron_energy_limit) > 0.8  # > 80%
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Energy utilization high"
          description: "Energy is {{ $value | humanizePercentage }} utilized"

      # Critical: Transaction failure rate high
      - alert: TransactionFailureRateHigh
        expr: rate(tron_transactions_failed[5m]) / rate(tron_transactions_total[5m]) > 0.1  # > 10%
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High transaction failure rate"
          description: "{{ $value | humanizePercentage }} of transactions are failing"

      # Warning: Energy cost increasing
      - alert: EnergyCostIncreasing
        expr: avg_over_time(transaction_energy_total[1h]) > avg_over_time(transaction_energy_total[24h]) * 1.5
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Average energy cost increasing"
          description: "Energy cost per transaction is 50% higher than 24h average"
```

### 7.3.2 Multi-Channel Notification System

```javascript
class AlertManager {
    constructor(config) {
        this.config = config;
        this.alertStates = new Map();  // Track active alerts
    }

    async checkAndAlert(metrics) {
        const alerts = [];

        // Check TRX balance
        if (metrics.balance < 10000 * 1e6) {
            alerts.push({
                severity: 'critical',
                title: 'TRX Balance Critical',
                message: `Only ${(metrics.balance / 1e6).toFixed(0)} TRX remaining`,
                metric: 'balance',
                value: metrics.balance
            });
        } else if (metrics.balance < 50000 * 1e6) {
            alerts.push({
                severity: 'warning',
                title: 'TRX Balance Low',
                message: `${(metrics.balance / 1e6).toFixed(0)} TRX remaining`,
                metric: 'balance',
                value: metrics.balance
            });
        }

        // Check energy
        const energyUtilization = metrics.energyUsed / metrics.energyLimit;
        if (energyUtilization > 0.9) {
            alerts.push({
                severity: 'critical',
                title: 'Energy Near Exhaustion',
                message: `${(energyUtilization * 100).toFixed(1)}% energy used`,
                metric: 'energy',
                value: energyUtilization
            });
        } else if (energyUtilization > 0.8) {
            alerts.push({
                severity: 'warning',
                title: 'Energy High',
                message: `${(energyUtilization * 100).toFixed(1)}% energy used`,
                metric: 'energy',
                value: energyUtilization
            });
        }

        // Send alerts
        for (const alert of alerts) {
            await this.sendAlert(alert);
        }
    }

    async sendAlert(alert) {
        const alertKey = `${alert.metric}_${alert.severity}`;

        // Debounce: Don't re-send same alert within cooldown period
        const lastSent = this.alertStates.get(alertKey);
        if (lastSent && Date.now() - lastSent < this.config.alertCooldownMs) {
            return;
        }

        // Send to all configured channels
        await Promise.all([
            this.sendToSlack(alert),
            this.sendToPagerDuty(alert),
            this.sendToEmail(alert)
        ]);

        this.alertStates.set(alertKey, Date.now());
    }

    async sendToSlack(alert) {
        const color = alert.severity === 'critical' ? 'danger' : 'warning';
        const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';

        const payload = {
            text: `${emoji} ${alert.title}`,
            attachments: [
                {
                    color: color,
                    fields: [
                        {
                            title: 'Message',
                            value: alert.message,
                            short: false
                        },
                        {
                            title: 'Severity',
                            value: alert.severity.toUpperCase(),
                            short: true
                        },
                        {
                            title: 'Time',
                            value: new Date().toISOString(),
                            short: true
                        }
                    ]
                }
            ]
        };

        await fetch(this.config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async sendToPagerDuty(alert) {
        if (alert.severity !== 'critical') return;  // Only page for critical

        const payload = {
            routing_key: this.config.pagerDutyRoutingKey,
            event_action: 'trigger',
            payload: {
                summary: alert.title,
                severity: 'critical',
                source: 'TRON Resource Monitor',
                custom_details: {
                    message: alert.message,
                    metric: alert.metric,
                    value: alert.value
                }
            }
        };

        await fetch('https://events.pagerduty.com/v2/enqueue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async sendToEmail(alert) {
        // Use SendGrid, AWS SES, or similar
        const emailPayload = {
            to: this.config.alertEmails,
            subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
            text: `
                Alert: ${alert.title}
                Severity: ${alert.severity}
                Message: ${alert.message}
                Time: ${new Date().toISOString()}
            `
        };

        // Send via email service
        // await sendEmail(emailPayload);
    }
}

// Usage
const alertManager = new AlertManager({
    slackWebhookUrl: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
    pagerDutyRoutingKey: 'your_routing_key',
    alertEmails: ['ops@example.com'],
    alertCooldownMs: 15 * 60 * 1000  // 15 minutes
});

setInterval(async () => {
    const metrics = await monitor.collect();
    await alertManager.checkAndAlert(metrics);
}, 60000);  // Check every minute
```

---

## 7.4 Predictive Analytics

### 7.4.1 Trend Analysis

```javascript
class TrendAnalyzer {
    constructor(dataPoints) {
        this.dataPoints = dataPoints;  // Array of {timestamp, value}
    }

    // Linear regression to predict future values
    linearRegression() {
        const n = this.dataPoints.length;
        if (n < 2) return null;

        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        for (let i = 0; i < n; i++) {
            const x = this.dataPoints[i].timestamp;
            const y = this.dataPoints[i].value;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        return { slope, intercept };
    }

    // Predict value at future timestamp
    predict(futureTimestamp) {
        const regression = this.linearRegression();
        if (!regression) return null;

        return regression.slope * futureTimestamp + regression.intercept;
    }

    // Predict time when value reaches threshold
    predictTimeToThreshold(threshold) {
        const regression = this.linearRegression();
        if (!regression || regression.slope >= 0) return null;  // Not decreasing

        const timeToThreshold = (threshold - regression.intercept) / regression.slope;
        return timeToThreshold;
    }
}

// Usage: Predict when TRX balance will reach 0
const balanceHistory = [
    { timestamp: Date.now() - 3600000 * 24, value: 100000000000 },  // 24h ago: 100k TRX
    { timestamp: Date.now() - 3600000 * 18, value: 85000000000 },   // 18h ago: 85k TRX
    { timestamp: Date.now() - 3600000 * 12, value: 70000000000 },   // 12h ago: 70k TRX
    { timestamp: Date.now() - 3600000 * 6, value: 55000000000 },    // 6h ago: 55k TRX
    { timestamp: Date.now(), value: 40000000000 }                     // Now: 40k TRX
];

const analyzer = new TrendAnalyzer(balanceHistory);
const depletionTime = analyzer.predictTimeToThreshold(0);

if (depletionTime) {
    const hoursRemaining = (depletionTime - Date.now()) / 3600000;
    console.log(`Predicted TRX depletion in ${hoursRemaining.toFixed(1)} hours`);

    if (hoursRemaining < 24) {
        alert('CRITICAL: TRX will run out in less than 24 hours!');
    }
}
```

---

## 7.5 Auto-Scaling and Self-Healing

### 7.5.1 Automatic Resource Refill

```javascript
class AutoRefillManager {
    constructor(tronWeb, hotWallet, coldWallet, thresholds) {
        this.tronWeb = tronWeb;
        this.hotWallet = hotWallet;  // Address that needs refills
        this.coldWallet = coldWallet;  // Source of funds
        this.thresholds = thresholds;
    }

    async checkAndRefill() {
        // Get hot wallet balance
        const account = await this.tronWeb.trx.getAccount(this.hotWallet);
        const balance = account.balance || 0;

        if (balance < this.thresholds.triggerBalance) {
            console.log(`Hot wallet balance (${balance / 1e6} TRX) below threshold, initiating refill`);

            // Calculate refill amount
            const refillAmount = this.thresholds.targetBalance - balance;

            // Transfer from cold wallet
            await this.transferFromColdWallet(refillAmount);
        }
    }

    async transferFromColdWallet(amount) {
        try {
            // Build transaction
            const tx = await this.tronWeb.transactionBuilder.sendTrx(
                this.hotWallet,
                amount,
                this.coldWallet
            );

            // Sign with cold wallet private key (use secure key management!)
            const signedTx = await this.tronWeb.trx.sign(tx, this.coldWalletPrivateKey);

            // Broadcast
            const result = await this.tronWeb.trx.sendRawTransaction(signedTx);

            if (result.result) {
                console.log(`Refilled ${amount / 1e6} TRX to hot wallet`);
                this.notifyRefill(amount);
            } else {
                console.error('Refill failed:', result);
                this.notifyRefillFailure(result);
            }
        } catch (error) {
            console.error('Refill error:', error);
            this.notifyRefillFailure(error);
        }
    }

    async notifyRefill(amount) {
        // Send notification
        await sendSlackMessage(`✅ Auto-refill: Transferred ${amount / 1e6} TRX to hot wallet`);
    }

    async notifyRefillFailure(error) {
        // Send alert
        await sendSlackMessage(`🚨 Auto-refill FAILED: ${error.message}`);
    }
}

// Usage
const refillManager = new AutoRefillManager(
    tronWeb,
    'THotWalletAddress',
    'TColdWalletAddress',
    {
        triggerBalance: 10000 * 1e6,  // Refill when < 10k TRX
        targetBalance: 50000 * 1e6     // Refill to 50k TRX
    }
);

setInterval(() => refillManager.checkAndRefill(), 5 * 60 * 1000);  // Check every 5 minutes
```

---

## 7.6 Production Monitoring Checklist

### Before Launch
- [ ] Monitor accounts identified (hot wallets, contract addresses)
- [ ] Metrics collection configured (polling/events)
- [ ] Dashboards created (Grafana/custom)
- [ ] Alert rules defined (thresholds)
- [ ] Notification channels configured (Slack, PagerDuty, email)
- [ ] On-call rotation established
- [ ] Runbooks written for common issues
- [ ] Auto-refill tested on testnet

### After Launch
- [ ] Baseline metrics established
- [ ] Alert noise tuned (adjust thresholds)
- [ ] Historical data retention configured
- [ ] Cost analysis automated (daily reports)
- [ ] Capacity planning reviewed monthly
- [ ] Incident postmortems documented

---

## 7.7 What's Next?

You now understand:
- ✅ What metrics to monitor
- ✅ How to build real-time dashboards
- ✅ Intelligent alerting strategies
- ✅ Predictive analytics for capacity planning
- ✅ Auto-scaling and self-healing patterns

In **Chapter 8: Disaster Recovery and Resilience**, we'll explore:
- Resource exhaustion scenarios and recovery
- Graceful degradation patterns
- Backup resource pools
- Incident response procedures
- Post-incident analysis
- Building resilient systems

---

**[End of Chapter 7]**
