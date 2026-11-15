import { blobToDataURL, compressImage } from "./imageCompression";
import {
  readSettingsMedia,
  removeSettingsMedia,
  writeMedia,
} from "./mediaStorage";

export const homePhotoKeys = {
  widget: "home_photo_widget",
  wide: "home_photo_wide",
  left: "home_photo_left",
  right: "home_photo_right",
} as const;

export async function exportHomePhotos() {
  const photos: Record<string, string> = {};
  await Promise.all(
    Object.values(homePhotoKeys).map(async (key) => {
      const file = await readSettingsMedia(key);
      if (!file) return;
      photos[key] = await blobToDataURL(file);
    }),
  );
  return photos;
}

export async function restoreHomePhotos(
  photos: Record<string, string> | undefined,
) {
  if (!photos) return;
  await Promise.all(
    Object.values(homePhotoKeys).map(async (key) => {
      if (!photos[key]) return removeSettingsMedia(key);
      const file = await (await fetch(photos[key])).blob();
      await writeMedia(
        "LauncherDB",
        "mediaStore",
        `savedMediaFile_${key}`,
        file.type.startsWith("image/")
          ? await compressImage(file, 1600, true)
          : file,
      );
    }),
  );
}
