//! Application launchers are references to existing files, never installed copies.
use crate::{err, local, Result};
use std::path::Path;

pub fn validate(path: &str) -> Result<()> {
    let path = local(path)?;
    let extension = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if !["exe", "lnk", "appref-ms"].contains(&extension.as_str()) {
        return Err("Выберите приложение .exe или ярлык Windows .lnk".into());
    }
    if !path.is_file() {
        return Err("Приложение или ярлык не найдены".into());
    }
    Ok(())
}

pub fn launch(path: &str) -> Result<()> {
    validate(path)?;
    // ShellExecute preserves shortcut arguments and working-directory settings.
    open::that(Path::new(path)).map_err(err)
}

pub fn pick() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Добавить приложения")
        .add_filter("Приложения и ярлыки", &["exe", "lnk", "appref-ms"])
        .pick_files()
        .unwrap_or_default()
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_scripts_and_missing_launchers() {
        for path in [
            r"C:\test.cmd",
            r"C:\test.ps1",
            r"C:\missing-kelvraq.exe",
            "relative.exe",
        ] {
            assert!(validate(path).is_err());
        }
    }
}
