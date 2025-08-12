// Basic global mock for Chrome Extension APIs used by the codebase
// Extend as needed for tests

declare global {
  // eslint-disable-next-line no-var
  var chrome: any;
}

// Minimal event emitter helper
function createEvent() {
  const listeners: Function[] = [];
  return {
    addListener(fn: Function) {
      listeners.push(fn);
    },
    removeListener(fn: Function) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatch(...args: any[]) {
      for (const fn of listeners) fn(...args);
    },
    hasListener(fn: Function) {
      return listeners.includes(fn);
    },
  };
}

// Provide a very small subset of `chrome` needed by `content.js` and `sidepanel.js`
globalThis.chrome = {
  runtime: {
    onMessage: createEvent(),
    sendMessage: (_msg: any, cb?: (resp?: any) => void) => {
      // Default to async callback to mimic extension
      setTimeout(() => cb && cb(undefined), 0);
    },
  },
  tabs: {
    query: async () => [{ id: 1 }],
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
  },
  contextMenus: {
    onClicked: createEvent(),
    create: () => 0,
  },
};


