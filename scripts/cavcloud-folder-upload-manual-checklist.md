# CavCloud Folder Upload Manual Verification

## 1) Generate fixture
Run:

```bash
node --experimental-strip-types scripts/generate-upload-fixture.ts --out=tmp/upload-fixture --many=250 --depth=15
```

Use the generated folder printed as `fixtureRoot` (defaults to `tmp/upload-fixture/Root`).

## 2) Start app
Run:

```bash
npm run dev
```

Open `http://localhost:4011/cavcloud` (or the port shown by dev script).

## 3) Upload via folder picker
1. Open CavCloud.
2. Click `New` -> `Upload folder`.
3. Select `tmp/upload-fixture/Root`.
4. Confirm preflight toast shows `Files`, `Size`, and `Depth`.
5. Wait for completion toast.

Expected:
- No silent skips.
- If failures occur, `Failed uploads` panel appears with `Retry failed`.
- Success only when `Uploaded` count equals `Discovered`.

## 4) Upload via drag/drop onto target folder
1. Create/open a destination folder in CavCloud.
2. Drag `tmp/upload-fixture/Root` from Finder into that folder pane.
3. Verify same completion/failure behavior.

## 5) Verify API counts
For each upload session id shown in `Upload Diagnostics` (`?uploadDebug=1`) call:

```bash
curl -sS "http://localhost:4011/api/cavcloud/folder-upload/session/<SESSION_ID>/verify" | jq
```

Expected:
- `ok: true`
- `comparisons.discoveredEqualsCreated: true`
- `comparisons.createdEqualsFinalized: true`
- `comparisons.noFailures: true`
- `comparisons.noMissing: true`

## 6) Visual checks
- Folder tree matches fixture exactly (including `deep/level1/.../level15/file.txt`).
- `images/logo.png` and `images/nested/deep.jpg` preview in CavCloud preview panel.
- `videos/clip.mp4` streams with scrubbing (Range requests).

## 7) Failure + retry check
1. Disconnect network briefly during upload (or block request in CavTools).
2. Confirm failed files appear in `Failed uploads` panel.
3. Click `Retry failed`.
4. Confirm failed list shrinks and verify endpoint returns `ok: true` after recovery.
