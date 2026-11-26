// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title LGtieBilling
/// @notice How LGtie earns revenue, with no server and no custody. Two ways to pay, both in a 6-decimal dollar token (USDT):
///         1. a small fee for each case opened, paid by whoever submits the opening transaction;
///         2. a subscription (plan 1 "Business", plan 2 "Pro"): a business pays once for a period, and its cases opened under its own
///            agreements are then free, up to a monthly allowance. Past the allowance the per-case fee applies again.
///         Every payment goes straight from the payer to the treasury in the same transaction. This contract never holds tokens or OKB.
/// @dev Safeguards: prices can be changed by the owner, but only within hard caps fixed in the code (a later price rise cannot exceed them,
///      and the per-case fee can be set to zero). Only the case contract, set once, can charge, and a charge can only take the fee from the
///      account that is already submitting the opening transaction. A business that does not pay therefore cannot stop a customer from
///      opening a case. Ownership moves in two steps. Unaudited.
contract LGtieBilling {
    struct Plan { uint128 monthPrice; uint128 yearPrice; uint32 monthlyCases; }
    struct Sub { uint8 plan; uint64 expiry; uint64 windowStart; uint32 used; }

    uint256 public constant MAX_CASE_FEE = 10e6;        // 10 dollars
    uint256 public constant MAX_MONTH_PRICE = 500e6;    // 500 dollars
    uint256 public constant MAX_YEAR_PRICE = 5000e6;    // 5,000 dollars
    uint32 public constant MAX_MONTHLY_CASES = 10000;
    uint64 public constant MONTH = 30 days;
    uint64 public constant YEAR = 365 days;
    uint8 public constant PLANS = 2;

    IERC20Min public immutable token;
    address public owner;
    address public pendingOwner;
    address public treasury;
    address public cases;          // the case contract allowed to charge; set once
    uint256 public caseFee;
    mapping(uint8 => Plan) public plans;
    mapping(address => Sub) private subs;

    event Subscribed(address indexed business, uint8 plan, bool yearly, uint256 paid, uint64 expiry);
    event CaseCovered(address indexed business, uint32 usedThisMonth);
    event CaseFeePaid(address indexed business, address indexed payer, uint256 fee);
    event CaseFeeSet(uint256 fee);
    event PlanSet(uint8 indexed plan, uint128 monthPrice, uint128 yearPrice, uint32 monthlyCases);
    event TreasurySet(address treasury);
    event CasesSet(address cases);
    event OwnershipTransferStarted(address indexed to);
    event OwnershipTransferred(address indexed to);

    modifier onlyOwner() { require(msg.sender == owner, "only the owner"); _; }

    constructor(IERC20Min t, address treasury_, uint256 caseFee_, Plan memory p1, Plan memory p2) {
        require(address(t) != address(0), "no token");
        token = t; owner = msg.sender;
        _setTreasury(treasury_); _setCaseFee(caseFee_); _setPlan(1, p1); _setPlan(2, p2);
    }

    // ---------- paying ----------
    /// @notice Buy or extend a subscription for the caller. Same plan while active: time is added. A higher plan while active: it starts now
    ///         (the time left on the lower plan is not refunded). A lower plan while active is refused: wait for it to end.
    function subscribe(uint8 plan, bool yearly) external {
        require(plan >= 1 && plan <= PLANS, "unknown plan");
        Plan memory p = plans[plan];
        uint256 price = yearly ? p.yearPrice : p.monthPrice;
        require(price != 0, "plan not for sale");
        Sub storage s = subs[msg.sender];
        uint64 length = yearly ? YEAR : MONTH;
        if (s.expiry > block.timestamp && plan == s.plan) {
            s.expiry += length;
        } else {
            require(s.expiry <= block.timestamp || plan > s.plan, "finish your current plan first");
            s.plan = plan; s.expiry = uint64(block.timestamp) + length; s.windowStart = uint64(block.timestamp); s.used = 0;
        }
        _pull(msg.sender, price);
        emit Subscribed(msg.sender, plan, yearly, price, s.expiry);
    }

    /// @notice Called by the case contract when a case is opened. `business` is the party whose subscription may cover it; `payer` is whoever
    ///         submitted the opening transaction and pays the per-case fee if the subscription does not cover it.
    function charge(address business, address payer) external {
        require(msg.sender == cases && cases != address(0), "only the case contract");
        Sub storage s = subs[business];
        if (s.expiry > block.timestamp) {
            if (block.timestamp >= uint256(s.windowStart) + MONTH) {   // roll the monthly allowance forward
                s.windowStart += uint64(((block.timestamp - s.windowStart) / MONTH) * MONTH);
                s.used = 0;
            }
            if (s.used < plans[s.plan].monthlyCases) { s.used++; emit CaseCovered(business, s.used); return; }
        }
        uint256 fee = caseFee;
        if (fee != 0) _pull(payer, fee);
        emit CaseFeePaid(business, payer, fee);
    }

    // ---------- reading ----------
    /// @return plan 0 if none, expiry, active now, cases used and left in the current month (0 left if not active)
    function statusOf(address business) external view returns (uint8 plan, uint64 expiry, bool active, uint32 used, uint32 left) {
        Sub storage s = subs[business];
        plan = s.plan; expiry = s.expiry; active = s.expiry > block.timestamp;
        if (!active) return (plan, expiry, false, 0, 0);
        used = s.used;
        if (block.timestamp >= uint256(s.windowStart) + MONTH) used = 0;
        uint32 q = plans[s.plan].monthlyCases;
        left = used >= q ? 0 : q - used;
    }

    // ---------- the owner's controls, all within the hard caps ----------
    function setCaseFee(uint256 fee) external onlyOwner { _setCaseFee(fee); }
    function setPlan(uint8 id, Plan calldata p) external onlyOwner { _setPlan(id, p); }
    function setTreasury(address t) external onlyOwner { _setTreasury(t); }
    function setCases(address c) external onlyOwner {
        require(cases == address(0), "already set"); require(c != address(0), "zero address");
        cases = c; emit CasesSet(c);
    }
    function transferOwnership(address to) external onlyOwner { pendingOwner = to; emit OwnershipTransferStarted(to); }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner && msg.sender != address(0), "not the pending owner");
        owner = msg.sender; pendingOwner = address(0); emit OwnershipTransferred(msg.sender);
    }

    // ---------- internals ----------
    function _setCaseFee(uint256 fee) private { require(fee <= MAX_CASE_FEE, "above the fee cap"); caseFee = fee; emit CaseFeeSet(fee); }
    function _setPlan(uint8 id, Plan memory p) private {
        require(id >= 1 && id <= PLANS, "unknown plan");
        require(p.monthPrice <= MAX_MONTH_PRICE && p.yearPrice <= MAX_YEAR_PRICE && p.monthlyCases <= MAX_MONTHLY_CASES, "above a cap");
        plans[id] = p; emit PlanSet(id, p.monthPrice, p.yearPrice, p.monthlyCases);
    }
    function _setTreasury(address t) private { require(t != address(0), "zero treasury"); treasury = t; emit TreasurySet(t); }

    /// @dev Moves tokens straight from the payer to the treasury. Accepts tokens that return nothing as well as ones that return true.
    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, treasury, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "payment failed (check your balance and approval)");
    }
}
