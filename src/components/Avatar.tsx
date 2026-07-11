import { useEffect, useState } from "preact/hooks";
import { hueFromId, initialOf } from "../lib/util";
import { resolveStorageUrl } from "../lib/mediaUrl";

/**
 * A deterministic identity chip: same DID → same color + initial everywhere,
 * with no coordination needed. When `avatarCid` is set (a profile image stored
 * in mistlib storage) it is resolved to an image and shown instead; while it
 * loads, or when absent, the colored initial is the fallback.
 */
export function Avatar(props: {
  id: string;
  name: string;
  avatarCid?: string;
  size?: number;
  title?: string;
}) {
  const { id, name, avatarCid, size = 28, title } = props;
  const hue = hueFromId(id);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarCid) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    resolveStorageUrl(avatarCid)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {
        // Fall back to the colored initial if the image can't be fetched.
      });
    return () => {
      cancelled = true;
    };
  }, [avatarCid]);

  const dimension = { width: `${size}px`, height: `${size}px` };

  if (url) {
    return (
      <img
        class="avatar avatar--img"
        src={url}
        alt={name}
        title={title ?? name}
        style={dimension}
      />
    );
  }

  return (
    <span
      class="avatar"
      title={title ?? name}
      style={{
        ...dimension,
        fontSize: `${Math.round(size * 0.44)}px`,
        background: `hsl(${hue} 65% 92%)`,
        color: `hsl(${hue} 55% 32%)`,
        borderColor: `hsl(${hue} 55% 78%)`,
      }}
    >
      {initialOf(name)}
    </span>
  );
}
