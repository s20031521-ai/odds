const mascotPoses = {
  "chiikawa-corner": { src: "/chiikawa/mascot-chiikawa-corner.png", modifier: "corner" },
  "chiikawa-empty": { src: "/chiikawa/mascot-chiikawa-empty.png", modifier: "empty" },
  "momonga-loading": { src: "/chiikawa/mascot-momonga-loading.png", modifier: "loading" },
  "momonga-alert": { src: "/chiikawa/mascot-momonga-loading.png", modifier: "alert" },
  "login-duo": { src: "/chiikawa/mascot-login-duo.png", modifier: "login" },
  "chiikawa-top-left": { src: "/chiikawa/mascot-top-left.png", modifier: "top-left" },
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

