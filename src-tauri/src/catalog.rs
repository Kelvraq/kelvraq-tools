use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Section {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) paths: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Catalog {
    pub(crate) pins: Vec<String>,
    pub(crate) applications: Vec<String>,
    pub(crate) sections: Vec<Section>,
    pub(crate) icons: std::collections::HashMap<String, String>,
    pub(crate) recent: Vec<String>,
    pub(crate) view: String,
}
