import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Version affichée en bas de page : date de construction (heure de Paris) + commit (fourni par Cloudflare Pages).
const buildDate = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date())
const commit = (process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Mise à jour proposée par un bandeau « Nouvelle version disponible » (UpdateBanner), pas silencieuse :
      // en mode automatique, l'ancienne version restait affichée jusqu'au rechargement suivant.
      registerType: 'prompt',
      injectRegister: false,
      // Une fois activée (après « Recharger »), la nouvelle version prend aussi la main sur les pages
      // ouvertes sans service worker (ex. après un rechargement forcé).
      workbox: {
        clientsClaim: true,
        // Polices du design (alphabet latin) gardées en cache pour l'appli installée.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-wght-normal-*.woff2'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mini-pong et fléchettes',
        short_name: 'MPF',
        description: 'Tournois de mini-pong et de fléchettes entre collègues, sur les temps de pause.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#c4511e',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
