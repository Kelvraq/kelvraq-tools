use crate::{entry, Result};
use serde_json::{json, Value};
use std::{
    fs,
    os::windows::fs::MetadataExt,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const LIMIT: usize = 2000;

#[derive(Default)]
struct Progress {
    id: u64,
    entries: Vec<Value>,
    scanned: usize,
    skipped: usize,
    done: bool,
    limited: bool,
}

#[derive(Clone, Default)]
pub(crate) struct Search {
    generation: Arc<AtomicU64>,
    progress: Arc<Mutex<Progress>>,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDriveTypeW(root: *const u16) -> u32;
}

fn roots() -> Vec<PathBuf> {
    (b'A'..=b'Z')
        .filter_map(|letter| {
            let root = format!("{}:\\", letter as char);
            let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
            matches!(unsafe { GetDriveTypeW(wide.as_ptr()) }, 2 | 3).then(|| PathBuf::from(root))
        })
        .collect()
}

impl Search {
    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn start(&self, query: &str) -> Result<u64> {
        let query = query.trim().to_lowercase();
        if query.chars().count() < 2 || query.len() > 512 {
            return Err("Введите от 2 до 512 символов".into());
        }
        let id = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.progress.lock().map_err(crate::err)? = Progress {
            id,
            ..Default::default()
        };
        let service = self.clone();
        std::thread::spawn(move || service.scan(id, &query, roots()));
        Ok(id)
    }

    pub fn status(&self, id: u64) -> Result<Value> {
        let progress = self.progress.lock().map_err(crate::err)?;
        if progress.id != id {
            return Err("Поиск отменён".into());
        }
        Ok(
            json!({"entries": progress.entries, "scanned": progress.scanned,
            "skipped": progress.skipped, "done": progress.done, "limited": progress.limited}),
        )
    }

    fn scan(&self, id: u64, query: &str, mut stack: Vec<PathBuf>) {
        let mut batch = Vec::new();
        let mut scanned = 0;
        let mut skipped = 0;
        let mut total = 0;
        let mut last = Instant::now();
        while let Some(directory) = stack.pop() {
            if self.generation.load(Ordering::SeqCst) != id {
                return;
            }
            let children = match fs::read_dir(directory) {
                Ok(children) => children,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            for child in children {
                if self.generation.load(Ordering::SeqCst) != id {
                    return;
                }
                let child = match child {
                    Ok(child) => child,
                    Err(_) => {
                        skipped += 1;
                        continue;
                    }
                };
                scanned += 1;
                let path = child.path();
                if child
                    .file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .contains(query)
                {
                    batch.push(entry(&path));
                    total += 1;
                }
                if let Ok(metadata) = fs::symlink_metadata(&path) {
                    // Do not follow junctions, symlinks or cloud placeholders.
                    if metadata.is_dir() && metadata.file_attributes() & 0x400 == 0 {
                        stack.push(path);
                    }
                }
                if total >= LIMIT || last.elapsed() >= Duration::from_millis(150) {
                    let Ok(mut progress) = self.progress.lock() else {
                        return;
                    };
                    if progress.id != id {
                        return;
                    }
                    progress.entries.append(&mut batch);
                    progress.scanned = scanned;
                    progress.skipped = skipped;
                    last = Instant::now();
                    if total >= LIMIT {
                        progress.done = true;
                        progress.limited = true;
                        return;
                    }
                }
            }
        }
        if let Ok(mut progress) = self.progress.lock() {
            if progress.id == id && self.generation.load(Ordering::SeqCst) == id {
                progress.entries.append(&mut batch);
                progress.scanned = scanned;
                progress.skipped = skipped;
                progress.done = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_short_queries() {
        assert!(Search::default().start(" ").is_err());
        assert!(Search::default().start("a").is_err());
    }
    #[test]
    fn scans_nested_names_without_case_sensitivity() {
        let root = std::env::temp_dir().join(format!("kelvraq-search-{}", std::process::id()));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/Needle.txt"), b"test").unwrap();
        let service = Search::default();
        service.scan(0, "needle", vec![root.clone()]);
        let status = service.status(0).unwrap();
        assert_eq!(status["entries"].as_array().unwrap().len(), 1);
        assert_eq!(status["done"], true);
        fs::remove_file(root.join("nested/Needle.txt")).unwrap();
        fs::remove_dir(root.join("nested")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
