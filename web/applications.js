export const APPLICATIONS_PATH = "@applications";

export function applicationName(path) {
  return path
    .split(/[\\/]/)
    .pop()
    .replace(/\.(exe|lnk|appref-ms)$/i, "");
}

export function createApplications(call) {
  let picking = false;
  const launching = new Set();

  return {
    async add() {
      if (picking) return null;
      picking = true;
      try {
        const paths = await call("pick_applications");
        return paths.length ? await call("add_applications", paths) : null;
      } finally {
        picking = false;
      }
    },
    remove(path) {
      return call("remove_application", path);
    },
    async launch(path) {
      const key = path.toLowerCase();
      if (launching.has(key)) return;
      launching.add(key);
      try {
        await call("launch_application", path);
      } finally {
        setTimeout(() => launching.delete(key), 1000);
      }
    },
  };
}
