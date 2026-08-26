import { defineConfig } from 'astro/config';

const owner = process.env.GITHUB_REPOSITORY_OWNER || process.env.PUBLIC_GITHUB_USER || 'usuario';
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] || process.env.PUBLIC_REPO_NAME || '';
const isUserPage = repository === `${owner}.github.io`;
const base = process.env.PUBLIC_BASE_PATH || (repository && !isUserPage ? `/${repository}` : '/');

export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_SITE_URL || `https://${owner}.github.io`,
  base,
  trailingSlash: 'always',
  vite: {
    build: {
      target: 'es2022',
    },
  },
});
