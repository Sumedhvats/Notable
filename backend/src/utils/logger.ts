const timestamp = (): string => new Date().toISOString();

const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[${timestamp()}] ℹ  ${message}`, ...args);
  },

  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[${timestamp()}] ⚠  ${message}`, ...args);
  },

  error: (message: string, ...args: unknown[]) => {
    console.error(`[${timestamp()}] ✖  ${message}`, ...args);
  },

  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[${timestamp()}] 🔍 ${message}`, ...args);
    }
  },

  success: (message: string, ...args: unknown[]) => {
    console.log(`[${timestamp()}] ✔  ${message}`, ...args);
  },
};

export default logger;
