const mascotPoses = {
  "chiikawa-corner": { src: "/chiikawa/mascot-chiikawa-corner.png", modifier: "corner" },
  "chiikawa-empty": { src: "/chiikawa/mascot-chiikawa-empty.png", modifier: "empty" },
  "momonga-loading": { src: "/chiikawa/mascot-momonga-loading.png", modifier: "loading" },
  "login-duo": { src: "/chiikawa/mascot-login-duo.png", modifier: "login" },
} as const;

export type MascotPose = keyof typeof mascotPoses;

export function Mascot(props: { pose: MascotPose }): React.ReactElement {
  const mascot = mascotPoses[props.pose];
  return (
    <img
      className={`mascot mascot--${mascot.modifier}`}
      src={mascot.src}
      alt=""
      loading="lazy"
      width={160}
      height={160}
    />
  );
}

export function KawaiiDecor(): React.ReactElement {
  return (
    <span className="kawaii-decor" aria-hidden="true">
      <span className="kawaii-decor__petal kawaii-decor__petal--1" />
      <span className="kawaii-decor__petal kawaii-decor__petal--2" />
      <span className="kawaii-decor__star" />
    </span>
  );
}
