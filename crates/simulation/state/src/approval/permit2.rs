//! Permit2 — block-level allowance (token, spender) 의 expiration / nonce.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use crate::primitives::{Time, U256};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Permit2Allowance {
    #[tsify(type = "string")]
    pub amount: U256,
    pub expiration: Time,
    pub nonce: u32,
}
