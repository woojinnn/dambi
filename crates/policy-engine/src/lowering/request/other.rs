//! `Action::Other` to `PolicyRequest` conversion.

use crate::core::OtherAction;
use crate::policy::PolicyRequest;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OtherContext<'a> {
    selector: &'a str,
    target: &'a str,
    value_wei: &'a str,
    raw_calldata: &'a str,
}

pub(super) fn request(action: &OtherAction) -> PolicyRequest {
    let principal = format!(r#"Wallet::"{}""#, action.actor.as_str());
    let action_uid = r#"Action::"other""#.to_string();
    let resource = r#"Protocol::"unknown""#.to_string();
    let entities = json!([
        { "uid": { "type": "Wallet",   "id": action.actor.as_str() },   "attrs": {}, "parents": [] },
        { "uid": { "type": "Protocol", "id": "unknown" },   "attrs": {}, "parents": [] },
    ]);
    PolicyRequest::new(principal, action_uid, resource, entities, context(action))
}

fn context(action: &OtherAction) -> Value {
    let context = OtherContext {
        selector: &action.selector,
        target: action.target.as_str(),
        value_wei: &action.value_wei,
        raw_calldata: &action.raw_calldata,
    };
    serde_json::to_value(context).expect("other context serializes")
}
