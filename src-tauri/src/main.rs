#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod applications;
mod search;
mod shell_icons;
use base64::Engine;
use notify::{RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

use catalog::Catalog;
mod catalog;
struct Store {
    catalog: Mutex<Catalog>,
    file: PathBuf,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn local(s: &str) -> Result<PathBuf> {
    let p = PathBuf::from(s);
    if !p.is_absolute() || s.contains('\0') || s.starts_with(r"\\.\") || s.starts_with(r"\\?\") {
        return Err("Некорректный путь".into());
    }
    Ok(p)
}
fn valid_name(s: &str) -> Result<()> {
    if s.is_empty()
        || s.trim() != s
        || s.ends_with('.')
        || s.chars().any(|c| c < ' ' || r#"\/:*?"<>|"#.contains(c))
    {
        return Err("Недопустимое имя".into());
    }
    let stem = s.split('.').next().unwrap_or("").to_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("Недопустимое имя".into());
    }
    Ok(())
}
fn save(store: &Store, c: &Catalog) -> Result<()> {
    if let Some(parent) = store.file.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let temp = store.file.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(c).map_err(err)?).map_err(err)?;
    fs::rename(temp, &store.file).map_err(err)
}
fn arg(args: &[Value], i: usize) -> Result<&str> {
    args.get(i)
        .and_then(Value::as_str)
        .ok_or("Некорректные параметры".into())
}
fn filename(p: &Path) -> String {
    p.file_name()
        .map(|v| v.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}
fn entry(p: &Path) -> Value {
    match fs::metadata(p) {
        Ok(m) => {
            json!({"path":p,"name":filename(p),"directory":m.is_dir(),"size":m.len(),"modified":m.modified().unwrap_or(SystemTime::UNIX_EPOCH).duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"ext":p.extension().map(|v|format!(".{}",v.to_string_lossy().to_lowercase())).unwrap_or_default()})
        }
        Err(_) => json!({"path":p,"name":filename(p),"directory":false,"missing":true}),
    }
}
fn locations() -> Vec<Value> {
    let mut list = Vec::new();
    for (path, name, icon) in [
        (dirs::desktop_dir(), "Рабочий стол", "home"),
        (dirs::document_dir(), "Документы", "folder"),
        (dirs::download_dir(), "Загрузки", "download"),
        (dirs::picture_dir(), "Изображения", "image"),
    ] {
        if let Some(p) = path {
            list.push(json!({"path":p,"name":name,"icon":icon}));
        }
    }
    for letter in b'A'..=b'Z' {
        let p = format!("{}:\\", letter as char);
        if Path::new(&p).exists() {
            list.push(json!({"path":p,"name":format!("Диск ({}:)",letter as char),"icon":"drive","drive":true}));
        }
    }
    list
}
fn replace_path(p: &str, from: &str, to: &str) -> String {
    if p.eq_ignore_ascii_case(from) || p.to_lowercase().starts_with(&(from.to_lowercase() + "\\")) {
        format!("{}{}", to, &p[from.len()..])
    } else {
        p.into()
    }
}
fn command(app: &tauri::AppHandle, op: &str, args: Vec<Value>) -> Result<Value> {
    let store = app.state::<Store>();
    match op {
        "video_source" => {
            let path = local(arg(&args, 0)?)?.canonicalize().map_err(err)?;
            let extension = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if !path.is_file()
                || !["mp4", "m4v", "webm", "mov", "mkv", "avi"].contains(&extension.as_str())
            {
                return Err("Выберите видеофайл".into());
            }
            app.asset_protocol_scope().allow_file(&path).map_err(err)?;
            Ok(json!(path))
        }
        "search_start" => Ok(json!(app
            .state::<search::Search>()
            .start(arg(&args, 0)?)?)),
        "search_status" => app.state::<search::Search>().status(
            args.first()
                .and_then(Value::as_u64)
                .ok_or("Некорректный поиск")?,
        ),
        "search_cancel" => {
            app.state::<search::Search>().cancel();
            Ok(Value::Null)
        }
        "bootstrap" => Ok(
            json!({"settings":store.catalog.lock().map_err(err)?.clone(),"locations":locations(),"home":dirs::home_dir()}),
        ),
        "pick_applications" => Ok(json!(applications::pick())),
        "add_applications" => {
            let paths: Vec<String> =
                serde_json::from_value(args.first().cloned().ok_or("Нет приложений")?)
                    .map_err(err)?;
            for path in &paths {
                applications::validate(path)?;
            }
            let mut c = store.catalog.lock().map_err(err)?;
            let mut next = c.clone();
            for path in paths {
                if !next
                    .applications
                    .iter()
                    .any(|p| p.eq_ignore_ascii_case(&path))
                {
                    next.applications.push(path);
                }
            }
            if next.applications.len() > 1000 {
                return Err("Слишком много приложений".into());
            }
            save(&store, &next)?;
            *c = next.clone();
            Ok(json!(next))
        }
        "remove_application" => {
            let path = arg(&args, 0)?;
            let mut c = store.catalog.lock().map_err(err)?;
            let mut next = c.clone();
            next.applications.retain(|p| !p.eq_ignore_ascii_case(path));
            save(&store, &next)?;
            *c = next.clone();
            Ok(json!(next))
        }
        "launch_application" => {
            applications::launch(arg(&args, 0)?)?;
            Ok(Value::Null)
        }
        "list" => {
            let p = local(arg(&args, 0)?)?;
            let entries = fs::read_dir(&p)
                .map_err(err)?
                .filter_map(|v| v.ok())
                .filter(|e| {
                    !e.file_name().to_string_lossy().starts_with('$')
                        && e.file_name() != "System Volume Information"
                })
                .map(|v| entry(&v.path()))
                .collect::<Vec<_>>();
            Ok(json!({"path":p,"parent":p.parent().unwrap_or(&p),"entries":entries}))
        }
        "entries" => {
            let list = args
                .first()
                .and_then(Value::as_array)
                .ok_or("Некорректный список")?;
            let mut result = Vec::new();
            for v in list.iter().take(1000) {
                result.push(entry(&local(v.as_str().ok_or("Некорректный путь")?)?));
            }
            Ok(json!(result))
        }
        "pick" => {
            let d = rfd::FileDialog::new().set_title("Добавить в каталог");
            let selected = if arg(&args, 0)? == "file" {
                d.pick_files()
            } else {
                d.pick_folders()
            };
            Ok(json!(selected.unwrap_or_default()))
        }
        "open" => {
            let p = local(arg(&args, 0)?)?;
            open::that(&p).map_err(err)?;
            let text = p.to_string_lossy().into_owned();
            let mut c = store.catalog.lock().map_err(err)?;
            c.recent.retain(|p| p != &text);
            c.recent.insert(0, text);
            c.recent.truncate(100);
            save(&store, &c)?;
            Ok(Value::Null)
        }
        "reveal" => {
            let p = local(arg(&args, 0)?)?;
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", p.display()))
                .spawn()
                .map_err(err)?;
            Ok(Value::Null)
        }
        "mkdir" => {
            let p = local(arg(&args, 0)?)?;
            let name = arg(&args, 1)?;
            valid_name(name)?;
            let target = p.join(name);
            fs::create_dir(&target).map_err(err)?;
            Ok(json!(target))
        }
        "rename" => {
            let from = local(arg(&args, 0)?)?;
            let name = arg(&args, 1)?;
            valid_name(name)?;
            let to = from.parent().ok_or("Нельзя переименовать диск")?.join(name);
            if from == to {
                return Ok(
                    json!({"path":to,"settings":store.catalog.lock().map_err(err)?.clone()}),
                );
            }
            if to.exists() {
                return Err("Такое имя уже существует".into());
            }
            fs::rename(&from, &to).map_err(err)?;
            let a = from.to_string_lossy();
            let b = to.to_string_lossy();
            let mut c = store.catalog.lock().map_err(err)?;
            c.pins = c.pins.iter().map(|p| replace_path(p, &a, &b)).collect();
            c.recent = c.recent.iter().map(|p| replace_path(p, &a, &b)).collect();
            c.applications = c
                .applications
                .iter()
                .map(|p| replace_path(p, &a, &b))
                .collect();
            for s in &mut c.sections {
                s.paths = s.paths.iter().map(|p| replace_path(p, &a, &b)).collect();
            }
            c.icons = c
                .icons
                .iter()
                .map(|(p, v)| (replace_path(p, &a, &b), v.clone()))
                .collect();
            save(&store, &c)?;
            Ok(json!({"path":to,"settings":c.clone()}))
        }
        "trash" => {
            let p = local(arg(&args, 0)?)?;
            if p.parent().is_none() {
                return Err("Нельзя удалить диск".into());
            }
            let confirm = rfd::MessageDialog::new()
                .set_title("Корзина")
                .set_description(format!("Переместить «{}» в корзину?", filename(&p)))
                .set_level(rfd::MessageLevel::Warning)
                .set_buttons(rfd::MessageButtons::OkCancel)
                .show();
            if confirm != rfd::MessageDialogResult::Ok {
                return Ok(json!(false));
            }
            trash::delete(&p).map_err(err)?;
            Ok(json!(true))
        }
        "settings" => {
            let mut next: Catalog =
                serde_json::from_value(args.first().cloned().ok_or("Нет настроек")?)
                    .map_err(err)?;
            if next.pins.len() > 1000 || next.sections.len() > 100 {
                return Err("Слишком много объектов".into());
            }
            for p in &next.pins {
                local(p)?;
            }
            for s in &next.sections {
                if s.paths.len() > 1000 || s.name.len() > 400 {
                    return Err("Слишком много объектов".into());
                }
                for p in &s.paths {
                    local(p)?;
                }
            }
            if next.view != "list" {
                next.view = "grid".into()
            }
            let mut c = store.catalog.lock().map_err(err)?;
            next.recent = c.recent.clone();
            next.applications = c.applications.clone();
            save(&store, &next)?;
            *c = next.clone();
            Ok(json!(next))
        }
        "icon" => {
            let p = local(arg(&args, 0)?)?;
            let ext = p
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if !["png", "jpg", "jpeg", "webp", "bmp"].contains(&ext.as_str()) {
                return Ok(shell_icons::extract(&p).unwrap_or(Value::Null));
            }
            if fs::metadata(&p).map_err(err)?.len() > 16 * 1024 * 1024 {
                return Ok(Value::Null);
            }
            let mut reader = image::ImageReader::open(&p)
                .map_err(err)?
                .with_guessed_format()
                .map_err(err)?;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(16384);
            limits.max_image_height = Some(16384);
            limits.max_alloc = Some(128 * 1024 * 1024);
            reader.limits(limits);
            let img = reader.decode().map_err(err)?.thumbnail(320, 200);
            let mut buf = std::io::Cursor::new(Vec::new());
            img.write_to(&mut buf, image::ImageFormat::Png)
                .map_err(err)?;
            Ok(
                json!({"image":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(buf.into_inner())),"thumbnail":true}),
            )
        }
        "watch" => {
            let p = local(arg(&args, 0)?)?;
            let app = app.clone();
            let target = p.to_string_lossy().into_owned();
            let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
            let mut watcher =
                notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                    if res.is_ok() && last.elapsed() > std::time::Duration::from_millis(200) {
                        last = std::time::Instant::now();
                        let _ = app.emit("files-changed", &target);
                    }
                })
                .map_err(err)?;
            watcher
                .watch(&p, RecursiveMode::NonRecursive)
                .map_err(err)?;
            *store.watcher.lock().map_err(err)? = Some(watcher);
            Ok(Value::Null)
        }
        _ => Err("Неизвестная команда".into()),
    }
}
#[tauri::command]
async fn dispatch(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    op: String,
    args: Vec<Value>,
) -> Result<Value> {
    if window.label() != "main" {
        return Err("Нет доступа".into());
    }
    if op == "window" {
        match arg(&args, 0)? {
            "minimize" => window.minimize().map_err(err)?,
            "maximize" => {
                if window.is_maximized().map_err(err)? {
                    window.unmaximize().map_err(err)?
                } else {
                    window.maximize().map_err(err)?
                }
                let _ = window.emit("maximized", window.is_maximized().unwrap_or(false));
            }
            "close" => window.close().map_err(err)?,
            _ => return Err("Неизвестное действие".into()),
        }
        return Ok(Value::Null);
    }
    tauri::async_runtime::spawn_blocking(move || command(&app, &op, args))
        .await
        .map_err(err)?
}
fn main() {
    let file = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("kelvraq-tools")
        .join("catalog.json");
    let catalog = fs::read(&file)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_else(|| Catalog {
            pins: [dirs::document_dir(), dirs::download_dir()]
                .into_iter()
                .flatten()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            view: "grid".into(),
            ..Default::default()
        });
    tauri::Builder::default()
        .manage(search::Search::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    // Let DWM render antialiased native corners on Windows 11.
                    #[link(name = "dwmapi")]
                    unsafe extern "system" {
                        fn DwmSetWindowAttribute(
                            hwnd: *mut std::ffi::c_void,
                            attribute: u32,
                            value: *const u32,
                            size: u32,
                        ) -> i32;
                    }
                    let rounded = 2u32;
                    unsafe {
                        DwmSetWindowAttribute(hwnd.0 as _, 33, &rounded, 4);
                    }
                }
            }
            Ok(())
        })
        .manage(Store {
            catalog: Mutex::new(catalog),
            file,
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить kelvraq tools");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names() {
        assert!(valid_name("Model.blend").is_ok());
        for s in ["../bad", "CON", "NUL.txt", "a.", "COM1", " bad"] {
            assert!(valid_name(s).is_err(), "{s}");
        }
    }
    #[test]
    fn replacement() {
        assert_eq!(
            replace_path(r"D:\Models\a.blend", r"D:\Models", r"D:\3D"),
            r"D:\3D\a.blend"
        );
        assert_eq!(
            replace_path(r"D:\Models2", r"D:\Models", r"D:\3D"),
            r"D:\Models2"
        );
    }
}
