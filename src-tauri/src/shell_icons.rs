//! High-resolution Windows shell icons without shortcut overlays.
//! All acquired GDI handles are released before returning the encoded bitmap.
use base64::Engine;
use serde_json::{json, Value};
use std::{ffi::c_void, mem::size_of, path::Path, ptr::null_mut};

#[repr(C)]
struct ShellFileInfo {
    icon: *mut c_void,
    index: i32,
    attributes: u32,
    display: [u16; 260],
    kind: [u16; 80],
}
#[repr(C)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const IMAGE_LIST_IID: Guid = Guid {
    data1: 0x46eb5926,
    data2: 0x582e,
    data3: 0x4017,
    data4: [0x9f, 0xdf, 0xe8, 0x99, 0x8d, 0xaa, 0x09, 0x50],
};

unsafe fn image_list_icon(index: i32, kind: i32) -> Option<*mut c_void> {
    let mut list: *mut c_void = null_mut();
    if SHGetImageList(kind, &IMAGE_LIST_IID, &mut list) < 0 || list.is_null() {
        return None;
    }
    // IImageList inherits IUnknown. GetIcon is slot 10; Release is slot 2.
    let table = *(list as *const *const *const c_void);
    let get_icon: unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void) -> i32 =
        std::mem::transmute(*table.add(10));
    let release: unsafe extern "system" fn(*mut c_void) -> u32 = std::mem::transmute(*table.add(2));
    let mut icon = null_mut();
    let result = get_icon(list, index, 1, &mut icon);
    release(list);
    (result >= 0 && !icon.is_null()).then_some(icon)
}
#[repr(C)]
struct BitmapInfo {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bits: u16,
    compression: u32,
    image_size: u32,
    x: i32,
    y: i32,
    used: u32,
    important: u32,
    colors: [u32; 1],
}
#[link(name = "shell32")]
unsafe extern "system" {
    fn SHGetImageList(kind: i32, iid: *const Guid, list: *mut *mut c_void) -> i32;
    fn SHGetFileInfoW(
        path: *const u16,
        attributes: u32,
        info: *mut ShellFileInfo,
        size: u32,
        flags: u32,
    ) -> usize;
}
#[link(name = "user32")]
unsafe extern "system" {
    fn DestroyIcon(icon: *mut c_void) -> i32;
    fn DrawIconEx(
        dc: *mut c_void,
        x: i32,
        y: i32,
        icon: *mut c_void,
        w: i32,
        h: i32,
        step: u32,
        brush: *mut c_void,
        flags: u32,
    ) -> i32;
}
#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(dc: *mut c_void) -> *mut c_void;
    fn CreateDIBSection(
        dc: *mut c_void,
        info: *const BitmapInfo,
        usage: u32,
        bits: *mut *mut c_void,
        section: *mut c_void,
        offset: u32,
    ) -> *mut c_void;
    fn SelectObject(dc: *mut c_void, object: *mut c_void) -> *mut c_void;
    fn DeleteObject(object: *mut c_void) -> i32;
    fn DeleteDC(dc: *mut c_void) -> i32;
}

pub fn extract(path: &Path) -> Option<Value> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // Retrieve the base image index, never SHGFI_ADDOVERLAYS or SHGFI_LINKOVERLAY.
    unsafe {
        let mut info: ShellFileInfo = std::mem::zeroed();
        if SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            size_of::<ShellFileInfo>() as u32,
            0x4000,
        ) == 0
        {
            return None;
        }
        let (icon, size) = if let Some(icon) = image_list_icon(info.index, 4) {
            (icon, 256)
        } else {
            (image_list_icon(info.index, 2)?, 48)
        };
        let dc = CreateCompatibleDC(null_mut());
        if dc.is_null() {
            DestroyIcon(icon);
            return None;
        }
        let bitmap_info = BitmapInfo {
            size: 40,
            width: size,
            height: -size,
            planes: 1,
            bits: 32,
            compression: 0,
            image_size: 0,
            x: 0,
            y: 0,
            used: 0,
            important: 0,
            colors: [0],
        };
        let mut pixels = null_mut();
        let bitmap = CreateDIBSection(dc, &bitmap_info, 0, &mut pixels, null_mut(), 0);
        if bitmap.is_null() || pixels.is_null() {
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            DeleteDC(dc);
            DestroyIcon(icon);
            return None;
        }
        let old = SelectObject(dc, bitmap);
        let byte_count = (size * size * 4) as usize;
        std::ptr::write_bytes(pixels, 0, byte_count);
        let drawn = DrawIconEx(dc, 0, 0, icon, size, size, 0, null_mut(), 3) != 0;
        let mut bytes = std::slice::from_raw_parts(pixels as *const u8, byte_count).to_vec();
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        DestroyIcon(icon);
        if !drawn {
            return None;
        }
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            // GDI returns premultiplied BGRA; PNG expects straight RGBA.
            let alpha = pixel[3] as u32;
            if alpha > 0 && alpha < 255 {
                for channel in &mut pixel[..3] {
                    *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                }
            }
        }
        let image = image::RgbaImage::from_raw(size as u32, size as u32, bytes)?;
        let mut output = std::io::Cursor::new(Vec::new());
        image.write_to(&mut output, image::ImageFormat::Png).ok()?;
        Some(
            json!({"image":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(output.into_inner())),"thumbnail":false}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_visible_high_resolution_icon() {
        let executable = std::env::current_exe().unwrap();
        let result = extract(&executable).expect("shell icon");
        let data = result["image"].as_str().unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (256, 256));
        assert!(image.pixels().any(|pixel| pixel[3] > 0));
    }
}
