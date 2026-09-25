# bkmrks

Sort, filter and browse your X bookmarks. Installable PWA.

- Sort by date bookmarked, date posted, likes, reposts, replies, bookmarks or views — ascending or descending.
- Filter by text, images, videos, or any combination; search text and authors.
- Card list or gallery view, with a detail viewer.
- Library is cached in IndexedDB: reloads resume where you were (scroll position included), interrupted syncs continue from the saved cursor, and later refreshes only fetch new bookmarks.

## How it works

You paste your `auth_token` and `ct0` cookie values. The browser POSTs them to `/api/bookmarks` (`server/x.ts`), which calls X's GraphQL `Bookmarks` endpoint and returns parsed posts. The server stores nothing; credentials live in `localStorage` ("Remember on this device") or `sessionStorage`.

## Develop

```sh
pnpm install
pnpm dev        # http://localhost:5173 (API served by Vite middleware)
pnpm typecheck
pnpm test
pnpm build
```

Deploys to Vercel as-is: `api/bookmarks.ts` becomes the serverless function, `dist/` the static app.
