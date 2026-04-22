import Image from "next/image";

export function AdminAuthHero(props: {
  eyebrow?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="hq-authHero">
      <div className="hq-authBrand">
        <div className="hq-authVerifyEmblem" aria-hidden="true">
          <Image src="/logo/cavbot-logomark.svg" alt="" width={38} height={38} className="hq-authVerifyMark" />
          <span className="hq-authVerifyShield">
            <span className="hq-authVerifyShieldIcon" />
          </span>
        </div>
        <div className="hq-authVerifyMeta">
          {props.eyebrow ? <span className="hq-brandKicker">{props.eyebrow}</span> : null}
          <h1 className="hq-authTitle">{props.title}</h1>
          <p className="hq-authSub">{props.subtitle}</p>
        </div>
      </div>
    </div>
  );
}
