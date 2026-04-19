import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('./tailwind.config.js', import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: configPath },
    autoprefixer: {},
  },
};
