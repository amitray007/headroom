# headroomhq

Headroom is a self-hosted dashboard for AI account allowances, balances and usage. This package installs the
`headroom` command.

```sh
npx headroomhq
bunx headroomhq
pnpm dlx headroomhq
npm install -g headroomhq && headroom
```

The package has no code of its own. It depends on one platform package (`headroomhq-darwin-arm64`,
`headroomhq-darwin-x64`, `headroomhq-linux-x64` or `headroomhq-linux-arm64`) that holds the native binary, and
`bin/headroom.js` starts it. Do not install with `--no-optional` or `--omit=optional`.

Project: https://headroom.theblank.club
