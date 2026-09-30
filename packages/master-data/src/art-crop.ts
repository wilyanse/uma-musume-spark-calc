/**
 * Fractional crop boxes (integer permille, 1/1000, of the image width/height) applied BEFORE dHash
 * (see dhash.ts step 1). The C# agent mirrors these in `agent/layouts/*.json` -> `cardArtCrop` /
 * `iconCrop`; both sides must use the same numbers.
 *
 * CARD_ART_CROP: the art region of a support-card tile with the frame removed. In the in-game list
 * tile (docs/reference/screenshots/13-support-card-list.png) the rarity badge sits top-left, the type
 * icon top-right, and the LB diamonds + "Lvl N" text along the bottom. The box keeps the middle band:
 * x 10%..90%, y 34%..78% (below the badge / type icon, above the diamonds / level text).
 * The same box is applied to GameTora's full portrait `tex_support_card_<id>.png` (450x600), which has
 * the same framing as the in-game tile. NOT the 128x128 `support_card_s_<id>.png` thumbnail: that is a
 * face close-up and ranks ~180th of 255 against the real tile (review B1). Checked on screenshot 13:
 * the first tile (The Brightest Star in Japan!, Special Week) is Hamming 7 from its portrait hash and
 * the nearest of all 255 cards (test/bundle.test.ts).
 * CAVEAT (Q-5): the screenshot is a scaled, lossy capture, so a Hamming threshold still has to be
 * calibrated on real captures; matching by nearest hash works today.
 *
 * CHAR_ICON_CROP: the face of the round `chr_icon_<charId>.png` (256x256): x 18%..82%, y 15%..75%
 * (inside the circular border, excluding the transparent/white corners).
 * VETERAN_ICON_CROP: the face inside the ring of `veteran_icon/<cardId>_01.png` (233x256): x 22%..78%,
 * y 15%..70%.
 */
import type { CropBox } from './dhash.ts';

export const CARD_ART_CROP: CropBox = { x0: 100, y0: 340, x1: 900, y1: 780 };
export const CHAR_ICON_CROP: CropBox = { x0: 180, y0: 150, x1: 820, y1: 750 };
export const VETERAN_ICON_CROP: CropBox = { x0: 220, y0: 150, x1: 780, y1: 700 };

/** Mirrors the JSON block the agent layouts must carry. */
export const ART_CROP_LAYOUT = {
  cardArtCrop: CARD_ART_CROP,
  charIconCrop: CHAR_ICON_CROP,
  veteranIconCrop: VETERAN_ICON_CROP,
  unit: 'permille',
} as const;
