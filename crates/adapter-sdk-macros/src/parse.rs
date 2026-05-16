//! Parse `#[adapter(...)]` arguments into a structured `AdapterArgs`.
//!
//! Design note: we do NOT route values through `syn::Expr`. `Expr` parsing
//! fails on a brace literal like `{ chain: 1, ... }` because Rust treats
//! `chain:` as a labeled-loop label, and the int literal after the colon is
//! not a valid loop construct. Instead, the top-level parser dispatches per
//! key name and consumes value tokens with the appropriate primitive parser
//! (`LitStr`, `bracketed!`, etc.). Brace entries are parsed via a dedicated
//! `ChainAddrEntry: Parse` impl using `braced!` + `Ident` + `Token![:]`.

use proc_macro2::{Span, TokenStream};
use syn::parse::{Parse, ParseStream};
use syn::{braced, bracketed, Error, Ident, LitInt, LitStr, Result, Token};

pub struct AdapterArgs {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub capabilities: Vec<String>,
    pub applies_to: Vec<(u64, String)>,
    pub factory_of: Vec<(u64, String)>,
    pub proxy_of: Vec<(u64, String)>,
}

pub fn parse_args(input: TokenStream) -> Result<AdapterArgs> {
    syn::parse2(input)
}

impl Parse for AdapterArgs {
    fn parse(input: ParseStream) -> Result<Self> {
        let mut name = None;
        let mut version = None;
        let mut description = None;
        let mut author = None;
        let mut homepage = None;
        let mut capabilities = Vec::new();
        let mut applies_to = Vec::new();
        let mut factory_of = Vec::new();
        let mut proxy_of = Vec::new();

        while !input.is_empty() {
            let key: Ident = input.parse()?;
            input.parse::<Token![=]>()?;
            match key.to_string().as_str() {
                "name" => name = Some(input.parse::<LitStr>()?.value()),
                "version" => version = Some(input.parse::<LitStr>()?.value()),
                "description" => description = Some(input.parse::<LitStr>()?.value()),
                "author" => author = Some(input.parse::<LitStr>()?.value()),
                "homepage" => homepage = Some(input.parse::<LitStr>()?.value()),
                "capabilities" => capabilities = parse_ident_array(input)?,
                "applies_to" => applies_to = parse_chain_addr_array(input, "address")?,
                "factory_of" => factory_of = parse_chain_addr_array(input, "factory")?,
                "proxy_of" => proxy_of = parse_chain_addr_array(input, "implementation")?,
                other => return Err(Error::new(key.span(), format!("unknown key `{other}`"))),
            }
            if !input.is_empty() {
                input.parse::<Token![,]>()?;
            }
        }

        Ok(AdapterArgs {
            name: name.ok_or_else(|| Error::new(Span::call_site(), "missing `name`"))?,
            version: version
                .ok_or_else(|| Error::new(Span::call_site(), "missing `version`"))?,
            description: description
                .ok_or_else(|| Error::new(Span::call_site(), "missing `description`"))?,
            author,
            homepage,
            capabilities,
            applies_to,
            factory_of,
            proxy_of,
        })
    }
}

fn parse_ident_array(input: ParseStream) -> Result<Vec<String>> {
    let content;
    bracketed!(content in input);
    let mut out = Vec::new();
    while !content.is_empty() {
        let id: Ident = content.parse()?;
        out.push(id.to_string());
        if !content.is_empty() {
            content.parse::<Token![,]>()?;
        }
    }
    Ok(out)
}

fn parse_chain_addr_array(input: ParseStream, addr_field: &str) -> Result<Vec<(u64, String)>> {
    let content;
    bracketed!(content in input);
    let mut out = Vec::new();
    while !content.is_empty() {
        let entry: ChainAddrEntry = content.parse()?;
        out.push(entry.into_pair(addr_field)?);
        if !content.is_empty() {
            content.parse::<Token![,]>()?;
        }
    }
    Ok(out)
}

/// `{ chain: 1, address: "0x..." }`-style attribute entry.
struct ChainAddrEntry {
    fields: Vec<(Ident, EntryValue)>,
}

enum EntryValue {
    Int(LitInt),
    Str(LitStr),
}

impl Parse for ChainAddrEntry {
    fn parse(input: ParseStream) -> Result<Self> {
        let content;
        braced!(content in input);
        let mut fields = Vec::new();
        while !content.is_empty() {
            let key: Ident = content.parse()?;
            content.parse::<Token![:]>()?;
            let value = if content.peek(LitInt) {
                EntryValue::Int(content.parse()?)
            } else if content.peek(LitStr) {
                EntryValue::Str(content.parse()?)
            } else {
                return Err(content.error("expected integer or string literal"));
            };
            fields.push((key, value));
            if !content.is_empty() {
                content.parse::<Token![,]>()?;
            }
        }
        Ok(Self { fields })
    }
}

impl ChainAddrEntry {
    fn into_pair(self, addr_field: &str) -> Result<(u64, String)> {
        let mut chain: Option<u64> = None;
        let mut addr: Option<String> = None;
        for (key, value) in self.fields {
            let key_str = key.to_string();
            match key_str.as_str() {
                "chain" => match value {
                    EntryValue::Int(n) => chain = Some(n.base10_parse()?),
                    _ => return Err(Error::new(key.span(), "`chain` must be an integer")),
                },
                k if k == addr_field => match value {
                    EntryValue::Str(s) => addr = Some(s.value().to_lowercase()),
                    _ => return Err(Error::new(
                        key.span(),
                        format!("`{addr_field}` must be a string"),
                    )),
                },
                _ => return Err(Error::new(key.span(), format!("unknown field `{key}`"))),
            }
        }
        Ok((
            chain.ok_or_else(|| Error::new(Span::call_site(), "missing `chain`"))?,
            addr.ok_or_else(|| {
                Error::new(Span::call_site(), format!("missing `{addr_field}`"))
            })?,
        ))
    }
}
