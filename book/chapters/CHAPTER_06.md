# Chapter 6: Advanced Contract Patterns

## The Bizarre Fact: The $2M Proxy Pattern Bug That Saved a DeFi Protocol

In September 2023, a TRON-based DeFi protocol discovered a critical bug in their lending contract. The interest rate calculation was off by a factor of 100, meaning users were accumulating 100x more interest than intended. Over 3 weeks, this error had cost the protocol approximately $2 million in excess payouts.

But here's the bizarre twist: **the bug saved them from an even worse fate**.

The protocol used a proxy pattern for upgradability. When they prepared a hotfix to correct the interest calculation, they discovered a second, far more dangerous bug in their collateralization logic. This bug would have allowed attackers to drain the entire $50M TVL by creating undercollateralized loans.

The kicker? **The interest rate bug was accidentally preventing the collateralization exploit from working**. The excessive interest payments were pushing accounts into liquidation before the collateralization bug could be exploited. It was like having a broken speedometer that accidentally kept you from driving fast enough to hit a landmine.

The developers faced a dilemma:
1. Deploy the interest fix immediately → save $2M but expose $50M to exploit
2. Fix both bugs simultaneously → risk attackers noticing the collateralization fix and front-running
3. Keep the interest bug → continue losing $2M but maintain security

They chose option 2, implementing an atomic upgrade that fixed both bugs in a single transaction. They coordinated with a Super Representative to guarantee their upgrade transaction would be included in the next block, preventing any front-running window.

The upgrade succeeded. Total damages: $2M in excessive interest (covered by insurance). Potential damages prevented: $50M+ total loss of user funds.

This story illustrates the power and peril of upgradeable contracts. In this chapter, you'll learn:
- How proxy patterns enable safe contract upgrades (Section 6.1)
- DELEGATECALL mechanics and security implications (Section 6.2)
- Resource subsidization strategies (Section 6.3)
- Precompiled contracts for gas efficiency (Section 6.4)
- Multi-contract architectures (Section 6.5)
- Emergency stop mechanisms (Section 6.6)
- Advanced security patterns (Section 6.7)

By the end, you'll understand how to build production-grade systems that balance upgradability, security, and efficiency.

---

## 6.1 Proxy Patterns for Upgradeability

Immutable smart contracts are secure but inflexible. Proxy patterns solve this by separating logic from storage.

### 6.1.1 Why Proxies Are Needed

**Problem**: Once deployed, contract code cannot be modified. Bugs are permanent.

**Solutions**:

1. **Deploy new contract, migrate state** → Expensive, requires user action
2. **Use proxy pattern** → Transparent upgrades, users interact with same address

### 6.1.2 Basic Proxy Architecture

**Components**:

1. **Proxy Contract**: Holds storage, forwards calls to logic contract
2. **Logic Contract**: Contains business logic, no storage
3. **Admin Contract**: Controls upgrade permissions

**Diagram**:
```
User
  ↓
Proxy (storage + fallback)
  ↓ DELEGATECALL
Logic Contract V1 (business logic)

[Upgrade]

Proxy (same address, same storage)
  ↓ DELEGATECALL
Logic Contract V2 (new business logic)
```

### 6.1.3 DELEGATECALL Deep Dive

**Source**: `actuator/src/main/java/org/tron/core/vm/OperationActions.java:1001-1008`

```java
public static void delegateCallAction(Program program) {
    program.stackPop();  // Gas (ignored)
    DataWord codeAddress = program.stackPop();  // Logic contract address
    DataWord value = DataWord.ZERO;  // No value transfer in DELEGATECALL

    DataWord adjustedCallEnergy = program.getAdjustedCallEnergy();
    exeCall(program, adjustedCallEnergy, codeAddress, value, DataWord.ZERO(), false);
}
```

**Key behaviors** (from `Program.java:1018-1030`):

- **msg.sender**: Preserved from original caller (not proxy address)
- **msg.value**: Preserved from original transaction
- **Storage context**: Proxy's storage, not logic contract's
- **Code executed**: From logic contract address

**Example**:

```solidity
// Proxy contract
contract Proxy {
    address public implementation;  // Logic contract address (slot 0)
    address public admin;           // Admin address (slot 1)

    constructor(address _implementation) {
        implementation = _implementation;
        admin = msg.sender;
    }

    // Fallback: Forward all calls to implementation via DELEGATECALL
    fallback() external payable {
        address impl = implementation;

        assembly {
            // Copy calldata to memory
            calldatacopy(0, 0, calldatasize())

            // DELEGATECALL to implementation
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)

            // Copy return data
            returndatacopy(0, 0, returndatasize())

            // Return or revert
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    // Admin function to upgrade implementation
    function upgradeTo(address newImplementation) external {
        require(msg.sender == admin, "Not admin");
        implementation = newImplementation;
    }

    receive() external payable {}
}

// Logic contract V1
contract LogicV1 {
    address public implementation;  // IMPORTANT: Must match proxy storage layout
    address public admin;

    uint256 public value;  // Actual business logic storage (slot 2)

    function setValue(uint256 newValue) external {
        value = newValue;
    }

    function getValue() external view returns (uint256) {
        return value;
    }
}

// Logic contract V2 (upgraded)
contract LogicV2 {
    address public implementation;  // IMPORTANT: Must match proxy storage layout
    address public admin;

    uint256 public value;  // Existing storage (slot 2)
    uint256 public multiplier;  // New storage variable (slot 3)

    function setValue(uint256 newValue) external {
        value = newValue;
    }

    function getValue() external view returns (uint256) {
        return value * multiplier;  // New behavior!
    }

    function setMultiplier(uint256 newMultiplier) external {
        multiplier = newMultiplier;
    }
}
```

**Usage**:

```javascript
const tronWeb = new TronWeb({
    fullHost: 'https://api.nileex.io',  // Testnet
    privateKey: 'your_private_key'
});

// 1. Deploy logic contract V1
const logicV1 = await tronWeb.contract().new({
    abi: logicV1ABI,
    bytecode: logicV1Bytecode
});

// 2. Deploy proxy pointing to logicV1
const proxy = await tronWeb.contract().new({
    abi: proxyABI,
    bytecode: proxyBytecode,
    parameters: [logicV1.address]
});

// 3. Interact with proxy as if it were logicV1
const proxyAsLogic = await tronWeb.contract(logicV1ABI, proxy.address);
await proxyAsLogic.setValue(42).send();
const value = await proxyAsLogic.getValue().call();
console.log('Value:', value);  // 42

// 4. Deploy logic contract V2
const logicV2 = await tronWeb.contract().new({
    abi: logicV2ABI,
    bytecode: logicV2Bytecode
});

// 5. Upgrade proxy to point to logicV2
await proxy.upgradeTo(logicV2.address).send();

// 6. Now proxy has V2 behavior
const proxyAsLogicV2 = await tronWeb.contract(logicV2ABI, proxy.address);
await proxyAsLogicV2.setMultiplier(10).send();
const newValue = await proxyAsLogicV2.getValue().call();
console.log('New value:', newValue);  // 420 (42 * 10)
```

### 6.1.4 Storage Collision Risks

**Critical**: Logic contracts must maintain identical storage layout across versions.

**Bad example** (storage collision):

```solidity
// Logic V1
contract LogicV1 {
    address public implementation;  // Slot 0
    address public admin;           // Slot 1
    uint256 public value;           // Slot 2
}

// Logic V2 - WRONG! Reordered storage
contract LogicV2Bad {
    address public admin;           // Slot 0 (was slot 1!)
    address public implementation;  // Slot 1 (was slot 0!)
    uint256 public value;           // Slot 2
    uint256 public multiplier;      // Slot 3
}
```

**What happens**: When proxy uses V2, `implementation` and `admin` are swapped! Admin loses control, implementation address becomes admin.

**Good example** (safe upgrade):

```solidity
// Logic V2 - CORRECT! Preserves storage layout
contract LogicV2Good {
    address public implementation;  // Slot 0 (unchanged)
    address public admin;           // Slot 1 (unchanged)
    uint256 public value;           // Slot 2 (unchanged)
    uint256 public multiplier;      // Slot 3 (new)
}
```

**Rule**: New storage variables can only be **appended** at the end, never inserted or reordered.

### 6.1.5 Transparent Proxy Pattern (EIP-1967)

**Problem**: Function selector collisions between proxy admin functions and logic functions.

**Example conflict**:

```solidity
// Proxy has: upgradeTo(address)
// Logic has: upgradeTo(address) for different purpose
// Which one gets called?
```

**Solution**: Use standardized storage slots for proxy data to avoid collisions.

**Implementation**:

```solidity
contract TransparentProxy {
    // EIP-1967 standard storage slots (derived from keccak256)
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    constructor(address _logic, address _admin, bytes memory _data) {
        _setImplementation(_logic);
        _setAdmin(_admin);

        if (_data.length > 0) {
            (bool success,) = _logic.delegatecall(_data);
            require(success, "Init failed");
        }
    }

    modifier ifAdmin() {
        if (msg.sender == _getAdmin()) {
            _;
        } else {
            _fallback();
        }
    }

    function upgradeTo(address newImplementation) external ifAdmin {
        _setImplementation(newImplementation);
    }

    function admin() external ifAdmin returns (address) {
        return _getAdmin();
    }

    function implementation() external ifAdmin returns (address) {
        return _getImplementation();
    }

    function _getAdmin() private view returns (address adm) {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            adm := sload(slot)
        }
    }

    function _setAdmin(address newAdmin) private {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            sstore(slot, newAdmin)
        }
    }

    function _getImplementation() private view returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    function _setImplementation(address newImplementation) private {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
    }

    fallback() external payable {
        _fallback();
    }

    receive() external payable {
        _fallback();
    }

    function _fallback() private {
        address impl = _getImplementation();

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())

            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
```

**Behavior**:
- If `msg.sender == admin`: Admin functions execute
- If `msg.sender != admin`: Calls delegated to logic contract

**Energy cost**:
- `SLOAD` from special slot: 50 energy
- `DELEGATECALL`: 40 base + logic execution energy

### 6.1.6 Initializer Pattern (Constructor Alternative)

**Problem**: Logic contracts are deployed via CREATE, which runs their constructor. But constructor logic doesn't run when called via DELEGATECALL.

**Solution**: Use initializer function instead of constructor.

```solidity
contract LogicContract {
    address public owner;
    bool private _initialized;

    // DON'T use constructor
    // constructor(address _owner) {
    //     owner = _owner;
    // }

    // DO use initializer
    function initialize(address _owner) external {
        require(!_initialized, "Already initialized");
        _initialized = true;
        owner = _owner;
    }

    function setValue(uint256 value) external {
        require(owner == msg.sender, "Not owner");
        // ...
    }
}
```

**Pattern**:

1. Deploy proxy
2. Deploy logic
3. Call `initialize()` on proxy (executed in logic via DELEGATECALL)

**Deployment script**:

```javascript
// 1. Deploy logic
const logic = await tronWeb.contract().new({
    abi: logicABI,
    bytecode: logicBytecode
});

// 2. Prepare initialization data
const initData = logic.initialize(ownerAddress).encodeABI();

// 3. Deploy proxy with initialization
const proxy = await tronWeb.contract().new({
    abi: proxyABI,
    bytecode: proxyBytecode,
    parameters: [logic.address, adminAddress, initData]
});

console.log('Proxy deployed and initialized at:', proxy.address);
```

### 6.1.7 Upgrade Safety Checklist

Before upgrading logic contracts:

- [ ] **Storage layout preserved**: New variables only appended, not reordered
- [ ] **Initializer protection**: New initialize function checks if already called
- [ ] **Test on testnet first**: Deploy to Nile/Shasta before mainnet
- [ ] **Verify state migration**: Ensure existing data works with new logic
- [ ] **Check function signatures**: No selector collisions
- [ ] **Audit external calls**: New logic doesn't introduce reentrancy
- [ ] **Gas estimation**: New logic doesn't exceed block energy limit
- [ ] **Emergency plan**: Prepare rollback if upgrade fails
- [ ] **Communication**: Notify users of upgrade and changes
- [ ] **Monitor**: Watch transactions after upgrade for anomalies

---

## 6.2 Resource Subsidization Strategies

Making your dApp free to use for end users.

### 6.2.1 Full Subsidization (0% consume_user_resource_percent)

**Approach**: Contract creator pays all energy costs.

**Configuration**:

```javascript
await tronWeb.transactionBuilder.updateSetting(
    contractAddress,
    0  // User pays 0%, creator pays 100%
);
```

**Requirements**:

1. **Sufficient frozen energy**: Calculate daily needs
2. **High origin_energy_limit**: Must cover peak transaction energy

**Cost analysis**:

```javascript
// Calculate required frozen TRX
const dailyTransactions = 10000;
const energyPerTx = 50000;
const dailyEnergy = dailyTransactions * energyPerTx;  // 500,000,000

// Get network parameters
const params = await tronWeb.trx.getChainParameters();
const totalEnergyLimit = params.find(p => p.key === 'getTotalEnergyCurrentLimit').value;
const totalEnergyWeight = params.find(p => p.key === 'getTotalEnergyWeight').value;

// Calculate required frozen TRX
const energyPerTRX = totalEnergyLimit / totalEnergyWeight;
const requiredTRX = dailyEnergy / energyPerTRX;

console.log(`Required frozen TRX: ${(requiredTRX / 1e6).toLocaleString()}`);
// Example output: Required frozen TRX: 15,000 TRX (for 500M daily energy)
```

**Pros**:
- Best user experience (free transactions)
- No onboarding friction

**Cons**:
- High capital requirements (frozen TRX)
- Vulnerable to spam attacks

### 6.2.2 Partial Subsidization (Shared Cost Model)

**Approach**: Split costs between creator and users.

**Configuration**:

```javascript
await tronWeb.transactionBuilder.updateSetting(
    contractAddress,
    30  // User pays 30%, creator pays 70%
);
```

**Example scenario**:

```
Transaction: 100,000 energy
- Creator pays: 70,000 (70%)
- User pays: 30,000 (30%)

If user has 20,000 frozen energy:
- Used from frozen: 20,000
- Burned as TRX: 10,000 × 420 = 4,200,000 sun = 4.2 TRX
```

**Use case**: Balance between user experience and cost control.

### 6.2.3 Resource Pool Pattern

**Approach**: Centralized energy pool that lends resources to users temporarily.

**Architecture**:

```solidity
contract ResourcePool {
    address public owner;

    // Track delegations
    struct Delegation {
        address user;
        uint256 amount;
        uint64 lockUntil;
        bool active;
    }

    Delegation[] public delegations;
    mapping(address => uint256) public userDelegation;  // user => delegation index

    constructor() {
        owner = msg.sender;
    }

    // Delegate energy to user
    function delegateToUser(address user, uint256 amount, uint64 lockPeriod) external {
        require(msg.sender == owner, "Not owner");
        require(userDelegation[user] == 0, "Already delegated");

        // Call precompiled contract to delegate resource
        // Contract: 0x000000000000000000000000000000000000100000f
        (bool success,) = address(0x000000000000000000000000000000000000100000f).call(
            abi.encodeWithSignature(
                "delegateResource(address,uint256,uint8)",
                user,
                amount,
                1  // 1 = ENERGY
            )
        );
        require(success, "Delegation failed");

        delegations.push(Delegation({
            user: user,
            amount: amount,
            lockUntil: uint64(block.timestamp) + lockPeriod,
            active: true
        }));

        userDelegation[user] = delegations.length;  // 1-indexed
    }

    // Reclaim delegation after lock period
    function reclaimFromUser(address user) external {
        require(msg.sender == owner, "Not owner");
        uint256 index = userDelegation[user];
        require(index > 0, "No delegation");

        Delegation storage delegation = delegations[index - 1];
        require(delegation.active, "Not active");
        require(block.timestamp >= delegation.lockUntil, "Still locked");

        // Undelegate via precompiled contract
        // Contract: 0x0000000000000000000000000000000000001000011
        (bool success,) = address(0x0000000000000000000000000000000000001000011).call(
            abi.encodeWithSignature(
                "unDelegateResource(address,uint256,uint8)",
                user,
                delegation.amount,
                1  // 1 = ENERGY
            )
        );
        require(success, "Undelegation failed");

        delegation.active = false;
        delete userDelegation[user];
    }

    // Emergency reclaim (force undelegate)
    function emergencyReclaim(address user) external {
        require(msg.sender == owner, "Not owner");
        uint256 index = userDelegation[user];
        require(index > 0, "No delegation");

        Delegation storage delegation = delegations[index - 1];
        require(delegation.active, "Not active");

        // Check if can undelegate via precompiled contract
        // Contract: 0x0000000000000000000000000000000000001000011
        (bool success, bytes memory data) = address(0x0000000000000000000000000000000000001000011)
            .call(
                abi.encodeWithSignature(
                    "checkUnDelegateResource(address,uint256,uint8)",
                    user,
                    delegation.amount,
                    1  // 1 = ENERGY
                )
            );

        require(success && abi.decode(data, (bool)), "Cannot undelegate yet");

        // Undelegate
        (success,) = address(0x0000000000000000000000000000000000001000011).call(
            abi.encodeWithSignature(
                "unDelegateResource(address,uint256,uint8)",
                user,
                delegation.amount,
                1
            )
        );
        require(success, "Undelegation failed");

        delegation.active = false;
        delete userDelegation[user];
    }

    // View functions to check delegation status
    function getDelegationInfo(address user) external view returns (
        uint256 amount,
        uint64 lockUntil,
        bool active
    ) {
        uint256 index = userDelegation[user];
        require(index > 0, "No delegation");

        Delegation memory delegation = delegations[index - 1];
        return (delegation.amount, delegation.lockUntil, delegation.active);
    }
}
```

**Usage workflow**:

1. Contract owner freezes large amount of TRX for energy (e.g., 1M TRX)
2. When user needs resources, delegate 50,000 energy for 1 hour
3. User performs transactions using delegated energy
4. After 1 hour (or user finishes), reclaim delegation
5. Reuse same energy pool for next user

**Advantages**:
- Capital efficient (reuse same frozen TRX for multiple users)
- Fine-grained control (delegate per-user)
- Can implement quotas (max energy per user per day)

**Energy costs**:
- `delegateResource`: 10,000 energy
- `unDelegateResource`: 10,000 energy

### 6.2.4 Meta-Transaction Pattern

**Approach**: Users sign transaction intent, relayer pays gas.

**Flow**:

```
1. User creates intent: {function, params, nonce, deadline}
2. User signs intent (off-chain)
3. User sends signature + intent to relayer
4. Relayer wraps in actual transaction and pays energy
5. Contract verifies signature and executes
```

**Implementation**:

```solidity
contract MetaTransaction {
    mapping(address => uint256) public nonces;

    function executeMetaTx(
        address user,
        bytes memory functionSignature,
        uint256 deadline,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public returns (bytes memory) {
        require(block.timestamp <= deadline, "Expired");

        uint256 nonce = nonces[user];

        // Recreate signed message
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                META_TRANSACTION_TYPEHASH,
                user,
                keccak256(functionSignature),
                nonce,
                deadline
            ))
        ));

        // Verify signature
        address signer = ecrecover(digest, v, r, s);
        require(signer == user, "Invalid signature");
        require(signer != address(0), "Invalid signer");

        // Increment nonce
        nonces[user]++;

        // Execute function
        (bool success, bytes memory returnData) = address(this).call(
            abi.encodePacked(functionSignature, user)
        );

        require(success, "Function execution failed");
        return returnData;
    }

    // Business logic functions must accept user parameter
    function transfer(address to, uint256 amount, address user) public {
        // Validate that call came from executeMetaTx
        require(msg.sender == address(this), "Must use meta-tx");

        // Use 'user' as the actual caller
        _transfer(user, to, amount);
    }
}
```

**User client**:

```javascript
// User signs transaction intent (no TRX needed)
const nonce = await contract.nonces(userAddress).call();
const deadline = Math.floor(Date.now() / 1000) + 3600;  // 1 hour from now

const domain = {
    name: 'MetaTransaction',
    version: '1',
    chainId: await tronWeb.trx.getChainID(),
    verifyingContract: contractAddress
};

const types = {
    MetaTransaction: [
        { name: 'user', type: 'address' },
        { name: 'functionSignature', type: 'bytes' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
    ]
};

const functionSig = contract.transfer(recipientAddress, amount, userAddress).encodeABI();

const message = {
    user: userAddress,
    functionSignature: functionSig,
    nonce: nonce,
    deadline: deadline
};

// Sign (off-chain, no gas)
const signature = await tronWeb.trx.signTypedData(domain, types, message, privateKey);

// Send to relayer server
await fetch('https://relayer.example.com/execute', {
    method: 'POST',
    body: JSON.stringify({
        user: userAddress,
        functionSignature: functionSig,
        deadline: deadline,
        signature: signature
    })
});

// Relayer executes transaction and pays gas
```

**Pros**:
- Users don't need TRX or frozen energy
- Flexible (relayer can have business rules)
- Enables "gasless" dApps

**Cons**:
- Requires relayer infrastructure
- Relayer becomes centralization point
- Relayer must have sufficient resources

---

## 6.3 Precompiled Contracts

TRON provides precompiled contracts for computationally expensive operations at reduced energy costs.

### 6.3.1 Standard Cryptographic Functions

**Source**: `actuator/src/main/java/org/tron/core/vm/PrecompiledContracts.java:121-136`

#### **ecrecover (Address 0x01)**

Recovers signer address from signature.

**Energy cost**: 3,000

**Usage**:

```solidity
function verifySignature(
    bytes32 messageHash,
    uint8 v,
    bytes32 r,
    bytes32 s
) public pure returns (address) {
    return ecrecover(messageHash, v, r, s);
}
```

**Example**:

```javascript
// Off-chain: User signs message
const message = "Hello, TRON!";
const messageHash = tronWeb.sha3(message);
const signature = await tronWeb.trx.sign(messageHash, privateKey);

// On-chain: Contract verifies
const signer = await contract.verifySignature(
    messageHash,
    signature.v,
    signature.r,
    signature.s
).call();

console.log('Signer:', signer);
```

#### **sha256 (Address 0x02)**

**Energy cost**: 60 + 12 per 32-byte word

**Usage**:

```solidity
function hashData(bytes memory data) public pure returns (bytes32) {
    return sha256(data);
}
```

**Cost calculation**:

```javascript
// Hash 100 bytes
const words = Math.ceil(100 / 32);  // 4 words
const cost = 60 + (12 * words);  // 60 + 48 = 108 energy
```

#### **ripemd160 (Address 0x03)**

**Energy cost**: 600 + 120 per 32-byte word

```solidity
function hashRIPEMD(bytes memory data) public pure returns (bytes20) {
    return ripemd160(data);
}
```

### 6.3.2 Advanced Cryptography (zkSNARK Support)

#### **bn128Add (Address 0x06) - Elliptic Curve Addition**

**Energy cost**: 150 (post-Istanbul)

**Use case**: zkSNARK verification, privacy-preserving transactions

```solidity
function addPoints(
    uint256 x1, uint256 y1,
    uint256 x2, uint256 y2
) public view returns (uint256, uint256) {
    uint256[4] memory input = [x1, y1, x2, y2];
    uint256[2] memory result;

    assembly {
        if iszero(staticcall(gas(), 0x06, input, 0x80, result, 0x40)) {
            revert(0, 0)
        }
    }

    return (result[0], result[1]);
}
```

#### **bn128Mul (Address 0x07) - Elliptic Curve Scalar Multiplication**

**Energy cost**: 6,000 (post-Istanbul)

```solidity
function multiplyPoint(
    uint256 x, uint256 y,
    uint256 scalar
) public view returns (uint256, uint256) {
    uint256[3] memory input = [x, y, scalar];
    uint256[2] memory result;

    assembly {
        if iszero(staticcall(gas(), 0x07, input, 0x60, result, 0x40)) {
            revert(0, 0)
        }
    }

    return (result[0], result[1]);
}
```

#### **bn128Pairing (Address 0x08) - Pairing Check**

**Energy cost**: 45,000 + 34,000 per pair

**Use case**: zkSNARK verification

```solidity
function verifyProof(
    uint256[2] memory a,
    uint256[2][2] memory b,
    uint256[2] memory c,
    uint256[1] memory input
) public view returns (bool) {
    uint256[24] memory p;

    // Negate public input point
    p[0] = a[0];
    p[1] = a[1];
    p[2] = b[0][0];
    p[3] = b[0][1];
    p[4] = b[1][0];
    p[5] = b[1][1];
    // ... (complex encoding)

    uint256[1] memory result;
    assembly {
        if iszero(staticcall(gas(), 0x08, p, 0x300, result, 0x20)) {
            revert(0, 0)
        }
    }

    return result[0] == 1;
}
```

### 6.3.3 TRON-Specific Precompiled Contracts

#### **FreezeV2 Resource Query (Address 0x0000...100000f)**

**delegatableResource**: Check how much resource can be delegated.

**Energy cost**: ~1,000 (varies)

```solidity
function checkDelegatableEnergy(address account) public view returns (uint256) {
    bytes memory input = abi.encode(account, uint256(1));  // 1 = ENERGY

    (bool success, bytes memory data) = address(0x000000000000000000000000000000000000100000f)
        .staticcall(input);

    require(success, "Query failed");
    return abi.decode(data, (uint256));
}
```

#### **Batch Signature Validation (Address 0x09)**

**Energy cost**: 1,500 per signature (up to 16 signatures)

**Use case**: Multi-sig wallets, batch authorization

```solidity
function batchVerify(
    bytes32[] memory messageHashes,
    bytes[] memory signatures
) public view returns (bool) {
    require(messageHashes.length == signatures.length, "Length mismatch");
    require(messageHashes.length <= 16, "Max 16 signatures");

    bytes memory input;
    for (uint i = 0; i < messageHashes.length; i++) {
        // Parse signature
        bytes memory sig = signatures[i];
        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        // Encode for precompiled contract
        input = abi.encodePacked(input, messageHashes[i], v, r, s);
    }

    (bool success, bytes memory result) = address(0x09).staticcall(input);
    return success && abi.decode(result, (bool));
}
```

**Savings**: Batch validating 10 signatures costs 15,000 energy vs 30,000 using individual ecrecover calls (50% savings).

---

## 6.4 Multi-Contract Architectures

Breaking monolithic contracts into modular components.

### 6.4.1 Library Pattern

**Approach**: Extract reusable logic into libraries, deploy once, use everywhere.

```solidity
// Library contract
library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "Overflow");
        return c;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "Underflow");
        return a - b;
    }
}

// Using contract
contract Token {
    using SafeMath for uint256;

    mapping(address => uint256) public balances;

    function transfer(address to, uint256 amount) public {
        balances[msg.sender] = balances[msg.sender].sub(amount);
        balances[to] = balances[to].add(amount);
    }
}
```

**Deployment**:

```javascript
// 1. Deploy library
const library = await tronWeb.contract().new({
    abi: libraryABI,
    bytecode: libraryBytecode
});

// 2. Link library in token bytecode
const linkedBytecode = tokenBytecode.replace(
    /__SafeMath_________________________/g,  // Placeholder
    library.address.slice(2)  // Remove '0x' prefix
);

// 3. Deploy token with linked library
const token = await tronWeb.contract().new({
    abi: tokenABI,
    bytecode: linkedBytecode
});
```

**Energy savings**:
- Library code not duplicated in each contract
- Shared library deployment amortized across many contracts

### 6.4.2 Factory Pattern

**Approach**: Contract that creates other contracts.

```solidity
contract TokenFactory {
    address[] public tokens;
    mapping(address => address) public tokenOwner;

    event TokenCreated(address indexed token, address indexed owner);

    function createToken(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 initialSupply
    ) public returns (address) {
        // Deploy new token contract
        Token token = new Token(name, symbol, decimals, initialSupply, msg.sender);

        tokens.push(address(token));
        tokenOwner[address(token)] = msg.sender;

        emit TokenCreated(address(token), msg.sender);

        return address(token));
    }

    function getTokenCount() public view returns (uint256) {
        return tokens.length;
    }
}
```

**Benefits**:
- Standardized deployment
- Centralized discovery (all tokens created by factory)
- Can enforce standards

### 6.4.3 Registry Pattern

**Approach**: Central registry mapping names to contract addresses.

```solidity
contract ContractRegistry {
    mapping(bytes32 => address) private contracts;
    address public owner;

    event ContractRegistered(bytes32 indexed name, address indexed contractAddress);

    constructor() {
        owner = msg.sender;
    }

    function register(string memory name, address contractAddress) public {
        require(msg.sender == owner, "Not owner");
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        contracts[nameHash] = contractAddress;
        emit ContractRegistered(nameHash, contractAddress);
    }

    function getContract(string memory name) public view returns (address) {
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        return contracts[nameHash];
    }
}
```

**Usage**:

```solidity
contract DApp {
    ContractRegistry public registry;

    constructor(address _registry) {
        registry = ContractRegistry(_registry);
    }

    function doSomething() public {
        // Lookup current implementation
        address tokenAddress = registry.getContract("TOKEN");
        Token token = Token(tokenAddress);

        // Use token
        token.transfer(msg.sender, 100);
    }
}
```

**Benefits**:
- Easy upgrades (update registry, not all contracts)
- Decouples contracts (reference by name, not hardcoded address)

### 6.4.4 Inter-Contract Communication Patterns

#### **Direct Call (CALL)**

**Energy**: 40 + execution

```solidity
contract ContractA {
    function callB(address contractB, uint256 value) public {
        ContractB(contractB).doSomething(value);
    }
}
```

#### **Delegate Call (DELEGATECALL)**

**Energy**: 40 + execution

```solidity
contract ContractA {
    address public implementation;

    function execute(bytes memory data) public {
        (bool success, bytes memory result) = implementation.delegatecall(data);
        require(success, "Delegatecall failed");
    }
}
```

#### **Static Call (STATICCALL)**

**Energy**: 40 + execution

```solidity
contract ContractA {
    function queryB(address contractB) public view returns (uint256) {
        return ContractB(contractB).getValue();
    }
}
```

**Cost comparison**:

| Pattern | Energy | State Changes | Context |
|---------|--------|---------------|---------|
| CALL | 40 + logic | Target contract | Target |
| DELEGATECALL | 40 + logic | Caller contract | Caller |
| STATICCALL | 40 + logic | None (read-only) | Target |

---

## 6.5 Emergency Stop Mechanisms

Implementing circuit breakers for crisis management.

### 6.5.1 Pausable Pattern

```solidity
contract Pausable {
    bool private _paused;
    address public owner;

    event Paused(address account);
    event Unpaused(address account);

    constructor() {
        owner = msg.sender;
        _paused = false;
    }

    modifier whenNotPaused() {
        require(!_paused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(_paused, "Contract is not paused");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function pause() public onlyOwner whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function paused() public view returns (bool) {
        return _paused;
    }
}

contract Token is Pausable {
    mapping(address => uint256) public balances;

    function transfer(address to, uint256 amount) public whenNotPaused {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }

    function emergencyWithdraw() public whenPaused onlyOwner {
        // Allow owner to rescue funds when paused
        uint256 balance = address(this).balance;
        payable(owner).transfer(balance);
    }
}
```

### 6.5.2 Circuit Breaker Pattern

**Approach**: Automatic pause when abnormal conditions detected.

```solidity
contract CircuitBreaker {
    bool public breaker;
    uint256 public threshold;
    uint256 public withdrawalsToday;
    uint256 public lastResetTime;
    address public owner;

    constructor(uint256 _threshold) {
        owner = msg.sender;
        threshold = _threshold;
        lastResetTime = block.timestamp;
    }

    modifier stopInEmergency() {
        require(!breaker, "Circuit breaker triggered");
        _;
    }

    modifier onlyInEmergency() {
        require(breaker, "No emergency");
        _;
    }

    function withdraw(uint256 amount) public stopInEmergency {
        // Reset daily counter if needed
        if (block.timestamp >= lastResetTime + 1 days) {
            withdrawalsToday = 0;
            lastResetTime = block.timestamp;
        }

        // Check if withdrawal would exceed threshold
        if (withdrawalsToday + amount > threshold) {
            breaker = true;
            emit CircuitBreakerTriggered(msg.sender, amount);
            revert("Withdrawal limit exceeded, circuit breaker activated");
        }

        // Process withdrawal
        withdrawalsToday += amount;
        _processWithdrawal(msg.sender, amount);
    }

    function resetBreaker() public onlyInEmergency {
        require(msg.sender == owner, "Not owner");
        breaker = false;
        emit CircuitBreakerReset(owner);
    }

    event CircuitBreakerTriggered(address indexed user, uint256 amount);
    event CircuitBreakerReset(address indexed admin);
}
```

### 6.5.3 Rate Limiting

```solidity
contract RateLimited {
    mapping(address => uint256) public lastAction;
    uint256 public cooldown = 1 hours;

    modifier rateLimit() {
        require(
            block.timestamp >= lastAction[msg.sender] + cooldown,
            "Rate limit exceeded"
        );
        lastAction[msg.sender] = block.timestamp;
        _;
    }

    function sensitiveFunctionOperation() public rateLimit {
        // Protected function
    }
}
```

---

## 6.6 Code Laboratory

### Exercise 6.1: Build a Transparent Proxy System

Create a complete proxy system with:
- Transparent proxy contract
- Two logic versions
- Admin controls
- Storage safety validation

**Objectives**:
1. Deploy proxy + logic V1
2. Initialize contract state
3. Perform upgrade to V2
4. Verify state preservation
5. Test admin access control

### Exercise 6.2: Implement Resource Pool Manager

Build a resource pool that:
- Delegates energy to users
- Tracks usage and quotas
- Automatically reclaims after timeout
- Provides usage analytics

### Exercise 6.3: Create Meta-Transaction Relayer

Develop:
- Smart contract with meta-tx support
- Off-chain signature generation
- Relayer service (Node.js)
- Nonce management
- Deadline validation

---

## 6.7 Production Checklist

### Proxy Patterns
- [ ] Storage layout documented for all versions
- [ ] Initializer functions protected against re-initialization
- [ ] Admin controls use multi-sig or timelock
- [ ] Upgrade process tested on testnet
- [ ] Rollback plan prepared
- [ ] Storage collision risks audited

### Resource Subsidization
- [ ] Energy requirements calculated for peak load
- [ ] Sufficient TRX frozen for energy
- [ ] `origin_energy_limit` set appropriately
- [ ] Monitoring for resource exhaustion
- [ ] Spam protection implemented
- [ ] Cost projections vs actual usage tracked

### Security
- [ ] All contracts audited by third party
- [ ] Emergency stop mechanisms tested
- [ ] Access controls properly implemented
- [ ] Reentrancy protections in place
- [ ] Input validation on all public functions
- [ ] Rate limiting for sensitive operations

### Multi-Contract Systems
- [ ] Inter-contract dependencies documented
- [ ] Contract registry maintained
- [ ] Version compatibility verified
- [ ] Gas costs optimized for cross-contract calls
- [ ] Failure modes handled gracefully

---

## 6.8 Common Pitfalls

### Pitfall 1: Storage Collision in Proxies

**Problem**: Reordering storage variables breaks proxy pattern.

**Solution**: Always append new variables, never reorder or insert.

### Pitfall 2: Constructor in Logic Contracts

**Problem**: Constructor runs during deployment, not via DELEGATECALL.

**Solution**: Use `initialize()` function pattern.

### Pitfall 3: Unprotected Initializers

**Problem**: Initializer can be called multiple times.

**Solution**: Add `_initialized` flag and check.

### Pitfall 4: Insufficient origin_energy_limit

**Problem**: Subsidization fails mid-transaction, user pays unexpectedly.

**Solution**: Set limit to 2x average transaction energy.

### Pitfall 5: Forgetting Context in DELEGATECALL

**Problem**: Logic contract expects its own storage layout.

**Solution**: Always maintain matching storage layout between proxy and logic.

---

## 6.9 Quick Reference

### Proxy Pattern Energy Costs

| Operation | Energy | Notes |
|-----------|--------|-------|
| DELEGATECALL | 40 | Plus logic execution |
| Upgrade (SSTORE) | 20,000 | First time |
| Upgrade (modify) | 5,000 | Subsequent |
| Initialize | Varies | Logic-dependent |

### Precompiled Contract Addresses

| Name | Address | Energy |
|------|---------|--------|
| ecrecover | 0x01 | 3,000 |
| sha256 | 0x02 | 60 + 12/word |
| ripemd160 | 0x03 | 600 + 120/word |
| bn128Add | 0x06 | 150 |
| bn128Mul | 0x07 | 6,000 |
| bn128Pairing | 0x08 | 45,000 + 34,000/pair |
| batchValidateSign | 0x09 | 1,500/signature |

### Subsidization Models

| Model | Creator Cost | User Cost | Use Case |
|-------|--------------|-----------|----------|
| Full (0%) | 100% | 0% | Onboarding |
| Shared (30%) | 70% | 30% | Balanced |
| Minimal (80%) | 20% | 80% | Utility |
| None (100%) | 0% | 100% | Public goods |

---

## 6.10 What's Next?

You now understand:
- ✅ Proxy patterns for safe upgrades
- ✅ DELEGATECALL mechanics
- ✅ Resource subsidization strategies
- ✅ Precompiled contracts for efficiency
- ✅ Multi-contract architectures
- ✅ Emergency mechanisms
- ✅ Advanced security patterns

In **Chapter 7: Resource Monitoring and Alerting**, we'll explore:
- Real-time monitoring dashboards
- Alerting systems for resource exhaustion
- Predictive analytics for capacity planning
- Integration with incident response tools
- Cost tracking and optimization
- SLA management for production systems

The goal: Build observable, reliable systems that detect and respond to issues before users are impacted.

---

**[End of Chapter 6]**
