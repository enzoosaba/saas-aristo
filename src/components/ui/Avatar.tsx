export default function Avatar({
  user,
  className = "avatar",
}: {
  user: { name: string; avatar?: string | null };
  className?: string;
}) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className={className} aria-hidden="true">
      {/* O avatar já chega como data URI redimensionado para 256px em
          lib/image.ts; next/image não otimiza data URIs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {user.avatar ? <img src={user.avatar} alt="" /> : initials}
    </span>
  );
}
