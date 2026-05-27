//! PendingKind — 서명-only / 미체결 entry 의 4 가지 형태.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use crate::position::PerpSide;
use crate::primitives::{Address, MarketRef, Price, Time, U256, VenueRef};
use crate::token::TokenRef;

/// UniswapX / CowSwap / 1inch Fusion 등 오프체인 매칭 주문의 종류.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum OrderKind {
    Dutch,
    Limit,
    Rfq,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum PerpOrderKind {
    Limit,
    StopMarket,
    StopLimit,
    TakeProfit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingKind {
    /// UniswapX, CowSwap, 1inch Fusion, Bebop, OKX RFQ 등.
    OffchainLimitOrder {
        venue: VenueRef,
        sell: TokenRef,
        buy: TokenRef,
        #[tsify(type = "string")]
        sell_max: U256,
        #[tsify(type = "string")]
        buy_min: U256,
        order_kind: OrderKind,
    },

    /// PerpDEX 미체결 리밋.
    PerpVenueOrder {
        venue: VenueRef,
        market: MarketRef,
        side: PerpSide,
        #[tsify(type = "string")]
        size_base: U256,
        price: Price,
        order_kind: PerpOrderKind,
        reduce_only: bool,
    },

    /// 서명만 발급된 Permit2 — 잠재적 spend cap.
    SignedPermit2 {
        token: TokenRef,
        #[tsify(type = "string")]
        spender: Address,
        #[tsify(type = "string")]
        amount: U256,
        expires_at: Time,
        #[tsify(type = "[string, number]")]
        nonce: (U256, u8), // (word, bit)
    },

    /// EIP-2612 (USDC, DAI 등).
    SignedEIP2612 {
        token: TokenRef,
        #[tsify(type = "string")]
        spender: Address,
        #[tsify(type = "string")]
        amount: U256,
        expires_at: Time,
        #[tsify(type = "string")]
        nonce: U256,
    },
}
