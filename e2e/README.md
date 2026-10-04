# Browser checks

End-to-end checks that drive the running app in a real browser over the Chrome DevTools Protocol.
They need no extra npm packages, just Node 22+ and any Chromium browser (Chrome or Edge).

```bash
npm run dev                                   # or: npm run build && npm start
# in another terminal: a browser with remote debugging (headless is fine)
msedge --headless=new --remote-debugging-port=9223 --user-data-dir=.cache/e2e-browser about:blank
# or: chrome --headless=new --remote-debugging-port=9223 --user-data-dir=.cache/e2e-browser about:blank
npm run e2e
```

| Suite | Covers |
|---|---|
| `lab.mjs` | Countdown, weather popovers, view switch, camera presets, legend, Best view, playback (play, speed, scrub, reset), timing slider/steppers/shortcuts/keyboard, orbit presets, launch site, undo/reset, display options, hover descriptions |
| `assistant.mjs` | Ask panel chips and typed questions (Scripted mode), action chips, Reset all, guide sheet, guided tour, real-world feed |
| `satellites.mjs` | Satellite Mode: catalogs, data source, search/select/follow, trails, time source, screening (real sample + synthetic), replay, close-up, stale results, transport markers, synthetic tour, satellite chips |
| `layout.mjs` | No horizontal overflow from 1920 px to 390 px; phone essentials; three-column layout on wide screens |

Environment: `APP_URL` (default `http://localhost:3000`) and `CDP_PORT` (default `9223`). A check
also fails if the page throws or logs a console error while it runs.
