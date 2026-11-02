const images = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const models = new Set([".blend", ".fbx", ".obj", ".glb", ".gltf", ".stl"]);
const videos = new Set([".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi"]);

export function cardKind(entry) {
  if (entry.directory) return "folder";
  const extension = (entry.ext || "").toLowerCase();
  if (
    entry.application ||
    [".exe", ".lnk", ".appref-ms", ".url"].includes(extension)
  )
    return "application";
  if (images.has(extension)) return "image";
  if (videos.has(extension)) return "video";
  if (models.has(extension)) return "model";
  return "document";
}

export function cardFormat(entry) {
  return (entry.ext || "").slice(1).toUpperCase().slice(0, 10) || "FILE";
}
