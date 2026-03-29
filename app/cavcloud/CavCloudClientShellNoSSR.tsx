"use client";

import dynamic from "next/dynamic";

type CavCloudClientShellProps = {
  isOwner: boolean;
  cacheScopeKey?: string;
};

const CavCloudClientShell = dynamic(() => import("./CavCloudClientShell"), {
  ssr: false,
  loading: () => null,
});

export default function CavCloudClientShellNoSSR(props: CavCloudClientShellProps) {
  return <CavCloudClientShell {...props} />;
}

