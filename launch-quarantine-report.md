# CavBot Launch Quarantine Report
Date: 2026-03-28

## Archive target
- External quarantine path (outside repo):
  - `/tmp/cavbot-launch-archive/non-launch-assets/`

## Quarantined files
1. `public/cavbot-arcade/cavbot-arcade-logo-bg copy.png`
   - Archived to: `/tmp/cavbot-launch-archive/non-launch-assets/public/cavbot-arcade/cavbot-arcade-logo-bg copy.png`
   - Classification: duplicate launch asset variant (`copy`) not needed as canonical runtime file.
2. `public/icons/app/image-combiner-svgrepo-com copy.svg`
   - Archived to: `/tmp/cavbot-launch-archive/non-launch-assets/public/icons/app/image-combiner-svgrepo-com copy.svg`
   - Classification: duplicate icon variant (`copy`) not required after canonical reference patch.
3. `public/icons/app/security-protection-fingerprint-shield-svgrepo-com copy.svg`
   - Archived to: `/tmp/cavbot-launch-archive/non-launch-assets/public/icons/app/security-protection-fingerprint-shield-svgrepo-com copy.svg`
   - Classification: duplicate icon variant (`copy`) not required after canonical reference patch.

## Reference patches applied before/after quarantine
- Updated to canonical asset paths so runtime does not reference archived files:
  - `components/cavai/CavAiCenterWorkspace.tsx`
  - `components/cavai/CavAiCodeWorkspace.tsx`
  - `components/cavai/CavAiWorkspace.module.css`
  - `app/cavbot-arcade/gallery/page.tsx`
  - `app/settings/sections/security.css`

## Verification
- Search for quarantined filenames in app/runtime source returned no active references.
- Production build passed after quarantine and path patches.
- No source code modules were quarantined.

## Not quarantined intentionally
- Large asset directories with active runtime imports were kept in-repo:
  - `public/cavbot-arcade/`
  - `public/cavai-assets/`
  - `public/icons/`
- Reason: these are actively referenced by route/page code and are required for current build/runtime behavior.
