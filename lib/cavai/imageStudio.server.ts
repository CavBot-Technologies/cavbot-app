import "server-only";

import { Prisma } from "@prisma/client";

import { uploadSimpleFile as uploadCavCloudSimpleFile, getFileById as getCavCloudFileById } from "@/lib/cavcloud/storage.server";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { uploadSimpleFile as uploadCavSafeSimpleFile, getFileById as getCavSafeFileById } from "@/lib/cavsafe/storage.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import type { PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type ImageStudioPlanTier = "free" | "premium" | "premium_plus";
export type ImageJobMode = "generate" | "edit";
export type ImageAssetSourceKind =
  | "generated"
  | "edited"
  | "uploaded_device"
  | "import_cavcloud"
  | "import_cavsafe"
  | "saved_cavcloud"
  | "saved_cavsafe";

export type ImagePresetRecord = {
  id: string;
  slug: string;
  label: string;
  subtitle: string | null;
  thumbnailUrl: string | null;
  category: string;
  generationPromptTemplate: string;
  editPromptTemplate: string;
  negativePrompt: string | null;
  planTier: ImageStudioPlanTier;
  displayOrder: number;
  isFeatured: boolean;
  isActive: boolean;
  createdAtISO: string;
  updatedAtISO: string;
  locked: boolean;
};

export type ImagePresetClientRecord = Omit<
  ImagePresetRecord,
  "generationPromptTemplate" | "editPromptTemplate" | "negativePrompt"
>;

export type ImageAssetRecord = {
  id: string;
  accountId: string;
  userId: string;
  jobId: string | null;
  presetId: string | null;
  sourceKind: string;
  originalSource: string | null;
  fileName: string | null;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  format: string | null;
  fileLocation: string | null;
  cavcloudFileId: string | null;
  cavcloudKey: string | null;
  cavsafeFileId: string | null;
  cavsafeKey: string | null;
  externalUrl: string | null;
  dataUrl: string | null;
  b64Data: string | null;
  sourcePrompt: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAtISO: string;
  updatedAtISO: string;
};

export type ImageAssetClientRecord = Omit<ImageAssetRecord, "metadataJson">;

export type ImageHistoryEntry = {
  id: string;
  entryType: string;
  mode: string | null;
  promptSummary: string | null;
  saved: boolean;
  savedTarget: string | null;
  createdAtISO: string;
  jobId: string | null;
  assetId: string | null;
  presetId: string | null;
  presetLabel: string | null;
  imageUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  modelUsed: string | null;
  sourcePrompt: string | null;
};

export type ImageStudioBuildPromptArgs = {
  mode: ImageJobMode;
  userPrompt: string;
  preset: ImagePresetRecord | null;
  aspectRatio?: string | null;
  variantCount?: number | null;
  brandContext?: string | null;
  transformMode?: string | null;
};

export function toImagePresetClientRecord(preset: ImagePresetRecord): ImagePresetClientRecord {
  const {
    generationPromptTemplate,
    editPromptTemplate,
    negativePrompt,
    ...safePreset
  } = preset;
  void generationPromptTemplate;
  void editPromptTemplate;
  void negativePrompt;
  return safePreset;
}

export function toImageAssetClientRecord(asset: ImageAssetRecord): ImageAssetClientRecord {
  const {
    metadataJson,
    ...safeAsset
  } = asset;
  void metadataJson;
  return safeAsset;
}

const IMAGE_STUDIO_PROMPT_PREPROMPT = [
  "You are CavBot Image Studio, a world-class visual direction engine.",
  "Your job is to convert user intent, selected preset style, optional brand context, and optional aspect ratio into a high-quality image generation prompt suitable for premium creative output.",
  "Always optimize for:",
  "- strong composition",
  "- subject clarity",
  "- visual cohesion",
  "- commercially usable output",
  "- high aesthetic quality",
  "- clean lighting",
  "- material/style fidelity",
  "- thumbnail-worthy framing",
  "- elegant, polished results",
  "When a style preset is chosen, faithfully preserve the preset style language while still respecting the user’s subject and request.",
  "When the user wants product, website, brand, or UI assets, prioritize clean commercial usability and visual clarity.",
  "Do not introduce random clutter.",
  "Do not overcomplicate the scene unless requested.",
  "Do not make outputs muddy, low-contrast, or compositionally weak.",
  "Prefer crisp, strong, premium results.",
].join("\n");

const IMAGE_EDIT_PROMPT_PREPROMPT = [
  "You are CavBot Image Edit, a high-precision visual transformation engine.",
  "Your job is to transform uploaded or imported images according to the user’s request and selected preset style while preserving what should remain stable.",
  "Always optimize for:",
  "- preserving subject identity unless instructed otherwise",
  "- clean edges",
  "- coherent anatomy and perspective",
  "- consistent lighting",
  "- style fidelity",
  "- commercial-quality polish",
  "- minimal artifacts",
  "- visually strong final output",
  "When a style preset is selected, translate the image into that style while preserving the intended subject.",
  "When the user asks for screenshot enhancement or asset cleanup, prioritize clarity, layout quality, and visual professionalism.",
  "Do not make edits that contradict the requested transformation.",
  "Do not over-edit important subject features unless explicitly requested.",
].join("\n");

const IMAGE_AGENT_IDS = [
  "ui_mockup_generator",
  "website_visual_builder",
  "app_screenshot_enhancer",
  "brand_asset_generator",
  "ui_debug_visualizer",
] as const;

const MAX_INLINE_B64_CHARS = 8_000_000;
const LEGACY_DISABLED_PRESET_SLUGS = ["clouds", "department-photoshoot", "art-school"] as const;
const LEGACY_DISABLED_PRESET_SLUG_SET = new Set<string>(LEGACY_DISABLED_PRESET_SLUGS);
const IMAGE_STUDIO_REQUIRED_TABLES = [
  "image_presets",
  "image_jobs",
  "image_assets",
  "user_image_history",
  "agent_install_state",
] as const;
const STATIC_IMAGE_PRESET_TIMESTAMP_ISO = "2026-01-01T00:00:00.000Z";

const PRESET_SEED: Array<{
  slug: string;
  label: string;
  subtitle: string;
  category: string;
  generationTemplate: string;
  editTemplate: string;
  negativePrompt: string;
  planTier: ImageStudioPlanTier;
  featured: boolean;
}> = [
  {
    slug: "retro-anime",
    label: "Retro Anime",
    subtitle: "Cinematic cel shading",
    category: "illustration",
    generationTemplate:
      "Create a premium retro-anime key frame inspired by late-1980s and 1990s cel cinema: bold inked contour hierarchy, painterly background plates, dramatic rim light, and emotionally readable character acting. Compose around one dominant hero subject with strong foreground-midground-background separation, dynamic perspective, and clean silhouette readability at thumbnail scale. Use rich but controlled neon-warm contrast, soft film-grain texture, and cinematic lens intent (roughly 35mm to 50mm anime framing) for polished collector-edition poster quality. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Retro Anime Creative Media Group, engineered with enterprise-scale brand discipline and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a retro-anime cinematic frame with cel-shaded value blocks, confident linework rhythm, hand-painted background mood, and era-authentic color timing. Preserve subject identity, facial landmarks, pose logic, anatomy, and core composition while translating surfaces into stylized anime materials and controlled highlight behavior. Deliver a clean premium finish that looks like production key art, not a generic filter pass. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Retro Anime Creative Media Group, enforcing art-director signoff-level finishing control and ensuring downstream reuse in web, print, and paid media without rework; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "generic modern anime filter, muddy cel shadows, broken fingers, off-model face, drifting eye alignment, weak contour hierarchy, flat background plate, noisy gradient banding, oversaturated glow spam, cheap mobile-anime look",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "storybook",
    label: "Storybook",
    subtitle: "Warm editorial charm",
    category: "illustration",
    generationTemplate:
      "Create a world-class storybook illustration with painterly brush cadence, warm narrative lighting, hand-crafted texture, and emotionally clear staging that reads like a premium hardcover spread. Build one focal narrative moment with elegant eye-path composition, gentle depth layering, expressive environment details, and soft atmospheric perspective. Use harmonized color storytelling, tactile paper-and-pigment feel, and polished editorial finish that balances whimsy with believable form. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Storybook Creative Media Group, engineered with high-stakes executive review quality and social-first punch with cinema-poster depth; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a premium storybook illustration with painterly mark-making, warm narrative light, and curated scene storytelling while preserving the main subject identity, recognizable forms, and core action of the original composition. Maintain readable depth and character clarity, then restyle edges, materials, and palette into illustrated book-quality language. Output should feel authored and intentional, not overprocessed or synthetic. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Storybook Creative Media Group, enforcing high-risk publish-safe correction discipline and preventing feature drift across eyes, mouth, and landmark geometry; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "harsh digital glare, lifeless staging, muddy brush soup, plastic surfaces, random decorative clutter, inconsistent scale logic, over-sharpened outlines, flat lighting, generic stock-illustration look, weak storytelling focus",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "crayon",
    label: "Crayon Sketch",
    subtitle: "Playful wax texture",
    category: "illustration",
    generationTemplate:
      "Create a premium crayon illustration with visible wax layering, paper tooth interaction, playful hand pressure variation, and joyful color rhythm that still preserves clear composition discipline. Anchor one focal subject with simplified but readable form design, clean negative space, and energetic hand-drawn movement. Keep the mood charming and tactile, with rich pigment buildup, subtle texture overlap, and polished art-direction quality beyond classroom scribble aesthetics. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Crayon Creative Media Group, engineered with cross-market premium consistency and campaign-key-visual strength across paid and owned media; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a high-end crayon rendering by translating edges into wax strokes, flattening forms into intentional childlike stylization, and applying tactile paper grain interaction. Preserve core subject identity, silhouette, and scene structure while simplifying detail into readable crayon language. Ensure the final image feels handcrafted and premium rather than noisy or careless. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Crayon Creative Media Group, enforcing brand-safe transformation reliability and retaining every high-value detail that supports recognizability; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "photoreal skin texture, sterile vector smoothness, muddy wax smearing, unreadable edges, dull desaturated palette, cluttered background noise, rigid geometry, overblended gradients, low-effort scribble mess",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "doodle",
    label: "Doodle",
    subtitle: "Whimsical line energy",
    category: "illustration",
    generationTemplate:
      "Create a premium doodle-style image with spontaneous pen energy, playful naive charm, rhythmic line variation, and intentional visual hierarchy. Stage one strong focal subject with witty micro-details, clean whitespace breathing room, and sketchbook authenticity while maintaining professional readability. Use confident line choreography, limited but lively palette accents, and editorial-level composition so the result feels clever and collectible, not random scribble clutter. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Doodle Creative Media Group, engineered with enterprise-scale brand discipline and campaign-key-visual strength across paid and owned media; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a premium doodle aesthetic with expressive hand-drawn contours, simplified forms, and curated sketchbook spontaneity. Preserve subject identity, key proportions, and pose intent while converting detail into deliberate doodle vocabulary and clear focal flow. Keep the final composition playful but controlled, with strong readability and polished line confidence. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Doodle Creative Media Group, enforcing high-fidelity asset-governance standards and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "stiff geometric rendering, tangled line noise, unreadable focal subject, over-rendered realism, muddy tonal values, dense clutter, inconsistent stroke weight, chaotic background graffiti, cheap whiteboard look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "inkwork",
    label: "Inkwork",
    subtitle: "Monochrome editorial pen",
    category: "illustration",
    generationTemplate:
      "Create a masterful monochrome inkwork piece with authoritative pen control, sharp value hierarchy, deep black anchors, and nuanced cross-hatching for dimensional depth. Compose one commanding focal subject with editorial framing, restrained negative space, and tactile paper interaction. Balance precision and expressiveness so line rhythm, shadow architecture, and material depiction feel handcrafted, intentional, and gallery-ready. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Inkwork Creative Media Group, engineered with Fortune-10 launch polish and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into refined inkwork by translating forms into deliberate line-weight hierarchy, structural hatching, and disciplined black-white contrast. Preserve identity, anatomy, and composition geometry while converting tonal information into handcrafted pen language with crisp readability. Final output should feel like premium illustrated editorial art, not a flat black-and-white filter. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Inkwork Creative Media Group, enforcing forensic-level facial and geometry stability and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "blurred contours, gray muddy blacks, weak contrast separation, over-smudged wash, jittery line noise, undefined focal structure, posterized shadows, broken anatomy lines, cheap photocopy texture",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "watercolor",
    label: "Watercolor",
    subtitle: "Soft pigment bloom",
    category: "painting",
    generationTemplate:
      "Create a premium watercolor artwork with luminous wet-on-wet transitions, controlled pigment blooms, soft edge diffusion, and rich cold-press paper texture. Build a clear focal subject with graceful atmospheric depth, elegant negative space, and natural tonal breathing room. Use restrained color harmonies, subtle granulation, and painterly transparency to deliver museum-grade watercolor sophistication with calm poetic mood. High detail, no text, no watermark. Treat the frame like fine art with layered brush logic, controlled edge variety, and pigment-inspired value transitions that maintain depth and tactile presence. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Watercolor Fine Arts Group, engineered with investor-deck visual rigor and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into watercolor by reinterpreting structure through translucent wash layering, softened edge control, pigment pooling, and paper-grain interaction. Preserve subject identity, overall composition, and essential form relationships while replacing digital hardness with organic painted flow. Keep the finish refined, airy, and deliberate rather than muddy or overworked. Convert surfaces into painterly stroke systems and pigment transitions while preserving anatomical structure and scene balance. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Watercolor Fine Arts Group, enforcing identity-critical preservation discipline and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "hard digital outlines, neon oversaturation, muddy pigment pooling, chalky flat fills, posterized gradients, plastic sheen, over-inked edges, noisy watercolor filter artifacts, lifeless tonal depth",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "oil-painting",
    label: "Oil Painting",
    subtitle: "Classic brush richness",
    category: "painting",
    generationTemplate:
      "Create a gallery-grade oil painting with sculptural brushwork, layered glazing, rich tonal modeling, and subtle impasto highlights that catch directional light. Center one focal subject with classical composition discipline, believable material rendering, and cinematic atmosphere. Use warm-cool color orchestration, deliberate edge hierarchy, and painterly depth to achieve old-master sensibility with premium modern finish. High detail, no text, no watermark. Treat the frame like fine art with layered brush logic, controlled edge variety, and pigment-inspired value transitions that maintain depth and tactile presence. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Oil Painting Fine Arts Group, engineered with omnichannel premium-ad readiness and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a premium oil-painted interpretation using layered stroke structure, glazing logic, and tactile pigment density while preserving subject identity, anatomy, and core composition. Rebuild lighting and texture through painterly value transitions instead of digital smoothing. The final result should read as authored fine art, not a synthetic paint filter. Convert surfaces into painterly stroke systems and pigment transitions while preserving anatomical structure and scene balance. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Oil Painting Fine Arts Group, enforcing forensic-level facial and geometry stability and delivering publish-ready finish under strict brand and legal review; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat digital fills, plastic skin sheen, muddy shadows, random brush noise, weak edge hierarchy, over-smoothed detail, color contamination, low-depth painterly effect, cheap posterized painting look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "plushie",
    label: "Plushie",
    subtitle: "Collectible soft toy",
    category: "3d",
    generationTemplate:
      "Create a high-end plush collectible rendition with velvety fabric nap, stitched seam engineering, soft stuffed volume, and warm studio product lighting. Showcase one hero plush subject in clean catalog-style composition with inviting expression, toy-shelf readability, and premium craftsmanship detail. Materials should feel tactile and cozy, with believable threadwork, subtle fiber specularity, and polished commercial packaging energy. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Plushie Product Experience Group, engineered with cross-market premium consistency and multi-format cutdown flexibility with no quality loss; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a plushie collectible by converting hard forms into soft stuffed geometry, fabric textures, seam lines, and embroidered detail while preserving recognizable identity cues and silhouette character. Maintain pose readability and emotional expression, then finish with studio-grade toy-photography polish. Keep results charming, premium, and physically believable as textile objects. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Plushie Product Experience Group, enforcing strict composition-lock transformation control and delivering publish-ready finish under strict brand and legal review; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "hard plastic shell, metallic reflections, sharp bony anatomy, realistic skin pores, aggressive contrast shadows, lifeless toy eyes, uneven stitching, dirty fabric noise, cheap claw-machine plush quality",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "clay-figure",
    label: "Clay Figure",
    subtitle: "Hand-sculpted clay",
    category: "3d",
    generationTemplate:
      "Create a premium clay-figure character with hand-sculpted volume, subtle fingerprint impressions, matte earthen texture, and gentle tabletop studio lighting. Frame one focal subject with stop-motion-inspired charm, intentional handcrafted asymmetry, and strong silhouette readability. Emphasize tactile material behavior, edge softness, and artisanal build quality so the piece feels physically sculpted and collectible. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Clay Figure Product Experience Group, engineered with investor-deck visual rigor and storefront signage impact and product-page precision; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a handcrafted clay-figure aesthetic by sculpting forms into matte clay masses, adding tactile tooling marks, and simplifying surfaces into artisanal stop-motion language. Preserve subject recognizability, pose logic, and composition while replacing photographic detail with crafted volume cues. Deliver a polished handmade finish, not glossy toy plastic. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Clay Figure Product Experience Group, enforcing pixel-accountable production rigor and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "glossy plastic surface, metallic shine, hyper-real skin pores, sterile perfect symmetry, jagged digital edges, muddy clay color, melted geometry, low-effort toy render, lifeless stop-motion imitation",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "3d-glam-doll",
    label: "Glam Doll",
    subtitle: "Luxury toy portrait",
    category: "3d",
    generationTemplate:
      "Create a luxury 3D glam-doll portrait with polished collectible materials, immaculate beauty styling, and controlled studio lighting that highlights glossy curves and premium finish. Compose a close-up hero subject with fashion-editorial attitude, elegant facial symmetry, and high-end product-render clarity. Use refined specular rolloff, smooth stylized skin treatment, and upscale color styling for boutique designer-toy appeal. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar 3d Glam Doll Product Experience Group, engineered with Fortune-10 launch polish and OOH legibility with editorial close-up detail; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a 3D glam-doll aesthetic with sculpted toy-luxe proportions, glossy material treatment, and editorial beauty-light shaping while preserving identity, signature facial landmarks, and flattering pose structure. Keep expression and character intact as surfaces become stylized premium collectible materials. Result should feel boutique and intentional, not uncanny or low-poly. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar 3d Glam Doll Product Experience Group, enforcing forensic-level facial and geometry stability and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "low-poly facets, muddy matte lighting, broken facial symmetry, uncanny plastic skin, distorted eyes, noisy surface grain, cheap doll finish, lifeless expression, overexposed specular blowout",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "bobblehead",
    label: "Bobblehead",
    subtitle: "Playful collectible",
    category: "3d",
    generationTemplate:
      "Create a premium bobblehead figurine with an expressive oversized head, compact stylized body, and clean pedestal presentation lit like a retail product hero shot. Center one focal character with playful personality, crisp silhouette, and balanced proportion exaggeration that remains recognizable. Use polished paint, controlled reflections, and high-resolution manufacturing detail for limited-edition collectible quality. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Bobblehead Product Experience Group, engineered with high-stakes executive review quality and social-first punch with cinema-poster depth; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a polished bobblehead style by enlarging head-to-body ratio in a controlled way, simplifying anatomy into figurine form, and applying premium collectible surface finishing. Preserve identity-defining facial traits, expression intent, and pose readability while converting into product-shot staging. Keep the result charming and precise, not distorted or toy-like cheap. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Bobblehead Product Experience Group, enforcing strict composition-lock transformation control and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "deformed face, broken neck proportions, cheap hollow plastic, low-detail paint, cluttered pedestal, muddy lighting, weak silhouette, caricature drift too far from identity, knockoff souvenir quality",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "mascot",
    label: "Mascot",
    subtitle: "Brand character system",
    category: "brand",
    generationTemplate:
      "Create a world-class brand mascot with bold silhouette design, readable shape language, expressive posing, and campaign-ready visual clarity across digital, print, and merch contexts. Feature one central character with strong iconography, balanced color blocking, and clean compositional hierarchy that remains legible at small sizes. Add premium finish, subtle material cues, and confident personality so it feels like a scalable brand system anchor. High detail, no text, no watermark. Design for brand-system clarity with iconic silhouette language, scalable shape logic, and instantly recognizable character identity. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Mascot Brand Systems Group, engineered with global campaign governance quality and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a mascot-style brand character by simplifying forms into high-legibility geometry, strengthening silhouette identity, and applying strategic color blocking and expression design. Preserve core identity cues and emotional tone while translating into system-ready branding language. Final output should feel proprietary, polished, and production-usable. Refine into brand-ready mascot language while preserving recognizable identity cues, proportion logic, and expression clarity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Mascot Brand Systems Group, enforcing art-director signoff-level finishing control and ensuring downstream reuse in web, print, and paid media without rework; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "illegible silhouette, over-detailed clutter, muddy palette, awkward limb posing, generic clipart vibe, inconsistent line style, weak brand distinctiveness, noisy background, low scalability logo-mascot confusion",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "caricature-trend",
    label: "Caricature",
    subtitle: "Bold exaggerated portrait",
    category: "illustration",
    generationTemplate:
      "Create a premium caricature portrait with smart exaggeration of signature facial features, dynamic contour rhythm, and social-editorial punch while preserving clear likeness. Compose one focal subject with expressive attitude, clean background support, and high-readability silhouette. Use stylized anatomy, bold tonal grouping, and polished color direction to deliver shareable high-end caricature art rather than novelty distortion. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Caricature Trend Creative Media Group, engineered with Fortune-10 launch polish and OOH legibility with editorial close-up detail; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a high-end caricature by amplifying recognizable features with intentional proportion control, strong line economy, and expressive stylization while preserving identity, emotion, and pose integrity. Keep eyes, mouth, and facial landmarks coherent so likeness remains unmistakable. Finish with crisp editorial polish suitable for premium social or print use. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Caricature Trend Creative Media Group, enforcing campaign-lock continuity across derivative assets and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "unrecognizable identity, chaotic feature distortion, drifting eye placement, warped jaw anatomy, muddy color blocks, messy line chatter, low-contrast face, exaggerated deformation without likeness, novelty app filter look",
    planTier: "premium",
    featured: true,
  },
  {
    slug: "camcorder",
    label: "Camcorder",
    subtitle: "Vintage video mood",
    category: "photo",
    generationTemplate:
      "Create a nostalgic camcorder-era frame with authentic miniDV texture, subtle interlaced softness, period-correct color response, and candid handheld composition. Keep one readable focal subject while preserving spontaneous documentary energy, natural imperfection, and warm memory-driven mood. Blend low-fi video character with intentional framing and premium storytelling polish so it feels archival, not degraded. High detail, no text, no watermark. Use photographic realism with intentional lens behavior, exposure balance, and controlled depth separation. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Camcorder Visual Journalism Group, engineered with boardroom-level art direction and billboard-scale readability and app-thumbnail clarity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a camcorder aesthetic with era-authentic grain structure, mild chroma softness, vintage white-balance behavior, and handheld home-video atmosphere. Preserve subject identity, scene readability, and core composition while translating modern clarity into believable archival video mood. Keep it emotionally rich and restrained, avoiding gimmicky glitch overload. Apply cinematic photographic treatment while preserving subject recognizability, lens logic, and documentary coherence. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Camcorder Visual Journalism Group, enforcing strict composition-lock transformation control and enforcing clean edges, realistic material response, and artifact-free output; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "modern HDR sharpness, clinical skin retouching, hyper-clean digital contrast, fake VHS glitch spam, neon overgrade, unreadable motion smear, crushed blacks, low-effort retro app filter look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "paparazzi",
    label: "Paparazzi",
    subtitle: "Flashy editorial drama",
    category: "photo",
    generationTemplate:
      "Create an elite paparazzi editorial moment with hard on-camera flash, kinetic nightlife framing, and tense candid energy that feels immediate and expensive. Stage one celebrity-like focal subject with dramatic flash-to-ambient separation, dynamic motion cues, and premium tabloid-era storytelling. Maintain crisp subject readability amid controlled chaos, with high-fashion attitude and polished publication-ready contrast. High detail, no text, no watermark. Use photographic realism with intentional lens behavior, exposure balance, and controlled depth separation. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Paparazzi Visual Journalism Group, engineered with global franchise hero-asset quality and magazine-cover authority and mobile-feed retention; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into paparazzi-style editorial photography with direct flash impact, candid street urgency, and high-contrast night atmosphere while preserving identity, pose logic, and scene coherence. Keep the subject legible as background energy becomes kinetic and documentary. Final output should feel magazine-cover candid, not staged studio flash. Apply cinematic photographic treatment while preserving subject recognizability, lens logic, and documentary coherence. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Paparazzi Visual Journalism Group, enforcing enterprise QA-ready visual consistency and retaining every high-value detail that supports recognizability; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat soft lighting, static portrait posing, over-smoothed skin, weak flash separation, washed highlights, muddy night color, overblown blur, fake red-carpet backdrop, cheap party snapshot look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "post-rain-sunset",
    label: "After Rain",
    subtitle: "Reflections + warm light",
    category: "atmosphere",
    generationTemplate:
      "Create a cinematic post-rain sunset scene with mirror-like wet surfaces, golden cloud break light, and luminous puddle reflections that enhance depth and mood. Compose around one focal subject or location moment with clean horizon balance, atmospheric perspective, and premium travel-editorial color grading. Emphasize moisture-rich material behavior, warm-to-cool tonal contrast, and polished storytelling realism at high clarity. High detail, no text, no watermark. Use weather, haze, and environmental light as narrative tools, balancing mood with subject readability and clear depth stratification. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Post Rain Sunset Cinematic Environments Group, engineered with high-stakes executive review quality and magazine-cover authority and mobile-feed retention; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a post-rain sunset atmosphere by introducing realistic wet-surface reflections, warm low-angle sunlight, and depth-rich sky glow while preserving subject placement and composition structure. Keep spatial coherence and natural perspective intact as lighting, color, and surface response shift to cinematic mood. Output should feel immersive and premium, not over-filtered. Shift weather and ambient mood decisively while preserving spatial coherence, scale relationships, and focal hierarchy. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Post Rain Sunset Cinematic Environments Group, enforcing high-risk publish-safe correction discipline and holding focal hierarchy stable while rebuilding light and texture quality; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "dry matte pavement, dull gray sky, muddy reflections, neon color contamination, flat ambient light, blown sunset highlights, noisy puddle artifacts, weak depth layering, generic travel-filter look",
    planTier: "premium_plus",
    featured: true,
  },
  {
    slug: "dramatic-portrait",
    label: "Dramatic Portrait",
    subtitle: "High-contrast elegance",
    category: "portrait",
    generationTemplate:
      "Create a dramatic editorial portrait with sculpted key-and-fill lighting, rich shadow architecture, and emotionally commanding expression. Frame one hero face with intentional close portrait composition, refined skin detail, and cinematic lens feel (about 85mm portrait compression) for premium magazine impact. Use controlled contrast, elegant color grading, and atmospheric depth so the image feels luxurious, sharp, and psychologically powerful. High detail, no text, no watermark. Prioritize eyes, skin texture, and facial topology with flattering sculpted light and emotionally explicit expression control. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Dramatic Portrait Portrait Intelligence Group, engineered with global campaign governance quality and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a dramatic portrait by rebuilding light direction, contrast structure, and editorial mood while preserving facial identity, anatomical integrity, expression truth, and pose character. Maintain natural skin realism and feature alignment as tonal separation becomes more cinematic. Final result should read as high-end studio portrait art, not a harsh contrast preset. Re-sculpt portrait lighting and tonal separation while preserving facial identity, expression truth, and anatomical fidelity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Dramatic Portrait Portrait Intelligence Group, enforcing global creative-ops handoff reliability and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat frontal lighting, washed skin tones, broken facial proportions, over-soft blur, crushed shadows, blown highlights, noisy skin artifacts, lifeless expression, low-end glamour filter look",
    planTier: "premium_plus",
    featured: true,
  },
  {
    slug: "norman-rockwell",
    label: "Americana Story",
    subtitle: "Nostalgic Americana realism",
    category: "painting",
    generationTemplate:
      "Create a refined Americana narrative painting inspired by classic mid-century magazine illustration: expressive faces, humane storytelling, period-aware props, and painterly warmth. Center one emotionally clear focal moment with balanced composition, domestic environment cues, and softly modeled light that supports character empathy. Use rich but restrained palette control, brush-led texture, and timeless editorial craftsmanship for museum-quality illustrative realism. High detail, no text, no watermark. Treat the frame like fine art with layered brush logic, controlled edge variety, and pigment-inspired value transitions that maintain depth and tactile presence. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Norman Rockwell Fine Arts Group, engineered with Fortune-10 launch polish and billboard-scale readability and app-thumbnail clarity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a Rockwell-inspired narrative illustration with painterly realism, period storytelling atmosphere, and warmth-forward tonal design while preserving subject identity, gesture, and emotional readability. Keep composition coherent and character expressions authentic as details shift into illustrated brush language. Output should feel archival editorial art, not parody. Convert surfaces into painterly stroke systems and pigment transitions while preserving anatomical structure and scene balance. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Norman Rockwell Fine Arts Group, enforcing campaign-lock continuity across derivative assets and keeping the scene coherent while upgrading mood, polish, and depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "cold sterile palette, modern fashion contamination, exaggerated caricature distortion, harsh digital contrast, sloppy brush texture, lifeless expression, anachronistic props, generic vintage filter imitation",
    planTier: "premium_plus",
    featured: true,
  },
  {
    slug: "flower-petals",
    label: "Petal Drift",
    subtitle: "Soft romantic motion",
    category: "atmosphere",
    generationTemplate:
      "Create a premium romantic scene with drifting flower petals, graceful motion arcs, soft depth layering, and luminous flattering light around a clear focal subject. Arrange petals with deliberate choreography to guide the eye rather than clutter the frame, balancing foreground accents and background atmosphere. Use elegant color harmony, delicate texture detail, and editorial finish for cinematic, emotionally warm, high-end output. High detail, no text, no watermark. Use weather, haze, and environmental light as narrative tools, balancing mood with subject readability and clear depth stratification. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Flower Petals Cinematic Environments Group, engineered with flagship product-launch precision and billboard-scale readability and app-thumbnail clarity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image by introducing controlled flower-petal motion, romantic light bloom, and soft atmospheric depth while preserving subject identity, composition hierarchy, and key facial or object clarity. Keep petal placement intentional so the focal subject remains dominant and readable. Deliver polished editorial romance, not decorative overload. Shift weather and ambient mood decisively while preserving spatial coherence, scale relationships, and focal hierarchy. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Flower Petals Cinematic Environments Group, enforcing campaign-lock continuity across derivative assets and preventing feature drift across eyes, mouth, and landmark geometry; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "confetti-like chaos, petal overload blocking face, hard shadow clutter, muddy focus planes, random particle noise, flat lighting, oversaturated wedding-filter color, weak focal hierarchy, cheap decorative effect",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "gold",
    label: "Gilded",
    subtitle: "Luxury metallic finish",
    category: "material",
    generationTemplate:
      "Create a luxury gold-finish visual with physically plausible metallic behavior, nuanced micro-surface texture, and controlled specular rolloff under premium lighting. Highlight one focal subject with refined warm contrast, elegant composition, and commercial campaign polish suitable for beauty, jewelry, or luxury brand art direction. Preserve believable material depth so gold reads as high-value metal, not yellow tint, with crisp detail and cinematic atmosphere. High detail, no text, no watermark. Calibrate reflectance and micro-texture carefully so premium materials read physically correct under directional light. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Gold Materials Innovation Group, engineered with C-suite approval-ready finishing and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a high-end gold-material aesthetic by recalibrating reflections, highlights, and tonal warmth while preserving subject form, geometry, and compositional balance. Convert surfaces to believable metallic response with luxurious but restrained color treatment. Final output should feel premium advertising grade, not overprocessed color cast. Rebuild material response with accurate reflectance and highlight rolloff while preserving underlying forms and composition. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Gold Materials Innovation Group, enforcing enterprise QA-ready visual consistency and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat yellow overlay, muddy metal reflections, blown specular clipping, patchy faux-metal texture, plastic sheen, oversaturated warm cast, low dynamic range, noisy highlights, bargain luxury look",
    planTier: "premium_plus",
    featured: true,
  },
  {
    slug: "fisheye",
    label: "Fisheye",
    subtitle: "Ultra-wide distortion",
    category: "photo",
    generationTemplate:
      "Create a high-impact fisheye composition with coherent ultra-wide curvature, immersive spatial wrap, and one center-priority focal subject that remains readable. Use intentional lens distortion language, dynamic edge flow, and environmental depth to deliver energetic perspective without structural collapse. Keep lighting, color, and subject hierarchy polished for editorial sport-street-photo energy with premium clarity. High detail, no text, no watermark. Use photographic realism with intentional lens behavior, exposure balance, and controlled depth separation. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Fisheye Visual Journalism Group, engineered with global campaign governance quality and multi-format cutdown flexibility with no quality loss; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a fisheye-lens aesthetic by applying controlled spherical distortion, center emphasis, and dynamic spatial expansion while preserving subject recognizability and scene logic. Maintain clean composition and avoid random warping of critical anatomy or objects. Final result should feel like intentional lens craft, not glitch deformation. Apply cinematic photographic treatment while preserving subject recognizability, lens logic, and documentary coherence. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Fisheye Visual Journalism Group, enforcing high-fidelity asset-governance standards and enforcing clean edges, realistic material response, and artifact-free output; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "random stretch artifacts, melted anatomy, broken limb geometry, unreadable center subject, edge smearing, chaotic curvature, perspective collapse, low-quality lens effect, generic novelty filter look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "neon-fantasy",
    label: "Neon Fantasy",
    subtitle: "Chromatic dreamworld",
    category: "illustration",
    generationTemplate:
      "Create a premium neon-fantasy world with saturated emissive color architecture, layered atmospheric haze, and cinematic contrast between luminous highlights and deep shadow. Anchor one heroic focal subject with clean silhouette readability, dramatic depth cues, and dreamlike world-building that still feels coherent. Use deliberate palette storytelling, reflective materials, and polished VFX-grade glow control for blockbuster fantasy key art quality. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Neon Fantasy Creative Media Group, engineered with Fortune-10 launch polish and retina-sharp web hero impact and print-cover fidelity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a neon-fantasy aesthetic with intentional glow systems, surreal atmosphere, and stylized cinematic color contrast while preserving subject identity, pose readability, and composition structure. Maintain controlled bloom, edge definition, and depth separation so the image stays premium and legible. Output should feel authored, not neon overload. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Neon Fantasy Creative Media Group, enforcing precision-grade structural integrity controls and delivering publish-ready finish under strict brand and legal review; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat blacks, gray haze wash, muddy neon spill, unreadable silhouette, color bleed contamination, bloom overkill, noisy gradients, weak focal depth, cheap cyber filter look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "iridescent-metal-portrait",
    label: "Iridescent Metal",
    subtitle: "Futurist alloy sheen",
    category: "portrait",
    generationTemplate:
      "Create a futurist iridescent-metal portrait with fluid alloy reflections, spectral hue shifts, and sculptural facial planes lit like a high-fashion tech beauty campaign. Frame one dominant face with pristine studio composition, clean background separation, and precise highlight placement for premium luxury-future aesthetics. Materials should feel physically coherent, with chromatic specular transitions and elegant surface depth at high resolution. High detail, no text, no watermark. Prioritize eyes, skin texture, and facial topology with flattering sculpted light and emotionally explicit expression control. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Iridescent Metal Portrait Portrait Intelligence Group, engineered with C-suite approval-ready finishing and social-first punch with cinema-poster depth; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an iridescent-metal portrait by converting skin and surfaces to coherent alloy reflectance, spectral color travel, and sculpted studio-light behavior while preserving identity, expression, and facial geometry. Maintain eye alignment, anatomy, and proportion as materials become futuristic. Final look should be polished campaign-grade, not noisy chrome gimmick. Re-sculpt portrait lighting and tonal separation while preserving facial identity, expression truth, and anatomical fidelity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Iridescent Metal Portrait Portrait Intelligence Group, enforcing identity-critical preservation discipline and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "matte muddy metal, inconsistent reflection direction, broken facial geometry, patchy chrome artifacts, dull flat lighting, noisy iridescent banding, distorted eyes, low-detail sci-fi metal filter look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "sugar-cookie",
    label: "Sugar Cookie",
    subtitle: "Sweet handcrafted icing",
    category: "3d",
    generationTemplate:
      "Create a premium sugar-cookie visual with believable baked texture, hand-piped icing relief, pastel confection styling, and boutique bakery art direction. Center one hero cookie subject with clean tabletop composition, decorative precision, and appetizing soft-light presentation. Emphasize edible material realism, tidy craftsmanship, and playful luxury mood suitable for commercial packaging or campaign assets. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Sugar Cookie Product Experience Group, engineered with Fortune-10 launch polish and storefront signage impact and product-page precision; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a sugar-cookie confection style by translating forms into baked dough surfaces, piped frosting structure, and controlled pastel decoration while preserving core silhouette and recognizability. Keep decorative details intentional and clean, with appetizing light and depth cues. Final output should feel handcrafted and premium, not melted or synthetic. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Sugar Cookie Product Experience Group, enforcing forensic-level facial and geometry stability and protecting pose logic, anatomy, and perspective under heavy stylization; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "plastic gloss icing, muddy crumbs, melted undefined edges, dirty texture noise, harsh shadows, inedible material look, oversaturated frosting, chaotic decoration clutter, cheap novelty baking filter",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "medieval-times",
    label: "Medieval Realm",
    subtitle: "Regal old-world atmosphere",
    category: "photo",
    generationTemplate:
      "Create a historically grounded medieval scene with period-authentic stone and timber architecture, hand-forged material cues, and candle or torch motivated lighting that shapes atmosphere. Focus on one clear subject or event moment with believable garment construction, weathered textures, and cinematic depth rooted in historical plausibility rather than fantasy cosplay. Use restrained earthy palette, smoke-lit ambience, and disciplined composition for museum-quality old-world immersion. High detail, no text, no watermark. Use photographic realism with intentional lens behavior, exposure balance, and controlled depth separation. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Medieval Times Visual Journalism Group, engineered with high-stakes executive review quality and magazine-cover authority and mobile-feed retention; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a medieval-times aesthetic with historically plausible wardrobe, architecture, and material treatment while preserving subject identity, anatomy, and scene structure. Rebuild lighting toward torch or natural low-light mood and convert modern textures into period-authentic surfaces. Ensure output remains respectful, coherent, and grounded in lived medieval realism. Apply cinematic photographic treatment while preserving subject recognizability, lens logic, and documentary coherence. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Medieval Times Visual Journalism Group, enforcing strict composition-lock transformation control and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "fantasy armor clichés, modern zippers, plastic costume sheen, neon lighting, visible modern tech, cartoon medieval styling, anachronistic props, low-budget fairground reenactment look, inaccurate architecture mashup",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "taino-heritage",
    label: "Native Heritage",
    subtitle: "Ancestrial Identity",
    category: "portrait",
    generationTemplate:
      "Create a respectful Taino-heritage-inspired visual rooted in Caribbean indigenous context, natural materials, and dignified cultural symbolism rendered with accuracy and restraint. Compose around one focal subject with earth-and-ocean palette harmony, handcrafted artifact textures, and environment cues that honor place and ancestry. Prioritize authenticity, emotional dignity, and polished editorial craftsmanship while avoiding stereotypes or sensationalism. High detail, no text, no watermark. Prioritize eyes, skin texture, and facial topology with flattering sculpted light and emotionally explicit expression control. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Taino Heritage Portrait Intelligence Group, engineered with flagship product-launch precision and global regionalization resilience without style drift; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a Taino-heritage-inspired aesthetic by integrating culturally respectful motifs, natural material language, and grounded regional atmosphere while preserving subject identity, anatomy, and compositional integrity. Keep symbolism intentional, non-exploitative, and historically sensitive. Final output should feel reverent, refined, and culturally informed. Re-sculpt portrait lighting and tonal separation while preserving facial identity, expression truth, and anatomical fidelity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Taino Heritage Portrait Intelligence Group, enforcing forensic-level facial and geometry stability and enforcing clean edges, realistic material response, and artifact-free output; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "stereotyped tribal clichés, inaccurate sacred iconography, fantasy mashup aesthetics, disrespectful costume caricature, neon modern props, plastic textures, cultural flattening, chaotic motif overload, insensitive cultural appropriation look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "ornament",
    label: "Ornamental",
    subtitle: "Festive collectible shine",
    category: "3d",
    generationTemplate:
      "Create a premium ornamental design image with intricate filigree, disciplined symmetry, and luxury craftsmanship cues across metal, enamel, carved, or glass-like materials. Feature one central ornamental focal element with precise linework, balanced negative space, and elegant decorative rhythm. Use refined light behavior and texture detail for high-end collectible or festive design quality with crisp readability. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Ornament Product Experience Group, engineered with global franchise hero-asset quality and retina-sharp web hero impact and print-cover fidelity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an ornament-forward aesthetic with precise decorative geometry, symmetry-aware layout, and premium material detailing while preserving the core structural silhouette and focal hierarchy. Enhance craftsmanship and finish quality without overloading the composition. Output should feel artisan luxury, not generic holiday clipart. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Ornament Product Experience Group, enforcing pixel-accountable production rigor and ensuring downstream reuse in web, print, and paid media without rework; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "broken symmetry, cluttered decoration overload, muddy micro-detail, jagged filigree edges, cheap glitter texture, inconsistent material finish, low-end craft-store style, noisy background interference",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "iconic",
    label: "Monochrome Portrait",
    subtitle: "Timeless monochrome drama",
    category: "portrait",
    generationTemplate:
      "Create an iconic monochrome portrait with timeless editorial authority: sculpted contrast, deliberate tonal separation, and emotionally magnetic subject presence. Frame one hero face or figure with classic black-and-white composition, controlled film-grain texture, and refined light direction that enhances form and expression. Aim for museum-grade photographic gravitas with clean value hierarchy and premium print-quality finish. High detail, no text, no watermark. Prioritize eyes, skin texture, and facial topology with flattering sculpted light and emotionally explicit expression control. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Iconic Portrait Intelligence Group, engineered with Fortune-10 launch polish and multi-format cutdown flexibility with no quality loss; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an iconic monochrome portrait by rebuilding color into elegant grayscale tonal architecture, strengthening contrast sculpting, and refining editorial framing while preserving identity, expression, and anatomy. Keep midtone detail and highlight control to avoid harsh clipping. Final output should feel timeless and cinematic, not flat desaturation. Re-sculpt portrait lighting and tonal separation while preserving facial identity, expression truth, and anatomical fidelity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Iconic Portrait Intelligence Group, enforcing forensic-level facial and geometry stability and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "flat grayscale conversion, crushed black detail, blown highlights, muddy midtones, soft blurry focus, noisy compression artifacts, weak subject separation, lifeless expression, cheap black-and-white filter look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "cyber-drift",
    label: "Cyber Drift",
    subtitle: "Neon rainy futurism",
    category: "atmosphere",
    generationTemplate:
      "Create a premium cyber-drift scene with rain-slick streets, neon reflection networks, velocity cues, and dense futuristic atmosphere that remains compositionally clean. Center one focal subject with cinematic depth layers, readable silhouette, and high-contrast night lighting that sells motion and scale. Use coherent world-building details, reflective material fidelity, and blockbuster key-art finish for high-energy futuristic storytelling. High detail, no text, no watermark. Use weather, haze, and environmental light as narrative tools, balancing mood with subject readability and clear depth stratification. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Cyber Drift Cinematic Environments Group, engineered with luxury-grade campaign craftsmanship and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a cyber-drift aesthetic by introducing coherent neon lighting systems, wet reflective surfaces, and dynamic night-city depth while preserving subject identity, geometry, and compositional readability. Keep motion energy strong but controlled so focal hierarchy stays clear. Final result should feel premium cinematic futurism, not chaotic neon clutter. Shift weather and ambient mood decisively while preserving spatial coherence, scale relationships, and focal hierarchy. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Cyber Drift Cinematic Environments Group, enforcing high-fidelity asset-governance standards and enforcing clean edges, realistic material response, and artifact-free output; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "muddy neon haze, unreadable silhouettes, uncontrolled bloom, cluttered signage noise, weak contrast separation, toy-like sci-fi props, color banding, fake rain overlay, generic cyberpunk wallpaper look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "dreamcore-collage",
    label: "Dreamcore",
    subtitle: "Surreal nostalgic layers",
    category: "illustration",
    generationTemplate:
      "Create a high-concept dreamcore collage with surreal nostalgic symbolism, liminal atmosphere, poetic scale shifts, and layered visual storytelling that feels strange yet intentional. Establish one anchor focal subject or cluster, then build supporting objects in controlled depth tiers with cohesive mood logic. Use soft haze, selective detail emphasis, and editorial art-book composition for emotionally resonant, premium surrealism. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Dreamcore Collage Creative Media Group, engineered with global franchise hero-asset quality and brand-book reproducibility and ad-network robustness; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a dreamcore-collage aesthetic by introducing curated surreal layers, nostalgic liminal mood, and symbolic visual juxtapositions while preserving readable focal structure and key subject cues. Keep composition coherent even as reality logic bends, avoiding random clutter. Output should feel curated and cinematic, not chaotic moodboard paste. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Dreamcore Collage Creative Media Group, enforcing enterprise QA-ready visual consistency and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "incoherent object spam, random cutout clutter, muddy haze over everything, unreadable focal hierarchy, broken perspective without intent, low-contrast mush, glitch noise overload, generic creepycore filter look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "island",
    label: "Tropical Escape",
    subtitle: "Luxury tropical escape",
    category: "travel",
    generationTemplate:
      "Create a luxury island destination visual with crystalline turquoise water, lush tropical vegetation, sculpted sunlight, and serene high-end travel-editorial composition. Feature one destination-defining focal subject with clean horizon control, atmospheric depth, and refined color grading that feels aspirational yet natural. Emphasize material realism in water, foliage, and sky for polished postcard-meets-campaign quality. High detail, no text, no watermark. Compose with destination storytelling, atmospheric clarity, and aspirational but believable environmental color. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Island Destination Ventures Group, engineered with luxury-grade campaign craftsmanship and multi-format cutdown flexibility with no quality loss; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an island-luxury aesthetic by enhancing coastal water clarity, tropical environmental richness, and golden natural light while preserving subject identity, scene geometry, and composition flow. Keep tones elegant and believable, not oversaturated tourism effects. Final image should feel premium travel campaign ready. Upgrade destination atmosphere and color depth while preserving location coherence and aspirational realism. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Island Destination Ventures Group, enforcing art-director signoff-level finishing control and preventing feature drift across eyes, mouth, and landmark geometry; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "muddy water color, gray lifeless sky, overcrowded beach clutter, plastic foliage, blown tropical highlights, cheap postcard saturation, flat depth, dirty shoreline details, low-end vacation snapshot look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "nature",
    label: "Nature",
    subtitle: "Majestic scenic calm",
    category: "landscape",
    generationTemplate:
      "Create a majestic nature scene with ecologically believable textures, layered landscape depth, and nuanced natural light that guides the eye to one clear focal vista or subject. Use atmospheric perspective, organic color harmony, and balanced composition to evoke calm wonder without artificial exaggeration. Deliver premium scenic realism with crisp detail in terrain, vegetation, and sky, suitable for editorial environmental storytelling. High detail, no text, no watermark. Layer terrain, sky, and atmospheric perspective to create believable ecological depth and calm cinematic realism. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Nature Environmental Media Group, engineered with Fortune-10 launch polish and storefront signage impact and product-page precision; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a refined nature-forward aesthetic with improved environmental depth, natural light behavior, and organic texture fidelity while preserving core subject placement and spatial structure. Keep composition serene, readable, and physically coherent. Output should feel immersive and high-end, not overprocessed wallpaper. Enhance natural depth and environmental realism while preserving geographic coherence and ecological believability. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Nature Environmental Media Group, enforcing precision-grade structural integrity controls and retaining every high-value detail that supports recognizability; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "neon green contamination, HDR halo artifacts, plastic vegetation, cluttered foreground noise, flat sky light, muddy earth tones, over-sharpened edges, fake depth blur, generic calendar wallpaper look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "history",
    label: "Historic Archive",
    subtitle: "Museum-grade gravitas",
    category: "historical",
    generationTemplate:
      "Create a museum-grade historical portrait or scene with archival tonal restraint, period-respectful materials, and dignified cinematic gravitas. Build one focal subject or event moment supported by believable heritage environment cues, time-worn textures, and disciplined composition. Prioritize historical atmosphere, craftsmanship, and emotional seriousness over spectacle, delivering premium documentary-art quality. High detail, no text, no watermark. Preserve period authenticity through wardrobe, materials, and lighting cues that feel researched rather than costume-like. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar History Heritage Storytelling Group, engineered with C-suite approval-ready finishing and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a historically grounded aesthetic with archival color treatment, aged material language, and period-aware atmosphere while preserving identity, anatomy, and composition integrity. Remove modern visual cues and reinforce believable historical context without caricature. Final output should feel curated, respectful, and museum-ready. Translate modern cues into period-authentic treatment while preserving identity, respectful context, and believable era details. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar History Heritage Storytelling Group, enforcing enterprise QA-ready visual consistency and enforcing clean edges, realistic material response, and artifact-free output; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "modern props or devices, anachronistic styling, fantasy stereotype mashup, neon lighting, plastic textures, cheap costume drama look, cartoon history treatment, inaccurate period cues, low-budget reenactment vibe",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "baby",
    label: "Baby Portrait",
    subtitle: "Tender family editorial",
    category: "family",
    generationTemplate:
      "Create a tender baby portrait or family scene with soft diffused lighting, gentle tonal warmth, and emotionally safe, peaceful mood. Keep one clear baby focal subject with clean composition, natural skin texture, and delicate pastel-neutral palette suited to premium family editorial photography. Emphasize innocence, comfort, and high-end photographic polish while preserving authenticity and calm readability. High detail, no text, no watermark. Maintain a safe, warm emotional tone with gentle light shaping, natural expression fidelity, and comforting composition. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Baby Family Wellness Group, engineered with boardroom-level art direction and magazine-cover authority and mobile-feed retention; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a premium baby-editorial aesthetic by softening light quality, refining skin tones, and creating calm emotional atmosphere while preserving identity, natural proportions, and expression. Maintain scene cleanliness and gentle tonal balance with no uncanny exaggeration. Final result should feel warm, safe, and professionally photographed. Soften and refine family portrait tone while preserving authentic expressions, age-appropriate anatomy, and gentle realism. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Baby Family Wellness Group, enforcing brand-safe transformation reliability and keeping the scene coherent while upgrading mood, polish, and depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "uncanny facial distortion, harsh flash lighting, plastic skin retouching, creepy expression, heavy makeup styling, oversaturated tones, cluttered nursery chaos, scary shadows, awkward baby anatomy, low-end mall portrait look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "1800s",
    label: "Nineteenth Century",
    subtitle: "Nineteenth-century realism",
    category: "historical",
    generationTemplate:
      "Create a historically believable 1800s portrait or scene with period-authentic garments, architectural cues, and natural or candle-motivated lighting consistent with nineteenth-century visual culture. Compose around one dignified focal subject with textile richness, restrained palette, and grounded social context rather than fantasy theatrics. Deliver cinematic old-world realism with refined detail and respectful period accuracy. High detail, no text, no watermark. Preserve period authenticity through wardrobe, materials, and lighting cues that feel researched rather than costume-like. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar 1800s Heritage Storytelling Group, engineered with C-suite approval-ready finishing and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an 1800s aesthetic by applying period-correct wardrobe mood, material aging, and era-appropriate lighting while preserving subject identity, pose intent, and scene composition. Remove modern stylistic contamination and maintain believable historical coherence. Output should feel like curated historical portraiture, not costume-play. Translate modern cues into period-authentic treatment while preserving identity, respectful context, and believable era details. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar 1800s Heritage Storytelling Group, enforcing enterprise QA-ready visual consistency and maintaining exact identity anchors while elevating cinematic depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "modern fashion cuts, contemporary makeup, visible electronics, neon lighting, synthetic costume sheen, fantasy anachronisms, cartoon treatment, inaccurate period props, low-budget historical drama look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "2080-futuristic-sci-fi-society",
    label: "Future Society 2080",
    subtitle: "Next-gen civilization design",
    category: "sci_fi",
    generationTemplate:
      "Create a sophisticated 2080 future-society visual with plausible advanced infrastructure, intelligent mobility, elegant interface systems, and cinematic urban scale. Establish one focal subject or environment anchor, then support it with coherent world-building, premium material behavior, and believable near-future lighting logic. Aim for polished high-budget sci-fi realism that feels innovative, aspirational, and technologically credible. High detail, no text, no watermark. Ground futurism in plausible design language, coherent infrastructure, and disciplined technology aesthetics. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar 2080 Futuristic Sci Fi Society Future Systems Group, engineered with high-stakes executive review quality and campaign-key-visual strength across paid and owned media; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a 2080 futuristic-society aesthetic by introducing coherent advanced architecture, interface language, and material-tech lighting while preserving subject identity, spatial structure, and compositional readability. Keep futurism disciplined and believable rather than chaotic cyber clutter. Final output should feel like premium concept art for a major studio IP. Introduce advanced future design elements while preserving spatial structure and clear subject readability. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar 2080 Futuristic Sci Fi Society Future Systems Group, enforcing strict composition-lock transformation control and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "generic cyberpunk cliches, random neon overload, toy-like gadgets, hologram clutter spam, incoherent world logic, dystopian grime by default, muddy contrast, low-detail sci-fi props, cheap concept-art kitbash look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "logo-creator",
    label: "Logo Studio",
    subtitle: "Brand mark precision",
    category: "identity",
    generationTemplate:
      "Create a world-class logo concept with strategic icon-first thinking, mathematically clean geometry, disciplined negative space, and strong memorability at small and large scale. Focus on one dominant mark with precise proportion logic, balanced visual weight, and premium brand-system potential across digital and physical surfaces. Keep the output crisp, distinctive, and commercially viable, with restrained style choices that prioritize identity longevity over trend noise. High detail, no watermark; avoid text unless explicitly requested. Enforce logo-system rigor with geometric precision, balanced negative space, and clarity across small and large scale applications. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Logo Creator Identity Architecture Group, engineered with cross-market premium consistency and storefront signage impact and product-page precision; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image or concept into a premium logo-creator direction by refining geometry, silhouette clarity, and brand logic while preserving the core identity idea and recognizability. Strengthen scalability, spacing, and icon integrity so the mark functions across real product surfaces. Final output must feel original, strategic, and production-ready rather than decorative art. Refine symbol geometry and spacing precision while preserving the core brand concept and scalable mark integrity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Logo Creator Identity Architecture Group, enforcing brand-safe transformation reliability and ensuring downstream reuse in web, print, and paid media without rework; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "clipart appearance, overcomplicated emblem clutter, weak silhouette memory, poor symmetry, random gradient gimmicks, stock-logo similarity, illegible micro-detail, trend-chasing effects, low differentiation brand confusion",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "luxury-product-campaign",
    label: "Luxury Campaign",
    subtitle: "Upscale commercial clarity",
    category: "commercial",
    generationTemplate:
      "Create an elite luxury product campaign visual with immaculate studio light control, premium material realism, elegant set design, and aspirational editorial composition. Feature one hero product with pristine edge definition, intentional reflection choreography, and refined color storytelling built for high-conversion advertising. Aim for global-brand campaign polish: cinematic depth, tactile detail, and flawless premium finish suitable for print, web, and billboard. High detail, no text, no watermark. Build conversion-oriented visual hierarchy with a dominant hero subject, luxury polish, and high-retention clarity for campaign use. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Luxury Product Campaign Commercial Strategy Group, engineered with high-stakes executive review quality and global regionalization resilience without style drift; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a luxury product-campaign aesthetic by rebuilding lighting, material response, and compositional elegance while preserving core product identity, geometry, and key branding cues. Increase visual hierarchy and tactile realism without introducing clutter. Final output should look like a top-tier commercial hero image, not an ecommerce snapshot. Elevate to campaign-grade polish while preserving product geometry, branding essentials, and purchase-driving clarity. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Luxury Product Campaign Commercial Strategy Group, enforcing high-risk publish-safe correction discipline and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "cheap ecommerce vibe, cluttered set props, muddy reflections, flat lighting, blown glare hotspots, noisy backdrop, inaccurate material texture, oversaturated color cast, weak hero focus, low-budget ad quality",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "cinematic-noir",
    label: "Cinematic Noir",
    subtitle: "Shadow-rich film tension",
    category: "editorial",
    generationTemplate:
      "Create a cinematic noir frame with deep chiaroscuro contrast, shadow-rich spatial tension, and selective highlight control that guides attention to one focal subject. Use moody atmosphere, smoke or rain cues where appropriate, and restrained palette discipline to evoke classic noir gravitas with modern premium detail. Compose like a film still with intentional blocking, narrative ambiguity, and polished editorial darkness. High detail, no text, no watermark. Stage the scene with magazine-grade intent, balancing narrative tension, negative space, and controlled tonal drama. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Cinematic Noir Editorial Studios Group, engineered with cross-market premium consistency and campaign-key-visual strength across paid and owned media; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a cinematic-noir aesthetic by restructuring light into strong shadow architecture, controlled highlights, and tense atmospheric depth while preserving identity, pose, and scene coherence. Maintain readable focal hierarchy and avoid crushing essential detail. Final output should feel like high-end film still direction, not a generic dark filter. Increase editorial drama while keeping story logic, subject legibility, and publication-ready framing discipline. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Cinematic Noir Editorial Studios Group, enforcing high-risk publish-safe correction discipline and ensuring downstream reuse in web, print, and paid media without rework; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "bright cheerful lighting, candy-color palette, flat contrast, crushed detail in blacks, blown speculars, cheesy costume noir parody, cluttered composition, weak narrative mood, low-detail atmosphere",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "maison-interior",
    label: "Maison Interior",
    subtitle: "Architectural luxury calm",
    category: "interior",
    generationTemplate:
      "Create a refined maison interior visual with architectural balance, curated furnishings, premium natural materials, and calm luxury atmosphere. Compose one focal room zone with clean circulation lines, coherent perspective, and soft controlled daylight or ambient lighting for editorial interior-photography quality. Emphasize tactile surfaces, restrained palette harmony, and spatial serenity with high-end design-mag polish. High detail, no text, no watermark. Protect interior perspective lines and circulation flow while elevating materials, styling restraint, and editorial atmosphere. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Maison Interior Spatial Design Group, engineered with C-suite approval-ready finishing and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a maison-interior aesthetic by elevating material palette, furniture curation, and architectural light behavior while preserving room structure, perspective integrity, and functional layout. Refine visual hierarchy so the space feels intentional and breathable. Final output should read like top-tier interior editorial, not staged real-estate flash photography. Elevate interior styling and light behavior while preserving room layout, perspective correctness, and functional usability. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Maison Interior Spatial Design Group, enforcing pixel-accountable production rigor and locking structural continuity for scalable campaign adaptation; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "cheap furniture styling, clutter overload, distorted room perspective, harsh flash hotspots, muddy textures, plastic material finish, random decor noise, poor spatial flow, low-end rental listing look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "mansion",
    label: "Grand Estate",
    subtitle: "Grand estate luxury",
    category: "architecture",
    generationTemplate:
      "Create a grand mansion visual with stately architecture, luxury finishes, and cinematic estate atmosphere built around one commanding focal architectural moment. Use disciplined symmetry or intentional asymmetry, refined landscaping or interior grandeur, and premium scale cues that communicate wealth without clutter. Apply elegant lighting, crisp material realism, and polished editorial composition suitable for prestige real-estate campaigns. High detail, no text, no watermark. Emphasize architectural proportion, material authenticity, and scale cues so structural lines remain elegant, believable, and spatially grounded. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Mansion Architectural Development Group, engineered with Fortune-10 launch polish and launch-event screen presence and catalog consistency; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a mansion aesthetic by upgrading architectural detail, finish quality, and estate-level atmosphere while preserving structural geometry, perspective, and subject placement. Strengthen scale perception, material fidelity, and compositional hierarchy with high-end polish. Final output should feel elite and believable, not ostentatious CGI excess. Upgrade architectural mood and finish quality while keeping structural geometry, vanishing points, and layout function consistent. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Mansion Architectural Development Group, enforcing forensic-level facial and geometry stability and balancing transformation intensity with documentary-level subject integrity; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "tract-house suburban cues, cheap finish materials, cluttered grounds, weak symmetry control, distorted proportions, harsh realtor flash, muddy stone or wood textures, low-end staging, generic stock property look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "cartoon",
    label: "Studio Cartoon",
    subtitle: "Premium animation charm",
    category: "illustration",
    generationTemplate:
      "Create a premium cartoon illustration with confident shape design, expressive posing, clean contour rhythm, and vibrant but controlled color styling. Build one dominant focal subject with strong silhouette hierarchy, readable staging, and animation-studio-level charm that remains coherent at first glance. Maintain stylized material logic, lively emotional tone, and polished production quality without drifting into clipart or flat generic simplification. High detail, no text, no watermark. Drive illustration quality through intentional line hierarchy, shape economy, and stylized form simplification with readable gesture and story-forward framing. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Cartoon Creative Media Group, engineered with high-stakes executive review quality and social-first punch with cinema-poster depth; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a polished cartoon aesthetic with deliberate stylization, smooth form simplification, and expressive character readability while preserving identity-defining features and composition balance. Keep anatomy stylized yet coherent, with clean line quality and intentional color blocking. Final output should feel professionally animated, not low-effort sticker art. Translate photographic detail into authored illustrated language while keeping silhouette identity, gesture intent, and focal readability intact. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Cartoon Creative Media Group, enforcing brand-safe transformation reliability and keeping the scene coherent while upgrading mood, polish, and depth; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "clipart stiffness, muddy palette, messy inconsistent outlines, weak silhouette readability, broken stylized anatomy, random texture noise, flat expression, style drift across elements, cheap children-app art look",
    planTier: "premium",
    featured: false,
  },
  {
    slug: "video-game",
    label: "AAA Game",
    subtitle: "Cinematic worldbuilding",
    category: "gaming",
    generationTemplate:
      "Create AAA-grade video-game key art with one heroic focal subject, immersive world-building, cinematic camera blocking, and production-level environment detail. Use dramatic but readable lighting, depth layering, and material consistency to balance spectacle with gameplay clarity. Deliver polished blockbuster presentation suitable for store capsule art, launch campaign visuals, or narrative splash screens. High detail, no text, no watermark. Compose like premium key art with strong focal hierarchy, world-building cues, and gameplay-readable silhouettes. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Video Game Interactive Entertainment Group, engineered with investor-deck visual rigor and billboard-scale readability and app-thumbnail clarity; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a high-end video-game aesthetic with cinematic rendering, world-detail enrichment, and gameplay-readable composition while preserving subject identity, pose integrity, and scene logic. Maintain strong focal hierarchy and coherent visual language across character, props, and environment. Final image should feel like official key art from a premium studio title. Push toward AAA key-art rendering while preserving core character identity, gameplay-readable forms, and world logic. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Video Game Interactive Entertainment Group, enforcing enterprise QA-ready visual consistency and retaining every high-value detail that supports recognizability; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "mobile-game cheapness, low-poly artifacts, muddy textures, toy-like props, flat uninspired lighting, UI-like clutter, weak depth staging, generic fantasy mashup, low-budget concept render quality",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "car",
    label: "Automotive",
    subtitle: "Editorial automotive polish",
    category: "automotive",
    generationTemplate:
      "Create a premium automotive campaign image with one hero vehicle, precision body-line rendering, and controlled reflection choreography across paint, glass, and metal surfaces. Use cinematic road or studio context, intentional camera angle (performance editorial feel), and clean composition that emphasizes stance, proportion, and brand character. Deliver luxury-commercial polish with believable materials, crisp detail, and high-impact ad-grade finish. High detail, no text, no watermark. Prioritize vehicle stance accuracy, body-line continuity, and paint reflection choreography so performance character reads instantly. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Car Mobility Engineering Group, engineered with global franchise hero-asset quality and hero-asset durability for long-horizon brand programs; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into an automotive-editorial aesthetic with upgraded lighting design, paint-reflection quality, and campaign-level composition while preserving vehicle identity, geometry accuracy, angle, and wheel-body proportions. Maintain realistic material behavior and environmental coherence. Final output should feel like a flagship auto ad, not a dealership photo. Enhance automotive lighting and reflections while preserving make-model identity, body geometry, and wheel alignment. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Car Mobility Engineering Group, enforcing enterprise QA-ready visual consistency and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "distorted body proportions, warped wheel geometry, muddy paint reflections, flat overcast dullness, harsh flash glare, cluttered lot background, fake motion blur streaks, low-detail rims, cheap dealership brochure look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "3d",
    label: "3D Render",
    subtitle: "High-end rendered depth",
    category: "3d",
    generationTemplate:
      "Create a high-end 3D render with sculptural form clarity, physically coherent materials, and cinematic light transport that reveals depth and surface quality. Anchor one focal subject with clean composition, controlled camera perspective, and premium rendering discipline suitable for editorial or commercial hero imagery. Emphasize edge integrity, nuanced specular behavior, and polished finish that avoids low-poly or synthetic shortcuts. High detail, no text, no watermark. Model every form as a physical object with coherent volume, realistic surface behavior, and studio-calibrated reflections that feel premium and manufacturable. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar 3d Product Experience Group, engineered with enterprise-scale brand discipline and social-first punch with cinema-poster depth; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a premium 3D-rendered aesthetic by translating forms into coherent modeled volume, refined material response, and cinematic lighting while preserving identity, composition structure, and visual balance. Keep geometry clean and proportional, with believable depth and surface behavior. Final output should feel production-render quality, not toy-like CGI. Reconstruct forms into believable modeled volumes and material shaders while maintaining exact pose logic and object proportions. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar 3d Product Experience Group, enforcing global creative-ops handoff reliability and holding focal hierarchy stable while rebuilding light and texture quality; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "low-poly faceting, jagged aliasing, muddy material response, fake reflection maps, weak depth separation, noisy render grain, overblown highlights, cluttered staging, cheap CGI game-prototype look",
    planTier: "premium_plus",
    featured: false,
  },
  {
    slug: "realistic-tattoo",
    label: "Tattoo Realism",
    subtitle: "Authentic wearable ink realism",
    category: "tattoo",
    generationTemplate:
      "Create a highly realistic tattoo visual with artist-grade line confidence, controlled shading gradients, believable ink saturation, and anatomically intelligent placement on skin. Focus on one hero tattoo concept with clean composition, epidermal texture interaction, and studio-quality craftsmanship that feels truly wearable. Preserve authentic tattoo discipline: line hierarchy, skin curvature adaptation, healed-ink realism, and premium close-detail clarity. High detail, no text, no watermark. Honor professional tattoo craftsmanship with precise line confidence, skin-contour integration, and realistic healed-ink behavior. Compose with premium editorial discipline: establish foreground-midground-background separation, shape light with intentional falloff, and preserve natural texture in both highlights and shadows instead of clipping or mud. Render with clean edge integrity, believable material response, and subtle atmospheric depth so the final frame feels authored, emotionally charged, and campaign-ready at both thumbnail and full-size viewing. Treat this as a flagship visual commissioned by the multi-trillion-dollar Realistic Tattoo Body Art Craft Group, engineered with C-suite approval-ready finishing and campaign-key-visual strength across paid and owned media; final output must meet enterprise-grade launch standards for global rollout across web, social, OOH, print, and executive review decks without losing stylistic authenticity.",
    editTemplate:
      "Transform the uploaded image into a realistic tattoo treatment by applying professional linework, balanced black-and-gray or color packing, and believable ink-on-skin integration while preserving subject identity, anatomy, placement logic, and overall composition. Maintain skin texture realism and body contour coherence to avoid sticker-like overlays. Final result should look like expert tattoo artistry, not digital decal effects. Integrate tattoo aesthetics with skin texture and anatomy while preserving placement logic and professional ink realism. Preserve identity anchors and structural continuity while upgrading the visual language: keep facial landmarks, body proportions, perspective logic, and key compositional geometry stable unless explicitly transformed by the requested style. Rebuild lighting, texture, and tonal depth with high-end finishing discipline so the output looks purposefully art-directed, physically coherent, and publication-ready instead of filter-driven. Execute this transformation as final-delivery artwork for the multi-trillion-dollar Realistic Tattoo Body Art Craft Group, enforcing identity-critical preservation discipline and preserving core silhouette memory while refining micro-contrast and tone; keep all identity-critical anchors intact while raising lighting, texture, tonal depth, and polish to enterprise campaign standards that survive strict cross-channel QA.",
    negativePrompt:
      "sticker decal appearance, blurry linework, muddy shading, warped anatomy, inconsistent ink density, cartoon tattoo style, distorted placement over joints, plastic skin texture, over-contrasted fake tattoo filter",
    planTier: "premium_plus",
    featured: false,
  },
];

const PRESET_THUMBNAIL_OVERRIDES: Record<string, string> = {
  "retro-anime": "/cavai-assets/retro-anime.PNG",
  storybook: "/cavai-assets/storybook.PNG",
  crayon: "/cavai-assets/crayon.PNG",
  doodle: "/cavai-assets/doodle.PNG",
  inkwork: "/cavai-assets/inwork.PNG",
  watercolor: "/cavai-assets/watercolor.PNG",
  plushie: "/cavai-assets/plushy.PNG",
  "clay-figure": "/cavai-assets/clay-figure.PNG",
  "3d-glam-doll": "/cavai-assets/3d-doll.PNG",
  bobblehead: "/cavai-assets/wobble-head.PNG",
  mascot: "/cavai-assets/mascot.PNG",
  "caricature-trend": "/cavai-assets/caricature.PNG",
  camcorder: "/cavai-assets/camrecorder.PNG",
  paparazzi: "/cavai-assets/paparazii.PNG",
  "oil-painting": "/cavai-assets/oil-painting.PNG",
  gold: "/cavai-assets/gold.PNG",
  fisheye: "/cavai-assets/fisheye.PNG",
  "neon-fantasy": "/cavai-assets/neon-fantasy.PNG",
  "iridescent-metal-portrait": "/cavai-assets/iridescent.PNG",
  "cyber-drift": "/cavai-assets/cyber-drift.PNG",
  "dreamcore-collage": "/cavai-assets/dreamcore.PNG",
  island: "/cavai-assets/island.PNG",
  nature: "/cavai-assets/nature.PNG",
  history: "/cavai-assets/history.PNG",
  baby: "/cavai-assets/baby.PNG",
  "1800s": "/cavai-assets/1800.PNG",
  "2080-futuristic-sci-fi-society": "/cavai-assets/2080.PNG",
  "logo-creator": "/cavai-assets/logo-creator.PNG",
  "luxury-product-campaign": "/cavai-assets/product-campaign.PNG",
  "cinematic-noir": "/cavai-assets/cinematic-noir.PNG",
  "maison-interior": "/cavai-assets/maison.PNG",
  mansion: "/cavai-assets/mansion.PNG",
  cartoon: "/cavai-assets/cartoon.PNG",
  "video-game": "/cavai-assets/game.PNG",
  car: "/cavai-assets/car.PNG",
  "3d": "/cavai-assets/3D.PNG",
  "realistic-tattoo": "/cavai-assets/tattoo.PNG",
  iconic: "/cavai-assets/iconic.PNG",
  "norman-rockwell": "/cavai-assets/norman.PNG",
  "flower-petals": "/cavai-assets/flower-petal.PNG",
  "dramatic-portrait": "/cavai-assets/dramatic-portrait.PNG",
  "sugar-cookie": "/cavai-assets/sugar-cookie.PNG",
  ornament: "/cavai-assets/ornament.PNG",
  "medieval-times": "/cavai-assets/midevial.PNG",
  "taino-heritage": "/cavai-assets/taino.PNG",
  "post-rain-sunset": "/cavai-assets/sunset.PNG",
};

function resolvePresetThumbnailUrl(slugRaw: string): string {
  const slug = s(slugRaw).toLowerCase();
  const override = s(PRESET_THUMBNAIL_OVERRIDES[slug]);
  if (override) return override;
  return `/image-studio/presets/${slug}.svg`;
}

let tablesReady = false;
let tablesReadyPromise: Promise<void> | null = null;
let presetsSeeded = false;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function parsePlanTier(value: unknown): ImageStudioPlanTier {
  const normalized = s(value).toLowerCase();
  if (normalized === "premium_plus") return "premium_plus";
  if (normalized === "premium") return "premium";
  return "free";
}

function planRank(plan: ImageStudioPlanTier): number {
  if (plan === "premium_plus") return 3;
  if (plan === "premium") return 2;
  return 1;
}

function runtimeImageStudioSchemaBootstrapEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return s(process.env.CAVBOT_IMAGE_STUDIO_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP) === "1";
}

async function loadExistingImageStudioTableSet(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ table_name?: string }>>(
    Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN (${Prisma.join(IMAGE_STUDIO_REQUIRED_TABLES.map((name) => Prisma.sql`${name}`))})
    `,
  );

  return new Set(
    rows
      .map((row) => s(row.table_name).toLowerCase())
      .filter(Boolean),
  );
}

function imageStudioStorageUnavailableError(message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), {
    status: 503,
    code: "IMAGE_STUDIO_STORAGE_UNAVAILABLE",
  });
}

function extensionForMime(mimeType: string): string {
  const normalized = s(mimeType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("bmp")) return "bmp";
  return "png";
}

function normalizeFileName(raw: string, fallback = "image"): string {
  const cleaned = s(raw)
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function clampSummary(input: string, max = 220): string {
  const text = s(input);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildPresetId(slug: string): string {
  return `imgpreset_${slug.replace(/[^a-z0-9]+/gi, "_")}`;
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const raw = s(dataUrl);
  const match = raw.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mimeType = s(match[1]).toLowerCase() || "image/png";
  const base64 = s(match[2]);
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return null;
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${s(mimeType) || "image/png"};base64,${buffer.toString("base64")}`;
}

function bufferToReadableStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

async function webStreamToBuffer(stream: ReadableStream<Uint8Array> | null): Promise<Buffer | null> {
  if (!stream) return null;
  const response = new Response(stream);
  const arrayBuffer = await response.arrayBuffer();
  const out = Buffer.from(arrayBuffer);
  return out.length ? out : null;
}

function inferImageFormatFromMime(mimeType: string): string {
  const normalized = s(mimeType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpeg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "png";
}

export function toImageStudioPlanTier(planId: PlanId): ImageStudioPlanTier {
  if (planId === "premium_plus") return "premium_plus";
  if (planId === "premium") return "premium";
  return "free";
}

export async function ensureImageStudioTables(): Promise<void> {
  if (tablesReady) return;
  if (!tablesReadyPromise) {
    tablesReadyPromise = (async () => {
      const existingTables = await loadExistingImageStudioTableSet().catch(() => null);
      if (existingTables && IMAGE_STUDIO_REQUIRED_TABLES.every((tableName) => existingTables.has(tableName))) {
        tablesReady = true;
        return;
      }

      if (!runtimeImageStudioSchemaBootstrapEnabled()) {
        throw imageStudioStorageUnavailableError(
          "Image Studio storage schema is unavailable and runtime bootstrap is disabled."
        );
      }

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS image_presets (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          subtitle TEXT,
          thumbnail_url TEXT,
          category TEXT NOT NULL,
          generation_prompt_template TEXT NOT NULL,
          edit_prompt_template TEXT NOT NULL,
          negative_prompt TEXT,
          plan_tier VARCHAR(32) NOT NULL DEFAULT 'premium',
          display_order INTEGER NOT NULL DEFAULT 0,
          is_featured BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS image_jobs (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id VARCHAR(120),
          request_id VARCHAR(120),
          plan_tier VARCHAR(32) NOT NULL,
          mode VARCHAR(24) NOT NULL,
          action_source VARCHAR(64),
          agent_id VARCHAR(64),
          agent_action_key VARCHAR(64),
          prompt TEXT NOT NULL,
          resolved_prompt TEXT NOT NULL,
          preset_id TEXT,
          model_used VARCHAR(120) NOT NULL,
          status VARCHAR(24) NOT NULL,
          errors TEXT,
          input_asset_refs JSONB,
          output_asset_refs JSONB,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS image_assets (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          job_id TEXT,
          preset_id TEXT,
          source_kind VARCHAR(64) NOT NULL,
          original_source VARCHAR(64),
          file_name VARCHAR(280),
          mime_type VARCHAR(120) NOT NULL DEFAULT 'image/png',
          bytes INTEGER NOT NULL DEFAULT 0,
          width INTEGER,
          height INTEGER,
          format VARCHAR(40),
          file_location TEXT,
          cavcloud_file_id VARCHAR(120),
          cavcloud_key TEXT,
          cavsafe_file_id VARCHAR(120),
          cavsafe_key TEXT,
          external_url TEXT,
          data_url TEXT,
          b64_data TEXT,
          source_prompt TEXT,
          metadata_json JSONB,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS job_id TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS preset_id TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS source_kind VARCHAR(64) NOT NULL DEFAULT 'generated';
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS original_source VARCHAR(64);
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS file_name VARCHAR(280);
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120) NOT NULL DEFAULT 'image/png';
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS bytes INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS width INTEGER;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS height INTEGER;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS format VARCHAR(40);
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS file_location TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavcloud_file_id VARCHAR(120);
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavcloud_key TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavsafe_file_id VARCHAR(120);
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavsafe_key TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS external_url TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS data_url TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS b64_data TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS source_prompt TEXT;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS metadata_json JSONB;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_image_history (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          job_id TEXT,
          asset_id TEXT,
          entry_type VARCHAR(48) NOT NULL,
          mode VARCHAR(24),
          prompt_summary TEXT,
          saved BOOLEAN NOT NULL DEFAULT FALSE,
          saved_target VARCHAR(32),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS job_id TEXT;
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS asset_id TEXT;
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS entry_type VARCHAR(48) NOT NULL DEFAULT 'history';
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS mode VARCHAR(24);
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS prompt_summary TEXT;
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS saved_target VARCHAR(32);
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS agent_install_state (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          surface VARCHAR(24) NOT NULL,
          agent_id VARCHAR(64) NOT NULL,
          installed BOOLEAN NOT NULL DEFAULT TRUE,
          plan_tier VARCHAR(32) NOT NULL,
          metadata_json JSONB,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(account_id, user_id, surface, agent_id)
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS image_presets_active_order_idx ON image_presets (is_active, display_order, updated_at);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS image_jobs_account_user_created_idx ON image_jobs (account_id, user_id, created_at DESC);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS image_jobs_account_user_status_idx ON image_jobs (account_id, user_id, status, created_at DESC);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS image_assets_account_user_created_idx ON image_assets (account_id, user_id, created_at DESC);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_image_history_account_user_created_idx ON user_image_history (account_id, user_id, created_at DESC);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_image_history_account_user_saved_idx ON user_image_history (account_id, user_id, saved, created_at DESC);
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS agent_install_state_lookup_idx ON agent_install_state (account_id, user_id, surface, installed, updated_at DESC);
      `);

      tablesReady = true;
    })();
  }

  try {
    await tablesReadyPromise;
  } finally {
    tablesReadyPromise = null;
  }
}

export async function ensureImageStudioPresetSeedData(): Promise<void> {
  await ensureImageStudioTables();
  if (presetsSeeded) return;

  for (let index = 0; index < PRESET_SEED.length; index += 1) {
    const preset = PRESET_SEED[index];
    const id = buildPresetId(preset.slug);
    const thumbnailUrl = resolvePresetThumbnailUrl(preset.slug);

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO image_presets (
          id,
          slug,
          label,
          subtitle,
          thumbnail_url,
          category,
          generation_prompt_template,
          edit_prompt_template,
          negative_prompt,
          plan_tier,
          display_order,
          is_featured,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${preset.slug},
          ${preset.label},
          ${preset.subtitle},
          ${thumbnailUrl},
          ${preset.category},
          ${preset.generationTemplate},
          ${preset.editTemplate},
          ${preset.negativePrompt},
          ${preset.planTier},
          ${index + 1},
          ${preset.featured},
          true,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (slug)
        DO UPDATE SET
          label = EXCLUDED.label,
          subtitle = EXCLUDED.subtitle,
          thumbnail_url = EXCLUDED.thumbnail_url,
          category = EXCLUDED.category,
          generation_prompt_template = EXCLUDED.generation_prompt_template,
          edit_prompt_template = EXCLUDED.edit_prompt_template,
          negative_prompt = EXCLUDED.negative_prompt,
          plan_tier = EXCLUDED.plan_tier,
          display_order = EXCLUDED.display_order,
          is_featured = EXCLUDED.is_featured,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
      `,
    );
  }

  if (LEGACY_DISABLED_PRESET_SLUGS.length) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE image_presets
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE slug IN (${Prisma.join(LEGACY_DISABLED_PRESET_SLUGS.map((slug) => Prisma.sql`${slug}`))})
      `,
    );
  }

  presetsSeeded = true;
}

function mapPresetRow(args: {
  row: Record<string, unknown>;
  userPlanTier: ImageStudioPlanTier;
}): ImagePresetRecord {
  const presetPlan = parsePlanTier(args.row.plan_tier);
  const slug = s(args.row.slug);
  const thumbnailOverride = s(PRESET_THUMBNAIL_OVERRIDES[slug.toLowerCase()]);
  return {
    id: s(args.row.id),
    slug,
    label: s(args.row.label),
    subtitle: s(args.row.subtitle) || null,
    thumbnailUrl: thumbnailOverride || s(args.row.thumbnail_url) || null,
    category: s(args.row.category),
    generationPromptTemplate: s(args.row.generation_prompt_template),
    editPromptTemplate: s(args.row.edit_prompt_template),
    negativePrompt: s(args.row.negative_prompt) || null,
    planTier: presetPlan,
    displayOrder: toInt(args.row.display_order),
    isFeatured: args.row.is_featured === true,
    isActive: args.row.is_active === true,
    createdAtISO: toIso(args.row.created_at),
    updatedAtISO: toIso(args.row.updated_at),
    locked: planRank(args.userPlanTier) < planRank(presetPlan),
  };
}

function buildStaticPresetRecords(userPlanTier: ImageStudioPlanTier): ImagePresetRecord[] {
  return PRESET_SEED
    .map((preset, index) => ({
      id: buildPresetId(preset.slug),
      slug: preset.slug,
      label: preset.label,
      subtitle: preset.subtitle || null,
      thumbnailUrl: resolvePresetThumbnailUrl(preset.slug),
      category: preset.category,
      generationPromptTemplate: preset.generationTemplate,
      editPromptTemplate: preset.editTemplate,
      negativePrompt: preset.negativePrompt || null,
      planTier: preset.planTier,
      displayOrder: index + 1,
      isFeatured: preset.featured,
      isActive: !LEGACY_DISABLED_PRESET_SLUG_SET.has(preset.slug),
      createdAtISO: STATIC_IMAGE_PRESET_TIMESTAMP_ISO,
      updatedAtISO: STATIC_IMAGE_PRESET_TIMESTAMP_ISO,
      locked: planRank(userPlanTier) < planRank(preset.planTier),
    }))
    .filter((preset) => preset.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export async function listImagePresetsForPlan(args: {
  planTier: ImageStudioPlanTier;
  includeLocked?: boolean;
}): Promise<ImagePresetClientRecord[]> {
  let mapped: ImagePresetRecord[] = [];

  try {
    await ensureImageStudioTables();
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT
          id,
          slug,
          label,
          subtitle,
          thumbnail_url,
          category,
          generation_prompt_template,
          edit_prompt_template,
          negative_prompt,
          plan_tier,
          display_order,
          is_featured,
          is_active,
          created_at,
          updated_at
        FROM image_presets
        WHERE is_active = true
        ORDER BY display_order ASC, updated_at DESC
      `,
    );

    if (rows.length) {
      mapped = rows.map((row) => mapPresetRow({ row, userPlanTier: args.planTier }));
    }
  } catch {}

  if (!mapped.length) {
    mapped = buildStaticPresetRecords(args.planTier);
  }

  const visible = args.includeLocked ? mapped : mapped.filter((row) => !row.locked);
  return visible.map((preset) => toImagePresetClientRecord(preset));
}

export async function getImagePresetById(args: {
  presetId?: string | null;
  slug?: string | null;
  planTier: ImageStudioPlanTier;
}): Promise<ImagePresetRecord | null> {
  const presetId = s(args.presetId);
  const slug = s(args.slug);
  if (!presetId && !slug) return null;

  try {
    await ensureImageStudioTables();

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT
          id,
          slug,
          label,
          subtitle,
          thumbnail_url,
          category,
          generation_prompt_template,
          edit_prompt_template,
          negative_prompt,
          plan_tier,
          display_order,
          is_featured,
          is_active,
          created_at,
          updated_at
        FROM image_presets
        WHERE is_active = true
          AND (${presetId} = '' OR id = ${presetId} OR slug = ${presetId})
          AND (${slug} = '' OR slug = ${slug})
        ORDER BY display_order ASC
        LIMIT 1
      `,
    );

    const row = rows[0];
    if (row) {
      return mapPresetRow({ row, userPlanTier: args.planTier });
    }
  } catch {}

  return (
    buildStaticPresetRecords(args.planTier).find((preset) => {
      if (presetId && (preset.id === presetId || preset.slug === presetId)) return true;
      if (slug && preset.slug === slug) return true;
      return false;
    }) || null
  );
}

export function buildImageStudioPrompt(args: ImageStudioBuildPromptArgs): string {
  const base = args.mode === "edit" ? IMAGE_EDIT_PROMPT_PREPROMPT : IMAGE_STUDIO_PROMPT_PREPROMPT;
  const preset = args.preset;
  const sections: string[] = [base];

  if (preset) {
    sections.push(`Selected preset: ${preset.label}${preset.subtitle ? ` — ${preset.subtitle}` : ""}.`);
    sections.push(
      args.mode === "edit"
        ? `Preset edit template: ${preset.editPromptTemplate}`
        : `Preset generation template: ${preset.generationPromptTemplate}`,
    );
    if (preset.negativePrompt) {
      sections.push(`Avoid: ${preset.negativePrompt}.`);
    }
  }

  if (s(args.aspectRatio)) {
    sections.push(`Preferred aspect ratio: ${s(args.aspectRatio)}.`);
  }

  if (toInt(args.variantCount) > 1) {
    sections.push(`Generate with variant intent count: ${toInt(args.variantCount)}.`);
  }

  if (s(args.brandContext)) {
    sections.push(`Brand context: ${s(args.brandContext)}.`);
  }

  if (args.mode === "edit" && s(args.transformMode)) {
    sections.push(`Edit transform mode: ${s(args.transformMode)}.`);
  }

  sections.push(`User request: ${s(args.userPrompt)}.`);
  return sections.filter(Boolean).join("\n\n");
}

export async function startImageJob(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId?: string | null;
  planTier: ImageStudioPlanTier;
  mode: ImageJobMode;
  actionSource?: string | null;
  agentId?: string | null;
  agentActionKey?: string | null;
  prompt: string;
  resolvedPrompt: string;
  presetId?: string | null;
  modelUsed: string;
  inputAssetRefs?: unknown;
}): Promise<string> {
  await ensureImageStudioTables();
  const id = crypto.randomUUID();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO image_jobs (
        id,
        account_id,
        user_id,
        session_id,
        request_id,
        plan_tier,
        mode,
        action_source,
        agent_id,
        agent_action_key,
        prompt,
        resolved_prompt,
        preset_id,
        model_used,
        status,
        input_asset_refs,
        output_asset_refs,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${s(args.accountId)},
        ${s(args.userId)},
        ${s(args.sessionId) || null},
        ${s(args.requestId) || null},
        ${args.planTier},
        ${args.mode},
        ${s(args.actionSource) || null},
        ${s(args.agentId) || null},
        ${s(args.agentActionKey) || null},
        ${s(args.prompt)},
        ${s(args.resolvedPrompt)},
        ${s(args.presetId) || null},
        ${s(args.modelUsed)},
        'running',
        ${args.inputAssetRefs ? (args.inputAssetRefs as object) : Prisma.JsonNull},
        ${Prisma.JsonNull},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );

  return id;
}

export async function completeImageJob(args: {
  jobId: string;
  accountId: string;
  userId: string;
  outputAssetRefs: unknown;
}): Promise<void> {
  await ensureImageStudioTables();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE image_jobs
      SET
        status = 'completed',
        errors = NULL,
        output_asset_refs = ${args.outputAssetRefs ? (args.outputAssetRefs as object) : Prisma.JsonNull},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${s(args.jobId)}
        AND account_id = ${s(args.accountId)}
        AND user_id = ${s(args.userId)}
    `,
  );
}

export async function failImageJob(args: {
  jobId: string;
  accountId: string;
  userId: string;
  errorMessage: string;
}): Promise<void> {
  await ensureImageStudioTables();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE image_jobs
      SET
        status = 'failed',
        errors = ${clampSummary(args.errorMessage, 4000)},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${s(args.jobId)}
        AND account_id = ${s(args.accountId)}
        AND user_id = ${s(args.userId)}
    `,
  );
}

export async function createImageAsset(args: {
  accountId: string;
  userId: string;
  jobId?: string | null;
  presetId?: string | null;
  sourceKind: ImageAssetSourceKind;
  originalSource?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  fileLocation?: string | null;
  cavcloudFileId?: string | null;
  cavcloudKey?: string | null;
  cavsafeFileId?: string | null;
  cavsafeKey?: string | null;
  externalUrl?: string | null;
  dataUrl?: string | null;
  b64Data?: string | null;
  sourcePrompt?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<string> {
  await ensureImageStudioTables();
  const id = crypto.randomUUID();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO image_assets (
        id,
        account_id,
        user_id,
        job_id,
        preset_id,
        source_kind,
        original_source,
        file_name,
        mime_type,
        bytes,
        width,
        height,
        format,
        file_location,
        cavcloud_file_id,
        cavcloud_key,
        cavsafe_file_id,
        cavsafe_key,
        external_url,
        data_url,
        b64_data,
        source_prompt,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${s(args.accountId)},
        ${s(args.userId)},
        ${s(args.jobId) || null},
        ${s(args.presetId) || null},
        ${s(args.sourceKind)},
        ${s(args.originalSource) || null},
        ${s(args.fileName) || null},
        ${s(args.mimeType) || "image/png"},
        ${Math.max(0, Math.trunc(Number(args.bytes || 0)))},
        ${Number.isFinite(Number(args.width)) ? Math.trunc(Number(args.width)) : null},
        ${Number.isFinite(Number(args.height)) ? Math.trunc(Number(args.height)) : null},
        ${s(args.format) || inferImageFormatFromMime(s(args.mimeType) || "image/png")},
        ${s(args.fileLocation) || null},
        ${s(args.cavcloudFileId) || null},
        ${s(args.cavcloudKey) || null},
        ${s(args.cavsafeFileId) || null},
        ${s(args.cavsafeKey) || null},
        ${s(args.externalUrl) || null},
        ${s(args.dataUrl) || null},
        ${s(args.b64Data) || null},
        ${s(args.sourcePrompt) || null},
        ${args.metadata ? (args.metadata as object) : Prisma.JsonNull},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );

  return id;
}

export async function appendUserImageHistory(args: {
  accountId: string;
  userId: string;
  jobId?: string | null;
  assetId?: string | null;
  entryType: string;
  mode?: string | null;
  promptSummary?: string | null;
  saved?: boolean;
  savedTarget?: string | null;
}): Promise<void> {
  await ensureImageStudioTables();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO user_image_history (
        id,
        account_id,
        user_id,
        job_id,
        asset_id,
        entry_type,
        mode,
        prompt_summary,
        saved,
        saved_target,
        created_at,
        updated_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${s(args.accountId)},
        ${s(args.userId)},
        ${s(args.jobId) || null},
        ${s(args.assetId) || null},
        ${s(args.entryType) || "history"},
        ${s(args.mode) || null},
        ${clampSummary(s(args.promptSummary), 1000) || null},
        ${args.saved === true},
        ${s(args.savedTarget) || null},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );
}

export async function getImageAssetById(args: {
  accountId: string;
  userId: string;
  assetId: string;
}): Promise<ImageAssetRecord | null> {
  await ensureImageStudioTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        id,
        account_id,
        user_id,
        job_id,
        preset_id,
        source_kind,
        original_source,
        file_name,
        mime_type,
        bytes,
        width,
        height,
        format,
        file_location,
        cavcloud_file_id,
        cavcloud_key,
        cavsafe_file_id,
        cavsafe_key,
        external_url,
        data_url,
        b64_data,
        source_prompt,
        metadata_json,
        created_at,
        updated_at
      FROM image_assets
      WHERE id = ${s(args.assetId)}
        AND account_id = ${s(args.accountId)}
        AND user_id = ${s(args.userId)}
      LIMIT 1
    `,
  );

  const row = rows[0];
  if (!row) return null;

  const metadata = row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
    ? (row.metadata_json as Record<string, unknown>)
    : null;

  return {
    id: s(row.id),
    accountId: s(row.account_id),
    userId: s(row.user_id),
    jobId: s(row.job_id) || null,
    presetId: s(row.preset_id) || null,
    sourceKind: s(row.source_kind),
    originalSource: s(row.original_source) || null,
    fileName: s(row.file_name) || null,
    mimeType: s(row.mime_type) || "image/png",
    bytes: Math.max(0, toInt(row.bytes)),
    width: Number.isFinite(Number(row.width)) ? Math.trunc(Number(row.width)) : null,
    height: Number.isFinite(Number(row.height)) ? Math.trunc(Number(row.height)) : null,
    format: s(row.format) || null,
    fileLocation: s(row.file_location) || null,
    cavcloudFileId: s(row.cavcloud_file_id) || null,
    cavcloudKey: s(row.cavcloud_key) || null,
    cavsafeFileId: s(row.cavsafe_file_id) || null,
    cavsafeKey: s(row.cavsafe_key) || null,
    externalUrl: s(row.external_url) || null,
    dataUrl: s(row.data_url) || null,
    b64Data: s(row.b64_data) || null,
    sourcePrompt: s(row.source_prompt) || null,
    metadataJson: metadata,
    createdAtISO: toIso(row.created_at),
    updatedAtISO: toIso(row.updated_at),
  };
}

export async function readImageHistory(args: {
  accountId: string;
  userId: string;
  view: "recent" | "saved" | "history";
  limit?: number;
}): Promise<ImageHistoryEntry[]> {
  await ensureImageStudioTables();
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit || 36))));

  const filterSql = args.view === "saved"
    ? Prisma.sql`AND h.saved = true`
    : args.view === "recent"
      ? Prisma.sql`AND (h.entry_type IN ('generated', 'edited', 'imported', 'uploaded_device') OR h.saved = false)`
      : Prisma.sql``;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        h.id,
        h.entry_type,
        h.mode,
        h.prompt_summary,
        h.saved,
        h.saved_target,
        h.created_at,
        h.job_id,
        h.asset_id,
        a.preset_id,
        p.label AS preset_label,
        a.external_url,
        a.data_url,
        a.b64_data,
        a.file_name,
        a.mime_type,
        a.source_prompt,
        j.model_used
      FROM user_image_history h
      LEFT JOIN image_assets a
        ON a.id = h.asset_id
      LEFT JOIN image_jobs j
        ON j.id = COALESCE(h.job_id, a.job_id)
      LEFT JOIN image_presets p
        ON p.id = COALESCE(a.preset_id, j.preset_id)
      WHERE h.account_id = ${s(args.accountId)}
        AND h.user_id = ${s(args.userId)}
        ${filterSql}
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `,
  );

  return rows.map((row) => {
    const dataUrl = s(row.data_url);
    const b64 = s(row.b64_data);
    const mimeType = s(row.mime_type) || "image/png";
    const imageUrl = s(row.external_url)
      || dataUrl
      || (b64 ? `data:${mimeType};base64,${b64}` : null);

    return {
      id: s(row.id),
      entryType: s(row.entry_type),
      mode: s(row.mode) || null,
      promptSummary: s(row.prompt_summary) || null,
      saved: row.saved === true,
      savedTarget: s(row.saved_target) || null,
      createdAtISO: toIso(row.created_at),
      jobId: s(row.job_id) || null,
      assetId: s(row.asset_id) || null,
      presetId: s(row.preset_id) || null,
      presetLabel: s(row.preset_label) || null,
      imageUrl,
      fileName: s(row.file_name) || null,
      mimeType: s(row.mime_type) || null,
      modelUsed: s(row.model_used) || null,
      sourcePrompt: s(row.source_prompt) || null,
    };
  });
}

async function loadBinaryForAsset(args: {
  accountId: string;
  asset: ImageAssetRecord;
}): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const asset = args.asset;
  const mimeType = s(asset.mimeType) || "image/png";
  const fileName = normalizeFileName(asset.fileName || `cavbot-image.${extensionForMime(mimeType)}`);

  const dataUrlBinary = dataUrlToBuffer(asset.dataUrl || "");
  if (dataUrlBinary?.buffer.length) {
    return {
      buffer: dataUrlBinary.buffer,
      mimeType: dataUrlBinary.mimeType || mimeType,
      fileName,
    };
  }

  if (s(asset.b64Data)) {
    try {
      const buffer = Buffer.from(s(asset.b64Data), "base64");
      if (buffer.length) {
        return {
          buffer,
          mimeType,
          fileName,
        };
      }
    } catch {
      // continue fallback
    }
  }

  if (asset.cavcloudFileId) {
    const file = await getCavCloudFileById({
      accountId: args.accountId,
      fileId: asset.cavcloudFileId,
    });
    const stream = await getCavcloudObjectStream({ objectKey: file.r2Key });
    const buffer = await webStreamToBuffer(stream?.body || null);
    if (buffer?.length) {
      return {
        buffer,
        mimeType: s(file.mimeType) || mimeType,
        fileName: normalizeFileName(file.name || fileName),
      };
    }
  }

  if (asset.cavsafeFileId) {
    const file = await getCavSafeFileById({
      accountId: args.accountId,
      fileId: asset.cavsafeFileId,
      enforceReadTimelock: false,
    });
    const stream = await getCavsafeObjectStream({ objectKey: file.r2Key });
    const buffer = await webStreamToBuffer(stream?.body || null);
    if (buffer?.length) {
      return {
        buffer,
        mimeType: s(file.mimeType) || mimeType,
        fileName: normalizeFileName(file.name || fileName),
      };
    }
  }

  if (asset.externalUrl) {
    const response = await fetch(asset.externalUrl, {
      method: "GET",
      cache: "no-store",
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length) {
        const ct = s(response.headers.get("content-type")) || mimeType;
        return {
          buffer,
          mimeType: ct,
          fileName,
        };
      }
    }
  }

  return null;
}

export async function saveImageAssetToTarget(args: {
  accountId: string;
  userId: string;
  planTier: ImageStudioPlanTier;
  assetId: string;
  target: "cavcloud" | "cavsafe";
  fileName?: string | null;
  folderPath?: string | null;
}): Promise<{
  target: "cavcloud" | "cavsafe";
  assetId: string;
  fileId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
}> {
  await ensureImageStudioTables();

  if (args.target === "cavsafe" && planRank(args.planTier) < planRank("premium")) {
    throw new Error("CavSafe save requires Premium or Premium+.");
  }

  const asset = await getImageAssetById({
    accountId: args.accountId,
    userId: args.userId,
    assetId: args.assetId,
  });
  if (!asset) {
    throw new Error("Image asset not found.");
  }

  const binary = await loadBinaryForAsset({
    accountId: args.accountId,
    asset,
  });
  if (!binary) {
    throw new Error("Unable to resolve source bytes for this asset.");
  }

  const baseName = normalizeFileName(
    args.fileName || asset.fileName || `cavbot-image-${Date.now()}.${extensionForMime(binary.mimeType)}`,
    `cavbot-image-${Date.now()}`,
  );
  const folderPath = s(args.folderPath) || "/Image Studio";

  if (args.target === "cavcloud") {
    const file = await uploadCavCloudSimpleFile({
      accountId: args.accountId,
      operatorUserId: args.userId,
      folderPath,
      fileName: baseName,
      mimeType: binary.mimeType,
      body: bufferToReadableStream(binary.buffer),
      contentLength: binary.buffer.length,
      generateTextSnippets: false,
    });

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE image_assets
        SET
          cavcloud_file_id = ${s(file.id)},
          cavcloud_key = ${s(file.r2Key)},
          file_location = ${s(file.path) || s(file.r2Key)},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${s(asset.id)}
          AND account_id = ${s(args.accountId)}
          AND user_id = ${s(args.userId)}
      `,
    );

    await appendUserImageHistory({
      accountId: args.accountId,
      userId: args.userId,
      jobId: asset.jobId,
      assetId: asset.id,
      entryType: "saved_cavcloud",
      mode: asset.sourceKind.includes("edit") ? "edit" : "generate",
      promptSummary: asset.sourcePrompt || asset.fileName || "Saved to CavCloud",
      saved: true,
      savedTarget: "cavcloud",
    });

    return {
      target: "cavcloud",
      assetId: asset.id,
      fileId: s(file.id),
      filePath: s(file.path),
      fileName: s(file.name) || baseName,
      mimeType: s(file.mimeType) || binary.mimeType,
    };
  }

  const safeFile = await uploadCavSafeSimpleFile({
    accountId: args.accountId,
    operatorUserId: args.userId,
    folderPath,
    fileName: baseName,
    mimeType: binary.mimeType,
    body: bufferToReadableStream(binary.buffer),
    contentLength: binary.buffer.length,
  });

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE image_assets
      SET
        cavsafe_file_id = ${s(safeFile.id)},
        cavsafe_key = ${s(safeFile.r2Key)},
        file_location = ${s(safeFile.path) || s(safeFile.r2Key)},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${s(asset.id)}
        AND account_id = ${s(args.accountId)}
        AND user_id = ${s(args.userId)}
    `,
  );

  await appendUserImageHistory({
    accountId: args.accountId,
    userId: args.userId,
    jobId: asset.jobId,
    assetId: asset.id,
    entryType: "saved_cavsafe",
    mode: asset.sourceKind.includes("edit") ? "edit" : "generate",
    promptSummary: asset.sourcePrompt || asset.fileName || "Saved to CavSafe",
    saved: true,
    savedTarget: "cavsafe",
  });

  return {
    target: "cavsafe",
    assetId: asset.id,
    fileId: s(safeFile.id),
    filePath: s(safeFile.path),
    fileName: s(safeFile.name) || baseName,
    mimeType: s(safeFile.mimeType) || binary.mimeType,
  };
}

export async function registerImportedAsset(args: {
  accountId: string;
  userId: string;
  source: "cavcloud" | "cavsafe";
  sourceId: string;
  sourcePath: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  bytes: number;
}): Promise<string> {
  const dataUrl = s(args.dataUrl);
  if (!dataUrl) {
    throw new Error("Import data URL is required.");
  }

  const parsed = dataUrlToBuffer(dataUrl);
  const b64Data = parsed ? parsed.buffer.toString("base64") : "";

  const assetId = await createImageAsset({
    accountId: args.accountId,
    userId: args.userId,
    sourceKind: args.source === "cavsafe" ? "import_cavsafe" : "import_cavcloud",
    originalSource: args.source,
    fileName: args.fileName,
    mimeType: args.mimeType,
    bytes: Math.max(0, args.bytes || parsed?.buffer.length || 0),
    format: inferImageFormatFromMime(args.mimeType),
    fileLocation: s(args.sourcePath) || null,
    cavcloudFileId: args.source === "cavcloud" ? s(args.sourceId) : null,
    cavsafeFileId: args.source === "cavsafe" ? s(args.sourceId) : null,
    dataUrl,
    b64Data: b64Data.slice(0, MAX_INLINE_B64_CHARS),
    metadata: {
      importedAtISO: new Date().toISOString(),
      sourceId: s(args.sourceId),
      sourcePath: s(args.sourcePath),
    },
  });

  await appendUserImageHistory({
    accountId: args.accountId,
    userId: args.userId,
    assetId,
    entryType: "imported",
    mode: "edit",
    promptSummary: `Imported from ${args.source === "cavsafe" ? "CavSafe" : "CavCloud"}`,
    saved: false,
  });

  return assetId;
}

export async function registerUploadedDeviceAsset(args: {
  accountId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  dataUrl: string;
}): Promise<string> {
  const parsed = dataUrlToBuffer(args.dataUrl);
  const assetId = await createImageAsset({
    accountId: args.accountId,
    userId: args.userId,
    sourceKind: "uploaded_device",
    originalSource: "device",
    fileName: args.fileName,
    mimeType: args.mimeType,
    bytes: Math.max(0, args.bytes || parsed?.buffer.length || 0),
    format: inferImageFormatFromMime(args.mimeType),
    dataUrl: args.dataUrl,
    b64Data: parsed ? parsed.buffer.toString("base64").slice(0, MAX_INLINE_B64_CHARS) : null,
    metadata: {
      uploadedAtISO: new Date().toISOString(),
      source: "device",
    },
  });

  await appendUserImageHistory({
    accountId: args.accountId,
    userId: args.userId,
    assetId,
    entryType: "uploaded_device",
    mode: "edit",
    promptSummary: clampSummary(args.fileName, 200),
    saved: false,
  });

  return assetId;
}

export async function syncAgentInstallState(args: {
  accountId: string;
  userId: string;
  planTier: ImageStudioPlanTier;
  installedAgentIds: string[];
}): Promise<void> {
  await ensureImageStudioTables();

  const installedSet = new Set(
    (Array.isArray(args.installedAgentIds) ? args.installedAgentIds : [])
      .map((id) => s(id).toLowerCase())
      .filter(Boolean),
  );

  for (const agentId of IMAGE_AGENT_IDS) {
    const installed = installedSet.has(agentId);
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO agent_install_state (
          id,
          account_id,
          user_id,
          surface,
          agent_id,
          installed,
          plan_tier,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${s(args.accountId)},
          ${s(args.userId)},
          'center',
          ${agentId},
          ${installed},
          ${args.planTier},
          ${({ managedBy: "caven_settings" } as object)},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (account_id, user_id, surface, agent_id)
        DO UPDATE SET
          installed = EXCLUDED.installed,
          plan_tier = EXCLUDED.plan_tier,
          metadata_json = EXCLUDED.metadata_json,
          updated_at = CURRENT_TIMESTAMP
      `,
    );
  }
}

export async function resolveDataUrlForAsset(args: {
  accountId: string;
  userId: string;
  assetId: string;
}): Promise<{ dataUrl: string; mimeType: string; fileName: string } | null> {
  const asset = await getImageAssetById({
    accountId: args.accountId,
    userId: args.userId,
    assetId: args.assetId,
  });
  if (!asset) return null;

  const dataUrl = s(asset.dataUrl);
  if (dataUrl) {
    return {
      dataUrl,
      mimeType: s(asset.mimeType) || "image/png",
      fileName: normalizeFileName(asset.fileName || "image"),
    };
  }

  if (s(asset.b64Data)) {
    const mimeType = s(asset.mimeType) || "image/png";
    return {
      dataUrl: `data:${mimeType};base64,${s(asset.b64Data)}`,
      mimeType,
      fileName: normalizeFileName(asset.fileName || `image.${extensionForMime(mimeType)}`),
    };
  }

  const binary = await loadBinaryForAsset({
    accountId: args.accountId,
    asset,
  });
  if (!binary) return null;

  return {
    dataUrl: bufferToDataUrl(binary.buffer, binary.mimeType),
    mimeType: binary.mimeType,
    fileName: binary.fileName,
  };
}
