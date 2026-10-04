/** The DiceBear style and options for the account face. */
const base = "https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=";

/** The remote avatar for a seed. The username is sent to DiceBear in this URL; there is no other data in it. */
export function avatarSrc(seed: string): string {
  return `${base}${encodeURIComponent(seed)}`;
}
