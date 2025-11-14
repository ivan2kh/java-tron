# Code Examples

This directory contains production-ready code examples that combine multiple concepts from the book chapters.

## Purpose

Large, complete code examples have been extracted from the chapters to:
- Keep chapter content focused on explanations and concepts
- Provide copy-paste ready implementations
- Combine related functionality in single files
- Make it easy to run and test examples

## Files

### `resource-monitoring.js`
**Topics**: Real-time monitoring, metrics collection, alerting
**From**: Chapter 7 - Monitoring and Observability

Contains:
- `ResourceMonitor` class - Collects resource metrics from TRON accounts
- `AlertManager` class - Detects threshold violations and fires alerts

**Usage**:
```javascript
const { ResourceMonitor, AlertManager } = require('./resource-monitoring');

const monitor = new ResourceMonitor(tronWeb, accountAddress);
const alertManager = new AlertManager(monitor, {
    energyWarning: 75,
    energyCritical: 90
});

// Poll every 30 seconds
setInterval(() => alertManager.check(), 30000);
```

### `incident-response.js`
**Topics**: Incident triage, auto-remediation, failover
**From**: Chapter 8 - Resilient Resource Management

Contains:
- `ResourceIncidentPlaybook` class - Automated incident classification and response
- `MultiTierResourceManager` class - Multi-tier failover system

**Usage**:
```javascript
const { ResourceIncidentPlaybook } = require('./incident-response');

const playbook = new ResourceIncidentPlaybook({
    tronWeb,
    contractAddress: 'TYourContract'
});

// Handle resource alert
await playbook.handleResourceAlert({
    type: 'burn_rate_spike',
    severity: 'critical'
});
```

### `adaptive-energy-utils.js`
**Topics**: EWMA simulation, cost calculation, capacity planning
**From**: Chapter 9 - Adaptive Energy Economics

Contains:
- `EWMASimulator` class - Simulates exponentially weighted moving average
- `AdaptiveEnergyCostCalculator` class - Worst/best case cost analysis
- `CostAwareTransactionQueue` class - Queue transactions for favorable costs

**Usage**:
```javascript
const { EWMASimulator, AdaptiveEnergyCostCalculator } = require('./adaptive-energy-utils');

// Simulate usage pattern
const sim = new EWMASimulator();
const results = sim.simulate(
    () => 100_000_000,  // Constant 100M energy
    48  // 48 hours
);

// Calculate required capacity
const calc = new AdaptiveEnergyCostCalculator();
const planning = calc.calculateRequiredFrozenTRX(10_000_000);
console.log(`Required TRX: ${planning.requiredTRX}`);
```

## Installation

```bash
npm install tronweb
```

## Integration

All examples use `require('tronweb')` and can be integrated into your project:

```javascript
// Your main application
const TronWeb = require('tronweb');
const { ResourceMonitor } = require('./book/code-examples/resource-monitoring');

const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: process.env.PRIVATE_KEY
});

const monitor = new ResourceMonitor(tronWeb, 'TYourAddress');

// Start monitoring
setInterval(async () => {
    const metrics = await monitor.collect();
    console.log('Energy:', metrics.energyAvailable);
}, 30000);
```

## Production Notes

These examples are designed to be production-ready but require customization:

1. **Alert Integration**: Replace console.log with actual notification services (Slack, PagerDuty, email)
2. **Error Handling**: Add appropriate error handling for your use case
3. **Database**: Integrate with your metrics database for historical data
4. **Configuration**: Extract hardcoded thresholds to configuration files
5. **Logging**: Add structured logging for production debugging

## License

Same as the main book - all code is provided for educational purposes.
