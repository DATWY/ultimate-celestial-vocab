import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // T3.1/T2.2: bỏ cả `mp3` (5 file SFX trong public/sounds, 163,9 KB) và
        // không còn Google Fonts. MP3 chỉ phát khi user bấm (đã bỏ preload ở
        // boot — T3.3) nên precache 5 file này chỉ làm lần cài đặt PWA đầu tiên
        // nặng thêm mà lần mở app nào cũng chẳng dùng tới. Offline vẫn có tiếng
        // nhờ runtime cache `sfx-cache` bên dưới: file nào user đã nghe ít nhất
        // 1 lần thì nằm trong cache máy.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,wav,woff2}'],
        // Firebase SDK (468 kB) là chunk nạp ĐỘNG sau khi UI sẵn sàng. Không
        // precache để lần cài đặt đầu không phải tải; runtime cache sẽ giữ lại
        // sau lần đồng bộ đầu tiên, nên offline vẫn hoạt động.
        globIgnores: ['**/version.json', '**/firebase-*.js'],
        runtimeCaching: [
          {
            // SFX ngắn (<52 KB/file): CacheFirst sau lần phát đầu, để offline
            // vẫn có âm thanh mà boot không tốn byte nào. `sounds/` được phát
            // qua fetch(...) + decodeAudioData (không phải Range request) nên
            // CacheFirst an toàn; status 0 giữ cả response opaque nếu host khác.
            urlPattern: /\/sounds\/.*\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sfx-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 90 // <== 90 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/assets\/firebase-.*\.js$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-chunk-cache',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'unpkg-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdnjs-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jsdelivr-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/www\.gstatic\.com\/firebasejs\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-sdk-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      manifest: {
        name: "Ultimate Celestial Vocab",
        short_name: "Celestial",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#8a2be2",
        icons: [
          {
            src: "/favicon.ico",
            sizes: "64x64",
            type: "image/x-icon"
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml"
          },
          {
            src: "/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml"
          }
        ]
      }
    })
  ],
  resolve: {
    preserveSymlinks: true
  },
  optimizeDeps: {
    noDiscovery: true,
    include: []
  },
  server: {
    fs: {
      strict: true
    }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE' || (warning.message && warning.message.includes('dynamic import will not move module into another chunk'))) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) {
            return 'firebase';
          }
          if (id.includes('node_modules/animejs') || id.includes('node_modules/idb')) {
            return 'vendor';
          }
        }
      }
    }
  }
});
