use serde::{Deserialize, Deserializer, Serialize};
use tsify_next::Tsify;

use simulation_state::primitives::{Address, Time, U256};
use simulation_state::token::TokenRef;
use simulation_state::LiveField;

fn time_from_str_or_num_saturating<'de, D>(deserializer: D) -> Result<Time, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error as _;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Num(u64),
        Str(String),
    }

    let secs = match StrOrNum::deserialize(deserializer)? {
        StrOrNum::Num(n) => n,
        StrOrNum::Str(s) => parse_u64_saturating(&s).map_err(D::Error::custom)?,
    };
    Ok(Time::from_unix(secs))
}

fn parse_u64_saturating(s: &str) -> Result<u64, String> {
    let trimmed = s.trim_start_matches('0');
    if trimmed.is_empty() {
        return Ok(0);
    }
    if !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("Time from string {s:?}: invalid decimal"));
    }

    let max = u64::MAX.to_string();
    if trimmed.len() > max.len() || (trimmed.len() == max.len() && trimmed > max.as_str()) {
        return Ok(u64::MAX);
    }
    trimmed
        .parse::<u64>()
        .map_err(|error| format!("Time from string {s:?}: {error}"))
}

/// `ERC20` `EIP-2612` `permit` — gasless allowance granted via off-chain signature.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Erc20PermitAction {
    /// Token whose `permit` is being signed.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Allowance amount.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Signature expiration timestamp.
    #[serde(deserialize_with = "time_from_str_or_num_saturating")]
    pub deadline: Time,
    /// Current `permit` nonce on the token contract.
    #[tsify(type = "LiveField<string>")]
    pub nonce: LiveField<U256>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn erc20_permit_deadline_accepts_uint256_decimal_strings() {
        let action: Erc20PermitAction = serde_json::from_value(json!({
            "token": {
                "key": {
                    "standard": "erc20",
                    "chain": "eip155:1",
                    "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
                }
            },
            "spender": "0xc36442b4a4522e871399cd717abdd847ab11fe88",
            "amount": "1",
            "deadline": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            "nonce": {
                "value": "0",
                "source": { "kind": "user_supplied" },
                "synced_at": 0
            }
        }))
        .expect("uint256 permit deadlines should deserialize");

        assert_eq!(action.deadline.as_unix(), u64::MAX);
    }
}
